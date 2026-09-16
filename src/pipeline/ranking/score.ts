import type { ContentType, ScoreComponents, SourceTier, VerificationLevel } from "@/db/schema";

export interface RankInput {
  /**
   * Recency is measured from the last activity by design. A story's age since
   * it was first sighted is deliberately not a ranking input in version 1;
   * stories.firstSeenAt still exists and feeds the timeline on the story page.
   */
  lastActivityAt: Date;
  contentType: ContentType;
  /**
   * Every source item attached to the story, duplicates included. Ranking
   * de-duplicates by sourceKey itself rather than trusting the caller to have
   * done it, so it cannot disagree with deriveVerification about how many
   * sources a story has. This is the shape deriveVerification already accepts,
   * so the same array can be passed to both without a mapping step in between.
   */
  sources: { sourceKey: string; tier: SourceTier }[];
  /** How well the story's provenance is established. Penalised, never rewarded. */
  verification: VerificationLevel;
  /** Topic keys attached to the story. */
  topicKeys: string[];
  /** Topic keys the user follows. Empty = no personalisation. */
  userTopicKeys: string[];
  /** Best community engagement signal found on the story (HN points, …). */
  engagementPoints?: number;
  engagementComments?: number;
}

/**
 * The components the ranker may emit, taken from the label map itself.
 *
 * This is what makes an unlabelled component impossible rather than merely
 * tested for: `c.freshness = 5` and `c["freshness"] = 5` both fail to compile
 * until "freshness" has a label. A test can only cover the spellings its
 * author thought of; the compiler covers all of them.
 */
export type ComponentKey = keyof typeof COMPONENT_LABELS;

export interface RankResult {
  score: number;
  components: ScoreComponents;
}

/**
 * Transparent, additive ranking. Every component is stored so the developer
 * view can answer "why is this #3?". Tune weights here, nowhere else.
 */
export const WEIGHTS = {
  recencyMax: 14,
  recencyHalfLifeHours: 10,
  primarySource: 20,
  highQualityReporting: 12,
  // Between a newsroom and the crowd: a named expert's read is worth more than
  // anonymous chatter, and less than independent reporting.
  analyst: 9,
  communityOnly: 4,
  corroborationPerSource: 4,
  corroborationMax: 16,
  topicFirstMatch: 14,
  topicExtraMatch: 4,
  topicMax: 22,
  engagementMax: 12,
  /**
   * Magnitudes, applied as NEGATIVE components. A weak claim should cost a
   * story its place rather than merely fail to earn one, and the why-ranked
   * panel draws these going the other way — so the sign is the point, and a
   * clamp at zero would quietly remove the only thing that pushes down.
   *
   * Two keys rather than one because COMPONENT_LABELS is a static map: a
   * single key would print "Unverified claim" on a story that is only
   * emerging, which is a false statement in front of the reader.
   */
  unverifiedPenalty: 6,
  emergingPenalty: 2,
  contentType: {
    RELEASE: 6,
    MODEL: 6,
    TOOL: 4,
    NEWS: 2,
    BUSINESS: 2,
    REGULATION: 3,
    RESEARCH: 1,
    PAPER: 0,
    TREND: 2,
    DISCUSSION: 0,
  } satisfies Record<ContentType, number>,
} as const;

export function rankStory(input: RankInput, now: Date = new Date()): RankResult {
  // Typed to the label map's own keys, which is what makes an unlabelled
  // component impossible rather than merely tested for: both `c.freshness = 5`
  // and `c["freshness"] = 5` fail to compile until "freshness" has a label. A
  // test can only cover the spellings its author thought of. The cast is
  // because components are populated conditionally, so it starts out empty.
  const c = {} as Record<ComponentKey, number>;

  // An unparseable date yields NaN here, and one NaN component turns the whole
  // additive score into NaN. Treat an unusable date as "just now" rather than
  // poisoning the score; normalizeItem already stops invalid dates upstream,
  // so this is the second line of defence, not the first.
  const ageHours = (now.getTime() - input.lastActivityAt.getTime()) / 3_600_000;
  const hours = Number.isFinite(ageHours) ? Math.max(0, ageHours) : 0;
  c.recency = round(WEIGHTS.recencyMax * Math.pow(0.5, hours / WEIGHTS.recencyHalfLifeHours));

  // One outlet is one source however many items it filed. deriveVerification
  // de-duplicates by key before counting, and if ranking did not, a story that
  // verification calls EMERGING would outscore one it calls CORROBORATED, paid
  // for by the very component the UI labels "Corroborating sources".
  const distinct = new Map(input.sources.map((s) => [s.sourceKey, s]));
  const tiers = new Set([...distinct.values()].map((s) => s.tier));
  if (tiers.has("PRIMARY")) c.primarySource = WEIGHTS.primarySource;
  else if (tiers.has("HIGH_QUALITY_REPORTING")) c.qualityReporting = WEIGHTS.highQualityReporting;
  else if (tiers.has("ANALYST")) c.analyst = WEIGHTS.analyst;
  else if (tiers.has("COMMUNITY")) c.communitySignal = WEIGHTS.communityOnly;

  const distinctSources = distinct.size;
  if (distinctSources > 1) {
    c.corroboration = Math.min(
      WEIGHTS.corroborationMax,
      (distinctSources - 1) * WEIGHTS.corroborationPerSource,
    );
  }

  if (input.userTopicKeys.length) {
    const followed = new Set(input.userTopicKeys);
    const matches = input.topicKeys.filter((k) => followed.has(k)).length;
    if (matches > 0) {
      c.topicMatch = Math.min(
        WEIGHTS.topicMax,
        WEIGHTS.topicFirstMatch + (matches - 1) * WEIGHTS.topicExtraMatch,
      );
    }
  }

  const points = safeCount(input.engagementPoints);
  const comments = safeCount(input.engagementComments);
  if (points > 0 || comments > 0) {
    // 100 points ≈ 8, 500 ≈ 10.8, capped. Comments add a little.
    const e = 4 * Math.log10(points + 1) + 1.5 * Math.log10(comments + 1);
    c.engagement = round(Math.min(WEIGHTS.engagementMax, e));
  }

  if (input.verification === "UNVERIFIED") c.unverifiedPenalty = -WEIGHTS.unverifiedPenalty;
  else if (input.verification === "EMERGING") c.emergingPenalty = -WEIGHTS.emergingPenalty;

  const ct = WEIGHTS.contentType[input.contentType];
  if (ct) c.contentType = ct;

  const score = round(Object.values(c).reduce((a, b) => a + b, 0));
  return { score, components: c };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Engagement counts arrive from third-party metadata. A negative or non-finite
 * count would make Math.log10 return NaN, and a single NaN component turns the
 * whole score into NaN, which sorts unpredictably and poisons the stored value.
 */
function safeCount(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Human labels for the developer "why ranked" view.
 *
 * DO NOT ANNOTATE THIS AS Record<string, string>. The absence of that
 * annotation is load-bearing: it is what keeps the literal keys, which is what
 * makes ComponentKey a real union, which is what makes an unlabelled component
 * fail to compile. With the annotation the keys widen to `string`, ComponentKey
 * becomes `string`, and the guard silently permits everything while still
 * looking like protection. `satisfies` below gives the same shape checking
 * without costing the literals.
 */
export const COMPONENT_LABELS = {
  recency: "Recently active",
  primarySource: "Primary source",
  qualityReporting: "Established reporting",
  analyst: "Expert analysis",
  communitySignal: "Community signal",
  corroboration: "Corroborating sources",
  topicMatch: "Matches your topics",
  engagement: "Community engagement",
  contentType: "Content type",
  unverifiedPenalty: "Unverified claim",
  emergingPenalty: "Not yet corroborated",
} as const satisfies Record<string, string>;

/**
 * The label for a stored component, falling back to the key itself.
 *
 * The fallback is a safety net: a component reaching a reader with no label
 * must not blank its bar or throw. It should never be reached, because
 * ComponentKey makes an unlabelled component fail to compile, and the suite
 * asserts the two sets match.
 */
export function labelFor(key: string): string {
  return (COMPONENT_LABELS as Record<string, string>)[key] ?? key;
}
