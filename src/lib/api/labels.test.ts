import { describe, expect, it } from "vitest";
import {
  ALL_CONTENT_TYPES,
  ALL_VERIFICATION_LEVELS,
  CONTENT_TYPE_LABELS,
  SOURCE_TIER_LABELS,
  TIER_KEYS,
  VERIFICATION,
  alsoReportedBy,
  storyBody,
} from "@/lib/api/labels";

describe("content type labels", () => {
  // The list comes from the DATABASE's enum, not from a list retyped here, so
  // adding a content type without a label fails this test instead of shipping a
  // blank badge. The prototype only ever drew six of the ten.
  it("covers every content type the database can store", () => {
    expect(ALL_CONTENT_TYPES.length).toBe(10);
    for (const type of ALL_CONTENT_TYPES) {
      const label = CONTENT_TYPE_LABELS[type];
      expect(label, `no label for content type ${type}`).toBeTruthy();
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no label that is only whitespace", () => {
    for (const label of Object.values(CONTENT_TYPE_LABELS)) {
      expect(label).toBe(label.trim());
    }
  });
});

describe("verification levels", () => {
  it("covers every level, each with a word and a distinct bar count", () => {
    expect(ALL_VERIFICATION_LEVELS.length).toBe(4);
    const bars = new Set<number>();
    for (const level of ALL_VERIFICATION_LEVELS) {
      const entry = VERIFICATION[level];
      expect(entry, `no entry for ${level}`).toBeDefined();
      expect(entry.word.trim().length).toBeGreaterThan(0);
      expect(entry.meaning.trim().length).toBeGreaterThan(0);
      bars.add(entry.bars);
    }
    // Four distinct counts: the meter has to be readable without the word too.
    expect(bars.size).toBe(4);
  });

  it("orders the bars by how well-sourced the story is", () => {
    expect(VERIFICATION.PRIMARY_SOURCE.bars).toBeGreaterThan(VERIFICATION.CORROBORATED.bars);
    expect(VERIFICATION.CORROBORATED.bars).toBeGreaterThan(VERIFICATION.EMERGING.bars);
    expect(VERIFICATION.EMERGING.bars).toBeGreaterThan(VERIFICATION.UNVERIFIED.bars);
  });
});

describe("storyBody", () => {
  it("prefers the AI summary when there is one", () => {
    expect(storyBody({ summary: "the summary", excerpt: "the excerpt" })).toBe("the summary");
  });

  // Phase 1 reality: every story has summary null. A client that renders
  // `summary` alone shows an empty card for every story in the brief.
  it("falls back to the excerpt when the summary is null", () => {
    expect(storyBody({ summary: null, excerpt: "the excerpt" })).toBe("the excerpt");
  });

  it("returns null when there is genuinely nothing, so the caller omits the paragraph", () => {
    expect(storyBody({ summary: null, excerpt: null })).toBeNull();
    expect(storyBody({ summary: null, excerpt: "   " })).toBeNull();
    expect(storyBody({ summary: "", excerpt: "" })).toBeNull();
  });
});

describe("alsoReportedBy", () => {
  // The awkward case: one outlet filing twice is still ONE source, because
  // `sources` is de-duplicated and sourceCount counts distinct sources.
  // "+0 others" is a sentence about nothing.
  it("renders nothing when a single outlet is the only source", () => {
    expect(alsoReportedBy({ sourceCount: 1 })).toBeNull();
  });

  it("never renders a negative or zero count", () => {
    expect(alsoReportedBy({ sourceCount: 0 })).toBeNull();
  });

  it("says 'other' in the singular for exactly one", () => {
    expect(alsoReportedBy({ sourceCount: 2 })).toBe("+1 other");
  });

  it("counts the others, not the sources", () => {
    expect(alsoReportedBy({ sourceCount: 3 })).toBe("+2 others");
    expect(alsoReportedBy({ sourceCount: 5 })).toBe("+4 others");
  });
});

describe("source tier labels", () => {
  /**
   * Derived from the DATABASE's enum, like the content types above, so adding
   * a tier without a word here fails here rather than rendering a blank beside
   * the original source on the story page — where the tier is doing real work
   * and a blank would read as "no standing" rather than "no label".
   */
  it("covers every tier the database can store", () => {
    expect(TIER_KEYS.length).toBe(5);
    for (const tier of TIER_KEYS) {
      const label = SOURCE_TIER_LABELS[tier];
      expect(label, `no label for source tier ${tier}`).toBeTruthy();
      expect(label).toBe(label.trim());
    }
  });

  /**
   * THE COLLISION THIS EXISTS TO PREVENT. The verification chip already says
   * "Primary source" and means something different — verification is about the
   * evidence for THIS story, tier is about a publisher's standing in general.
   * Both appear on the story page. If a tier ever borrowed the chip's wording,
   * a reader would reasonably read one as confirming the other.
   */
  it("shares no wording with the verification levels, which sit beside them", () => {
    const verificationWords = new Set(Object.values(VERIFICATION).map((v) => v.word.toLowerCase()));
    for (const label of Object.values(SOURCE_TIER_LABELS)) {
      expect(
        verificationWords.has(label.toLowerCase()),
        `the tier label "${label}" is also a verification word`,
      ).toBe(false);
    }
  });
});
