import { describe, expect, it } from "vitest";
import { rankStory, WEIGHTS } from "./score";

const now = new Date("2026-09-16T12:00:00Z");
const base = {
  lastActivityAt: new Date("2026-09-16T11:00:00Z"),
  contentType: "NEWS" as const,
  sourceTiers: ["HIGH_QUALITY_REPORTING" as const],
  topicKeys: [] as string[],
  userTopicKeys: [] as string[],
};

describe("rankStory", () => {
  it("is additive and stores every component", () => {
    const r = rankStory(base, now);
    const sum = Object.values(r.components).reduce((a, b) => a + b, 0);
    expect(Math.abs(r.score - sum)).toBeLessThan(0.11);
    expect(r.components.qualityReporting).toBe(WEIGHTS.highQualityReporting);
    expect(r.components.contentType).toBe(WEIGHTS.contentType.NEWS);
  });
  it("decays with time", () => {
    const fresh = rankStory(base, now).components.recency;
    const old = rankStory({ ...base, lastActivityAt: new Date("2026-09-14T11:00:00Z") }, now)
      .components.recency;
    expect(fresh).toBeGreaterThan(old);
    expect(old).toBeLessThan(1);
  });
  it("prefers primary sources over reporting over community", () => {
    const p = rankStory({ ...base, sourceTiers: ["PRIMARY"] }, now).score;
    const h = rankStory(base, now).score;
    const c = rankStory({ ...base, sourceTiers: ["COMMUNITY"] }, now).score;
    expect(p).toBeGreaterThan(h);
    expect(h).toBeGreaterThan(c);
  });
  it("rewards corroboration with a cap", () => {
    const two = rankStory({ ...base, sourceTiers: ["PRIMARY", "COMMUNITY"] }, now).components;
    expect(two.corroboration).toBe(WEIGHTS.corroborationPerSource);
    const many = rankStory(
      {
        ...base,
        sourceTiers: [
          "PRIMARY",
          "COMMUNITY",
          "COMMUNITY",
          "COMMUNITY",
          "COMMUNITY",
          "COMMUNITY",
          "COMMUNITY",
        ],
      },
      now,
    ).components;
    expect(many.corroboration).toBe(WEIGHTS.corroborationMax);
  });
  it("applies topic match only when the user follows a matching topic", () => {
    const none = rankStory({ ...base, topicKeys: ["openai"] }, now).components.topicMatch;
    expect(none).toBeUndefined();
    const one = rankStory({ ...base, topicKeys: ["openai"], userTopicKeys: ["openai"] }, now)
      .components.topicMatch;
    expect(one).toBe(WEIGHTS.topicFirstMatch);
    const two = rankStory(
      { ...base, topicKeys: ["openai", "agents"], userTopicKeys: ["openai", "agents"] },
      now,
    ).components.topicMatch;
    expect(two).toBe(WEIGHTS.topicFirstMatch + WEIGHTS.topicExtraMatch);
  });
  it("engagement uses a log scale and never exceeds the cap", () => {
    const small = rankStory({ ...base, engagementPoints: 10 }, now).components.engagement!;
    const big = rankStory({ ...base, engagementPoints: 100_000, engagementComments: 5000 }, now)
      .components.engagement!;
    expect(small).toBeGreaterThan(0);
    expect(big).toBe(WEIGHTS.engagementMax);
  });
});

describe("rankStory numeric safety", () => {
  it("never produces a NaN score from a negative engagement count", () => {
    const r = rankStory({ ...base, engagementPoints: -5, engagementComments: 10 }, now);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(Number.isFinite(r.components.engagement ?? 0)).toBe(true);
  });

  it("never produces a NaN score from a negative comment count", () => {
    const r = rankStory({ ...base, engagementPoints: 10, engagementComments: -3 }, now);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(Number.isFinite(r.components.engagement ?? 0)).toBe(true);
  });

  it("treats a story with no engagement signal as having no engagement component", () => {
    const r = rankStory({ ...base, engagementPoints: 0, engagementComments: 0 }, now);
    expect(r.components.engagement).toBeUndefined();
    expect(Number.isFinite(r.score)).toBe(true);
  });
});

describe("rankStory date safety", () => {
  it("never produces a NaN score from an unparseable last activity date", () => {
    const r = rankStory({ ...base, lastActivityAt: new Date("not a date") }, now);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(Number.isFinite(r.components.recency)).toBe(true);
    expect(r.components.recency).toBe(WEIGHTS.recencyMax);
  });
});
