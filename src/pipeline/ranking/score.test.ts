import { describe, expect, it } from "vitest";
import {
  COMPONENT_LABELS,
  LEGACY_COMPONENT_LABELS,
  labelFor,
  rankStory,
  scoreComponentList,
  WEIGHTS,
} from "./score";
import { deriveVerification } from "../clustering/verification";

const now = new Date("2026-09-16T12:00:00Z");
const reuters = { sourceKey: "reuters", tier: "HIGH_QUALITY_REPORTING" as const };
const verge = { sourceKey: "verge", tier: "HIGH_QUALITY_REPORTING" as const };
const base = {
  // Age is scored from first sighting since the decay change. `now` is 12:00, so
  // BASE IS ONE HOUR OLD and carries a small decay — about 1.4% of its score.
  // An earlier version of this comment claimed base was age zero; it is not, and
  // CI caught it through `ageDecay` being -0.2 rather than 0. Use `atZeroAge`
  // below wherever a test needs decay out of the way.
  firstSeenAt: new Date("2026-09-16T11:00:00Z"),
  contentType: "NEWS" as const,
  sources: [verge],
  topicKeys: [] as string[],
  userTopicKeys: [] as string[],
  // Carries no penalty, so the tests below measure what they say they measure.
  verification: "CORROBORATED" as const,
};
/**
 * The same story with no age at all, for assertions about STRUCTURE.
 *
 * Multiplicative decay scales every component including the penalties, so a
 * test measuring a penalty's magnitude against the total must remove age from
 * the picture or it measures both at once.
 */
const atZeroAge = { ...base, firstSeenAt: now };

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
  /**
   * THE DECAY IS MULTIPLICATIVE, and this asserts the property rather than the
   * direction. An additive term could satisfy "older scores less"; only a
   * multiplier halves the WHOLE score at the half-life, which is the thing the
   * measured fresh-to-pack gap of 18.18 against a cap of 14 said was required.
   */
  it("halves the whole score at the half-life", () => {
    const atZero = rankStory(atZeroAge, now).score;
    const halfLife = new Date(now.getTime() - WEIGHTS.ageHalfLifeHours * 3_600_000);
    const aged = rankStory({ ...base, firstSeenAt: halfLife }, now).score;
    // Components round to one decimal, so the halved total can be off by that
    // much. A tighter tolerance would fail on correct arithmetic.
    expect(aged).toBeCloseTo(atZero / 2, 0);
  });

  it("costs nothing at all at age zero", () => {
    expect(rankStory(atZeroAge, now).components.ageDecay).toBe(0);
  });

  /**
   * The cost SCALES WITH THE SCORE, which is what makes a big story fade slowly
   * in absolute terms and a weak one vanish. An additive term would take the
   * same points off both, which is the defect this replaced.
   */
  it("takes more from a bigger story than a smaller one at the same age", () => {
    const day = new Date(now.getTime() - 24 * 3_600_000);
    const big = rankStory(
      { ...base, firstSeenAt: day, sources: [{ sourceKey: "openai", tier: "PRIMARY" }] },
      now,
    );
    const small = rankStory(
      { ...base, firstSeenAt: day, sources: [{ sourceKey: "hn", tier: "COMMUNITY" }] },
      now,
    );
    expect(big.score).toBeGreaterThan(small.score);
    expect(Math.abs(big.components.ageDecay)).toBeGreaterThan(Math.abs(small.components.ageDecay));
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
  it("never produces a NaN score from an unparseable first-seen date", () => {
    const r = rankStory({ ...base, firstSeenAt: new Date("not a date") }, now);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(Number.isFinite(r.components.ageDecay)).toBe(true);
    // Treated as "just now", so the decay costs nothing rather than poisoning
    // every component with NaN. Asserted as exactly 0, which is why the
    // implementation special-cases a zero cost instead of negating it into -0.
    expect(r.components.ageDecay).toBe(0);
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
    // Measured at ZERO AGE, because multiplicative decay scales the penalty
    // along with everything else: at one hour old the gap is 5.9 rather than 6,
    // which is correct and would make this assertion a test of the decay.
    const u0 = rankStory({ ...atZeroAge, verification: "UNVERIFIED" }, now);
    const c0 = rankStory({ ...atZeroAge, verification: "CORROBORATED" }, now);
    expect(c0.score - u0.score).toBeCloseTo(WEIGHTS.unverifiedPenalty, 5);
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
        firstSeenAt: new Date("2026-09-10T11:00:00Z"),
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
      { ...base, contentType: "RELEASE", firstSeenAt: at },
    ];
    const keys = new Set<string>();
    for (const input of runs) {
      for (const key of Object.keys(rankStory(input, now).components)) keys.add(key);
    }
    return keys;
  };

  /**
   * TWO DIRECTIONS, AND THEY GUARD DIFFERENT THINGS. The original asserted exact
   * equality, which was right until a component was retired: `recency` still has
   * a label because rows scored before the decay change still carry one and the
   * story page renders them, so equality would now fail on correct code.
   *
   * Split rather than weakened. The reader-facing invariant — no emitted
   * component reaches a screen unlabelled — is unchanged and absolute. The other
   * direction is now "every label with no producer is DECLARED", which is
   * stricter than a shrug: a label that quietly loses its producer is still red.
   */
  it("labels every component it emits", () => {
    const labelled = new Set(Object.keys(COMPONENT_LABELS));
    for (const key of emitted()) expect(labelled).toContain(key);
  });

  it("declares every label that nothing produces any more", () => {
    const keys = emitted();
    const orphaned = Object.keys(COMPONENT_LABELS).filter((k) => !keys.has(k));
    expect(orphaned.sort()).toEqual([...LEGACY_COMPONENT_LABELS].sort());
  });

  // The matrix must keep reaching a branch for each live component, which is
  // what the original count was protecting.
  it("reaches every live component", () => {
    const live = Object.keys(COMPONENT_LABELS).filter((k) => !LEGACY_COMPONENT_LABELS.includes(k));
    expect(emitted().size).toBe(live.length);
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
