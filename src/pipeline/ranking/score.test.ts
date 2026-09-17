import { describe, expect, it } from "vitest";
import { COMPONENT_LABELS, labelFor, rankStory, scoreComponentList, WEIGHTS } from "./score";
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
  // Carries no penalty, so the tests below measure what they say they measure.
  verification: "CORROBORATED" as const,
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

describe("rankStory and the analyst tier", () => {
  const src = (sourceKey: string, tier: "HIGH_QUALITY_REPORTING" | "ANALYST" | "COMMUNITY") => ({
    sourceKey,
    tier,
  });

  it("ranks an analyst-only story between a newsroom and the crowd", () => {
    const newsroom = rankStory(
      { ...base, sources: [src("reuters", "HIGH_QUALITY_REPORTING")] },
      now,
    ).score;
    const analyst = rankStory({ ...base, sources: [src("interconnects", "ANALYST")] }, now).score;
    const crowd = rankStory({ ...base, sources: [src("hn", "COMMUNITY")] }, now).score;
    expect(analyst).toBeLessThan(newsroom);
    expect(analyst).toBeGreaterThan(crowd);
  });

  it("stores the analyst signal under its own component", () => {
    // Assert the weight exists first: without this, comparing an absent
    // component to an absent weight is undefined === undefined and passes
    // while nothing has been implemented.
    expect(typeof WEIGHTS.analyst).toBe("number");
    const c = rankStory({ ...base, sources: [src("interconnects", "ANALYST")] }, now).components;
    expect(c.analyst).toBe(WEIGHTS.analyst);
    expect(c.qualityReporting).toBeUndefined();
    expect(c.communitySignal).toBeUndefined();
  });

  it("pays the newsroom weight, not the analyst one, when both are present", () => {
    const c = rankStory(
      {
        ...base,
        sources: [src("reuters", "HIGH_QUALITY_REPORTING"), src("interconnects", "ANALYST")],
      },
      now,
    ).components;
    expect(c.qualityReporting).toBe(WEIGHTS.highQualityReporting);
    expect(c.analyst).toBeUndefined();
  });

  it("still counts an analyst as a distinct source for corroboration", () => {
    const c = rankStory(
      {
        ...base,
        sources: [src("reuters", "HIGH_QUALITY_REPORTING"), src("interconnects", "ANALYST")],
      },
      now,
    ).components;
    expect(c.corroboration).toBe(WEIGHTS.corroborationPerSource);
  });

  it("names the analyst component for the why-ranked view", () => {
    expect(COMPONENT_LABELS.analyst).toBeTruthy();
  });
});

describe("rankStory and the verification penalty", () => {
  it("pushes an unverified story down, and by a negative value", () => {
    const unverified = rankStory({ ...base, verification: "UNVERIFIED" }, now);
    const corroborated = rankStory({ ...base, verification: "CORROBORATED" }, now);

    // The UI draws this as a hatched bar going the other way. A clamp at zero,
    // or a positive "reduced bonus", would silently break a screen the owner
    // has already approved, so the sign is the assertion.
    expect(unverified.components.unverifiedPenalty).toBeLessThan(0);
    expect(unverified.components.unverifiedPenalty).toBe(-WEIGHTS.unverifiedPenalty);
    expect(corroborated.components.unverifiedPenalty).toBeUndefined();
    expect(corroborated.score - unverified.score).toBeCloseTo(WEIGHTS.unverifiedPenalty, 5);
  });

  it("pushes an emerging story down by less", () => {
    const emerging = rankStory({ ...base, verification: "EMERGING" }, now);
    const corroborated = rankStory({ ...base, verification: "CORROBORATED" }, now);
    expect(emerging.components.emergingPenalty).toBe(-WEIGHTS.emergingPenalty);
    expect(corroborated.score - emerging.score).toBeCloseTo(WEIGHTS.emergingPenalty, 5);
    // Ordering is the point: unverified is worse than emerging, not equal to it.
    const unverified = rankStory({ ...base, verification: "UNVERIFIED" }, now);
    expect(unverified.score).toBeLessThan(emerging.score);
    expect(emerging.score).toBeLessThan(corroborated.score);
  });

  it("leaves a primary source and a corroborated story unpenalised", () => {
    for (const verification of ["PRIMARY_SOURCE", "CORROBORATED"] as const) {
      const c = rankStory({ ...base, verification }, now).components;
      expect(c.unverifiedPenalty).toBeUndefined();
      expect(c.emergingPenalty).toBeUndefined();
    }
  });

  it("still sums to the score once a component is negative", () => {
    // The additive promise has to survive a negative term, which is the whole
    // reason this component is worth a test rather than a constant.
    const r = rankStory({ ...base, verification: "UNVERIFIED" }, now);
    const sum = Object.values(r.components).reduce((a, b) => a + b, 0);
    expect(Math.abs(r.score - sum)).toBeLessThan(0.11);
    expect(Object.values(r.components).some((v) => v < 0)).toBe(true);
  });

  it("sums correctly when the penalty outweighs everything else", () => {
    // An all-positive story sums to more than any single component, so a sum
    // assertion over one cannot tell addition from a coincidence. Here the
    // penalty drags the total BELOW its largest term, and past zero.
    const weak = rankStory(
      {
        ...base,
        lastActivityAt: new Date("2026-09-10T11:00:00Z"),
        contentType: "DISCUSSION",
        sources: [{ sourceKey: "hn", tier: "COMMUNITY" }],
        verification: "UNVERIFIED",
      },
      now,
    );
    const values = Object.values(weak.components);
    const sum = values.reduce((a, b) => a + b, 0);
    expect(Math.abs(weak.score - sum)).toBeLessThan(0.11);
    expect(weak.score).toBeLessThan(Math.max(...values));
    expect(weak.score).toBeLessThan(0);
  });

  it("names both penalties for the why-ranked panel", () => {
    expect(COMPONENT_LABELS.unverifiedPenalty).toBe("Unverified claim");
    expect(COMPONENT_LABELS.emergingPenalty).toBe("Not yet corroborated");
  });
});

describe("every component the ranker can emit has a label", () => {
  /**
   * Collected by RUNNING the ranker, not by reading it.
   *
   * The previous version parsed the source for `c.x =` assignments, and
   * `c["x"] = 5` walked straight past it — a test that parses source is only
   * as complete as its grammar. Two things replace it: ComponentKey makes an
   * unlabelled component fail to compile in any spelling, and this exercises
   * every branch and compares the two sets outright.
   */
  const emitted = (): Set<string> => {
    const at = new Date("2026-09-16T11:00:00Z");
    const runs: Parameters<typeof rankStory>[0][] = [
      { ...base, sources: [{ sourceKey: "openai", tier: "PRIMARY" }] },
      { ...base, sources: [reuters] },
      { ...base, sources: [{ sourceKey: "interconnects", tier: "ANALYST" }] },
      { ...base, sources: [{ sourceKey: "hn", tier: "COMMUNITY" }] },
      { ...base, sources: [reuters, verge] },
      { ...base, topicKeys: ["openai"], userTopicKeys: ["openai"] },
      { ...base, engagementPoints: 100, engagementComments: 20 },
      { ...base, verification: "UNVERIFIED" },
      { ...base, verification: "EMERGING" },
      { ...base, contentType: "RELEASE", lastActivityAt: at },
    ];
    const keys = new Set<string>();
    for (const input of runs) {
      for (const key of Object.keys(rankStory(input, now).components)) keys.add(key);
    }
    return keys;
  };

  it("emits exactly the components the label map names", () => {
    const keys = emitted();
    const labelled = Object.keys(COMPONENT_LABELS);
    // Tied to the map rather than a hard-coded number, so a branch this matrix
    // stops reaching becomes a red instead of a shrug.
    expect(keys.size).toBe(labelled.length);
    expect([...keys].sort()).toEqual([...labelled].sort());
  });

  it("labels every one of them, and falls back visibly rather than blankly", () => {
    for (const key of emitted()) expect(labelFor(key)).toBe(COMPONENT_LABELS[key as never]);
    // The net under the compiler: never reached in production, never blank.
    expect(labelFor("somethingNobodyLabelled")).toBe("somethingNobodyLabelled");
  });
});

describe("scoreComponentList", () => {
  it("labels every component and keeps the values", () => {
    const list = scoreComponentList({ recency: 13.1, primarySource: 20, unverifiedPenalty: -6 });
    expect(list).toEqual([
      { key: "recency", label: COMPONENT_LABELS.recency, value: 13.1 },
      { key: "primarySource", label: COMPONENT_LABELS.primarySource, value: 20 },
      { key: "unverifiedPenalty", label: "Unverified claim", value: -6 },
    ]);
  });

  it("falls back to the key when a component has no label", () => {
    // A component added to the model without a label must still render, and
    // must be visibly unlabelled rather than silently dropped.
    const list = scoreComponentList({ somethingNew: 3 });
    expect(list).toEqual([{ key: "somethingNew", label: "somethingNew", value: 3 }]);
  });

  it("returns an empty list for a story that has not been ranked", () => {
    expect(scoreComponentList({})).toEqual([]);
  });
});
