import type { ContentType, ScoreComponents, SourceTier, VerificationLevel } from "@/db/schema";

export interface RankInput {
  /**
   * AGE IS MEASURED FROM FIRST SIGHTING, and this replaced lastActivityAt.
   *
   * The reader's complaint was "I'm seeing the same news as I saw a couple of
   * days ago" — a statement about FIRST SIGHTING, not about coverage. A sixth
   * outlet picking up a five-day-old story does not make it news to him again,
   * and under the old clock that pickup reset the story's age and held it at the
   * top of his brief: the leading story was 139 hours old and last active 34,
   * carrying 1.33 points of recency when it needed 0.02 to stay first.
   *
   * THE COST, stated rather than discovered: a genuinely developing story now
   * falls out of the brief WHILE IT IS STILL DEVELOPING. That is the price of
   * this clock and it is the price the complaint asked for. The story page's
   * timeline still shows the activity; the brief stops leading with it.
   *
   * The previous choice was recorded at this line as "by design ... deliberately
   * not a ranking input in version 1" with no reason given. A decision recorded
   * without its reason cannot be defended by the person who made it either, so
   * there was nothing to overturn — only something to replace.
   */
  firstSeenAt: Date;
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

/**
 * Enforces the absence documented on COMPONENT_LABELS.
 *
 * If the annotation is ever added back, ComponentKey widens to `string`, the
 * guard silently permits every unlabelled component, and nothing else in the
 * build says a word — a comment alone has never been enough on this project.
 * This turns that into a TS2344 pointing here, and the comment above the
 * declaration explains why to whoever hits it.
 */
type AssertTrue<T extends true> = T;
type ComponentKeyIsNarrow = AssertTrue<string extends ComponentKey ? false : true>;
export type { ComponentKeyIsNarrow };

export interface RankResult {
  score: number;
  components: ScoreComponents;
}

/**
 * Transparent, additive ranking. Every component is stored so the developer
 * view can answer "why is this #3?". Tune weights here, nowhere else.
 */
export const WEIGHTS = {
  /**
   * AGE HALVES THE WHOLE SCORE EVERY 48 HOURS. It is a multiplier, not a term.
   *
   * WHY NOT AN ADDITIVE BONUS, WHICH IS WHAT THIS WAS. Recency used to be
   * `14 * 0.5^(hours/10)` added to the total, and measurement showed it could
   * not do the job at any half-life:
   *
   *   fresh stories (<=24h) had MEAN STRUCTURE 23.95 — single-source, not yet
   *   corroborated, not yet topic-matched. The 58-hour pack had 42.06. That is a
   *   gap of 18.18 against a cap of 14, SO A BRAND-NEW STORY COULD NOT REACH THE
   *   TOP EVEN AT AGE ZERO.
   *
   * Lengthening the half-life does not help: it hands the old story more points
   * too, leaving the gap untouched. THE CAP DECIDES WHETHER AGE CAN EVER MATTER;
   * THE HALF-LIFE ONLY DECIDES HOW FAST IT STOPS MATTERING. Raising the cap
   * above the gap works and is pure churn — any fresh story would outrank any
   * old one regardless of importance.
   *
   * A multiplier scales with importance instead of competing with it: a big
   * story fades slowly in absolute terms, a weak one vanishes.
   *
   * WHY 48 HOURS, measured on the live corpus rather than chosen:
   *
   *   below 42h  a structure-26 story at 5h outranks a structure-43 story at
   *              34h. That is churn — the freshest thing wins on freshness alone.
   *   above 72h  the stale pack returns to the top five and the bug comes back.
   *   at 42h     the bigger story leads by 0.32 points. Inside the band and on
   *              its edge, so a slightly different corpus flips it.
   *   at 48h     the bigger story leads by 1.84 and four of the top five are
   *              first seen within 24 hours.
   *
   * 48 is chosen for the MARGIN, not the midpoint: it is the smallest value with
   * room on the churn side. Re-derive it with scripts/measure-brief-coverage.ts
   * against a live corpus before moving it.
   */
  ageHalfLifeHours: 48,
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

  // ── AGE, APPLIED TO THE WHOLE SCORE, AND STORED AS A NEGATIVE COMPONENT ──
  //
  // The components must still SUM to the score: the why-ranked panel is built on
  // that, and "the parts adding up to the whole" is the property that makes it
  // readable. A bare multiplier would break it, so the decay is recorded as what
  // it costs — structure * (1 - decay) — in the same negative form the
  // verification penalties already use, where the sign is the point.
  //
  // Computed AFTER the structural components, because it is a function of their
  // sum. A component added below this line would not be decayed.
  const structure = round(Object.values(c).reduce((a, b) => a + b, 0));

  // An unparseable date yields NaN, and one NaN turns the whole score into NaN.
  // Treat an unusable date as "just now" rather than poisoning the score;
  // normalizeItem already stops invalid dates upstream, so this is the second
  // line of defence, not the first.
  const ageHours = (now.getTime() - input.firstSeenAt.getTime()) / 3_600_000;
  const hours = Number.isFinite(ageHours) ? Math.max(0, ageHours) : 0;
  const decay = Math.pow(0.5, hours / WEIGHTS.ageHalfLifeHours);
  // `cost === 0 ? 0` rather than negating unconditionally: at age zero the cost
  // is 0, and `-0` is not `0` to Object.is — so a test asserting `toBe(0)` would
  // fail on a correct implementation, and a reader would see "-0" in the panel.
  const cost = structure * (1 - decay);
  c.ageDecay = cost === 0 ? 0 : round(-cost);

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
  ageDecay: "Age",
  /**
   * KEPT THOUGH NOTHING WRITES IT ANY MORE. Rows scored before the decay change
   * still carry a `recency` component, and rank-all only re-scores inside its
   * window — so an older story keeps the old shape until it falls out entirely.
   * Dropping the label would make those rows render their raw key to a reader.
   * Remove it once nothing in the database has one.
   */
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
 * Labels kept for components NOTHING PRODUCES ANY MORE.
 *
 * A DECLARATION, NOT AN EXCEPTIONS LIST — the same shape as DELIBERATELY_ABSENT
 * in scripts/check-worker-env.ts. Every entry has to say why, and the suite fails
 * if a label stops being produced WITHOUT being declared here, so a label that
 * quietly loses its producer is still a red.
 *
 * `recency` was the additive term the decay replaced. rank-all only re-scores
 * inside RANKING_WINDOW_HOURS, so a story older than that keeps its old
 * components indefinitely and the story page still renders them. Dropping the
 * label would show a reader the raw key. Remove the entry once nothing stored
 * has one.
 */
export const LEGACY_COMPONENT_LABELS: readonly string[] = ["recency"];

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

/** One component of a score, ready to render. */
export interface LabelledComponent {
  key: string;
  label: string;
  value: number;
}

/**
 * The persisted components turned into the shape the API returns.
 *
 * The label comes from the pipeline's own map, so the wording a reader sees
 * cannot drift from the weights that produced the number. A component with no
 * label falls back to its key rather than being dropped: an unlabelled bar is a
 * visible gap someone will fix, a missing one silently stops the parts adding
 * up to the whole.
 */
export function scoreComponentList(components: ScoreComponents): LabelledComponent[] {
  return Object.entries(components).map(([key, value]) => ({
    key,
    label: labelFor(key),
    value,
  }));
}
