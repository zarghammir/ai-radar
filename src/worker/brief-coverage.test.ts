import { describe, expect, it } from "vitest";
import { CONTENT_TYPES } from "@/db/schema";
import { coverageLines, shownIn, type BriefCoverage } from "./brief-coverage";

const WINDOW = { from: new Date("2026-09-26T07:30:00Z"), to: new Date("2026-09-26T12:00:00Z") };
const base = (over: Partial<BriefCoverage> = {}): BriefCoverage => ({
  ...WINDOW,
  window: { covered: 7, total: 10 },
  defaultView: { covered: 1, total: 4 },
  defaultViewName: "built",
  ...over,
});

describe("coverageLines", () => {
  /**
   * TWO DENOMINATORS, LABELLED, and the first draft of this file reported only
   * the first. The page the owner opens is view-filtered — DEFAULT_VIEW is
   * "built", five of ten content types — so a figure over the whole window
   * answers a question nobody asked.
   */
  it("reports the whole window AND the view he actually opens", () => {
    const [headline] = coverageLines(base());
    expect(headline).toContain("7/10");
    expect(headline).toContain("in the whole window");
    expect(headline).toContain("1/4");
    expect(headline).toContain('"built" view he opens');
  });

  it("carries the window bounds, so a fraction never travels without them", () => {
    const lines = coverageLines(base()).join("\n");
    expect(lines).toContain("2026-09-26T07:30:00.000Z");
    expect(lines).toContain("2026-09-26T12:00:00.000Z");
  });

  /**
   * The gap is the quantity that says whether the SELECTOR needs the same fix,
   * and it cannot be recovered from either figure alone. 70% of the window
   * against 25% of his screen is 45 points of spend landing where he does not
   * look.
   */
  it("reports the gap between them", () => {
    expect(coverageLines(base()).join("\n")).toContain("gap 45 points");
  });

  it("reports a negative gap rather than hiding it", () => {
    const lines = coverageLines(
      base({ window: { covered: 1, total: 10 }, defaultView: { covered: 4, total: 4 } }),
    ).join("\n");
    expect(lines).toContain("gap -90 points");
  });

  /**
   * The ONLY path to a top-level null is a missing user_preferences row. An
   * empty window returns an object with `window: null`, so this message must
   * describe an unseeded database — the earlier wording said "nothing is in the
   * reader's window", a condition that can no longer reach it.
   *
   * The previous test asserted the absence of a fraction and not the REASON,
   * which is why nothing caught the drift.
   */
  it("names the unseeded database, not an empty window", () => {
    const line = coverageLines(null)[0];
    expect(line).toContain("user_preferences");
    expect(line).not.toContain("nothing is in the reader's window");
    // The SHAPE of a reported figure, not the substring "0%" — the message
    // explains itself in prose and a literal check would fire on that.
    expect(line).not.toMatch(/\(\d+%\)/);
    expect(line).not.toMatch(/\d+\/\d+/);
  });

  /**
   * The two slices are independent: the window can hold stories while the
   * reader's own view holds none of them. Reporting that as 0% would blame the
   * summariser for an empty filter.
   */
  it("says no denominator for an empty view inside a non-empty window", () => {
    const lines = coverageLines(base({ defaultView: null })).join("\n");
    expect(lines).toContain("7/10");
    expect(lines).toContain("no denominator");
    // No gap, because there is nothing to subtract from.
    expect(lines).not.toContain("gap");
  });
});

/**
 * The non-drift claim, made checkable.
 *
 * `typesForView` has two branches: "all" returns every content type, anything
 * else filters on VIEW_OF. An in-memory reimplementation that reads VIEW_OF
 * directly loses the first — and "all" is overloaded here, being both a VIEW
 * meaning everything and a VIEW_OF bucket labelling the reporting-layer five.
 *
 * These agreed with the page only because DEFAULT_VIEW happens to be "built",
 * while the comment claimed they agreed by construction. This is the test that
 * would have caught that.
 */
describe("shownIn", () => {
  it('shows EVERY content type on the "all" view, not the reporting bucket', () => {
    const shown = CONTENT_TYPES.filter((contentType) => shownIn("all")({ contentType }));
    expect(shown).toEqual([...CONTENT_TYPES]);
  });

  it('shows a strict subset on "built"', () => {
    const shown = CONTENT_TYPES.filter((contentType) => shownIn("built")({ contentType }));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(CONTENT_TYPES.length);
    expect(shown).toContain("MODEL");
    expect(shown).not.toContain("NEWS");
  });

  /**
   * THERE IS DELIBERATELY NO TEST THAT briefCoverage USES shownIn(DEFAULT_VIEW).
   *
   * I wrote one and deleted it: it compared a value against itself through a
   * conditional on DEFAULT_VIEW and could not fail. The linkage is a single call
   * site, verified by reading it, and a test that cannot fail is worse than no
   * test because it reads as coverage of exactly the thing nobody checked.
   */
});
