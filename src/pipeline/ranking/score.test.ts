import { describe, expect, it } from "vitest";
import { rankStory, WEIGHTS } from "./score";
import { deriveVerification } from "../clustering/verification";

const now = new Date("2026-09-16T12:00:00Z");
const reuters = { sourceKey: "reuters", tier: "HIGH_QUALITY_REPORTING" as const };
const verge = { sourceKey: "verge", tier: "HIGH_QUALITY_REPORTING" as const };
const base = {
  lastActivityAt: new Date("2026-09-16T11:00:00Z"),
  contentType: "NEWS" as const,
  sources: [verge],
  topicKeys: [] as string[],
  userTopicKeys: [] as string[],
};
/** Seven separate items, all from the same outlet. */
const sevenFromOneOutlet = Array.from({ length: 7 }, () => ({ ...reuters }));

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
    const p = rankStory(
      { ...base, sources: [{ sourceKey: "openai", tier: "PRIMARY" }] },
      now,
    ).score;
    const h = rankStory(base, now).score;
    const c = rankStory({ ...base, sources: [{ sourceKey: "hn", tier: "COMMUNITY" }] }, now).score;
    expect(p).toBeGreaterThan(h);
    expect(h).toBeGreaterThan(c);
  });
  it("rewards corroboration with a cap", () => {
    const two = rankStory(
      {
        ...base,
        sources: [
          { sourceKey: "openai", tier: "PRIMARY" },
          { sourceKey: "hn", tier: "COMMUNITY" },
        ],
      },
      now,
    ).components;
    expect(two.corroboration).toBe(WEIGHTS.corroborationPerSource);
    const many = rankStory(
      {
        ...base,
        sources: [
          { sourceKey: "openai", tier: "PRIMARY" as const },
          ...["hn", "reddit", "x", "lobsters", "slashdot", "discord"].map((k) => ({
            sourceKey: k,
            tier: "COMMUNITY" as const,
          })),
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

describe("rankStory counts outlets, not items", () => {
  it("pays no corroboration for one outlet repeating itself", () => {
    const r = rankStory({ ...base, sources: sevenFromOneOutlet }, now);
    expect(r.components.corroboration).toBeUndefined();
    expect(r.components.qualityReporting).toBe(WEIGHTS.highQualityReporting);
  });

  it("scores seven items from one outlet exactly as one item from it", () => {
    const one = rankStory({ ...base, sources: [reuters] }, now).score;
    const seven = rankStory({ ...base, sources: sevenFromOneOutlet }, now).score;
    expect(seven).toBe(one);
  });

  it("pays corroboration only once a second outlet agrees", () => {
    const r = rankStory({ ...base, sources: [reuters, verge] }, now).components;
    expect(r.corroboration).toBe(WEIGHTS.corroborationPerSource);
  });

  it("does not rank an emerging story above a corroborated one", () => {
    // The two modules must agree on what a source is. deriveVerification
    // de-duplicates by key; if ranking does not, the story it calls EMERGING
    // outscores the one it calls CORROBORATED, and the component paying for
    // it is the one the UI labels "Corroborating sources".
    const named = (s: { sourceKey: string; tier: "HIGH_QUALITY_REPORTING" }) => ({
      ...s,
      sourceName: s.sourceKey,
    });
    expect(deriveVerification(sevenFromOneOutlet.map(named)).level).toBe("EMERGING");
    expect(deriveVerification([reuters, verge].map(named)).level).toBe("CORROBORATED");

    const emerging = rankStory({ ...base, sources: sevenFromOneOutlet }, now).score;
    const corroborated = rankStory({ ...base, sources: [reuters, verge] }, now).score;
    expect(emerging).toBeLessThan(corroborated);
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
