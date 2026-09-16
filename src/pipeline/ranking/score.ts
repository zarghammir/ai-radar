import type { ContentType, ScoreComponents, SourceTier } from "@/db/schema";

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
  /** Topic keys attached to the story. */
  topicKeys: string[];
  /** Topic keys the user follows. Empty = no personalisation. */
  userTopicKeys: string[];
  /** Best community engagement signal found on the story (HN points, …). */
  engagementPoints?: number;
  engagementComments?: number;
}

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
  communityOnly: 4,
  corroborationPerSource: 4,
  corroborationMax: 16,
  topicFirstMatch: 14,
  topicExtraMatch: 4,
  topicMax: 22,
  engagementMax: 12,
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
  const c: ScoreComponents = {};

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

/** Human labels for the developer "why ranked" view. */
export const COMPONENT_LABELS: Record<string, string> = {
  recency: "Recently active",
  primarySource: "Primary source",
  qualityReporting: "Established reporting",
  communitySignal: "Community signal",
  corroboration: "Corroborating sources",
  topicMatch: "Matches your topics",
  engagement: "Community engagement",
  contentType: "Content type",
};
