import type { ContentType, ScoreComponents, SourceTier } from "@/db/schema";

export interface RankInput {
  lastActivityAt: Date;
  firstSeenAt: Date;
  contentType: ContentType;
  /** Tier of every distinct source attached to the story. */
  sourceTiers: SourceTier[];
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

  const hours = Math.max(0, (now.getTime() - input.lastActivityAt.getTime()) / 3_600_000);
  c.recency = round(WEIGHTS.recencyMax * Math.pow(0.5, hours / WEIGHTS.recencyHalfLifeHours));

  const tiers = new Set(input.sourceTiers);
  if (tiers.has("PRIMARY")) c.primarySource = WEIGHTS.primarySource;
  else if (tiers.has("HIGH_QUALITY_REPORTING")) c.qualityReporting = WEIGHTS.highQualityReporting;
  else if (tiers.has("COMMUNITY")) c.communitySignal = WEIGHTS.communityOnly;

  const distinctSources = input.sourceTiers.length;
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

  const points = input.engagementPoints ?? 0;
  const comments = input.engagementComments ?? 0;
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
