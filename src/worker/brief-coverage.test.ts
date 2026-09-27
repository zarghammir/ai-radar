import { describe, expect, it } from "vitest";
import { CONTENT_TYPES, type ContentType } from "@/db/schema";
import { coverageLines, coverageSlices, shownIn, type BriefCoverage } from "./brief-coverage";

const BOUNDS = {
  arrivedSince: new Date("2026-09-23T18:00:00Z"),
  activeSince: new Date("2026-09-19T18:00:00Z"),
  at: new Date("2026-09-26T18:00:00Z"),
};
const base = (over: Partial<BriefCoverage> = {}): BriefCoverage => ({
  ...BOUNDS,
  admitted: { covered: 7, total: 10 },
  defaultView: { covered: 1, total: 4 },
  defaultViewName: "built",
  ...over,
});

const card = (contentType: ContentType, summary: string | null) => ({ contentType, summary });

describe("coverageLines", () => {
  /**
   * TWO DENOMINATORS, LABELLED. An earlier draft reported only the first. The
   * page the owner opens is view-filtered — DEFAULT_VIEW is "built", five of ten
   * content types — so a figure over everything answers a question nobody asked.
   */
  it("reports everything admitted AND the view he actually opens", () => {
    const [headline] = coverageLines(base());
    expect(headline).toContain("7/10");
    expect(headline).toContain("of everything the brief admits");
    expect(headline).toContain("1/4");
    expect(headline).toContain('"built" view he opens');
  });

  /**
   * BOTH CUTOFFS, not one. Naming a single bound is how this report came to
   * print a 24-hour label on a 72-hour measurement. #171 removes the activity
   * bound, and when it does the denominator widens with no other visible
   * change — which a figure without its bounds cannot explain.
   */
  it("names both cutoffs and the instant", () => {
    const lines = coverageLines(base()).join("\n");
    expect(lines).toContain("arrivals since 2026-09-23T18:00:00.000Z");
    expect(lines).toContain("activity since 2026-09-19T18:00:00.000Z");
    expect(lines).toContain("measured at 2026-09-26T18:00:00.000Z");
  });

  it("reports the gap between them", () => {
    expect(coverageLines(base()).join("\n")).toContain("gap 45 points");
  });

  // A gap that only appears when it is bad is one nobody can calibrate.
  it("reports a negative gap rather than hiding it", () => {
    const lines = coverageLines(
      base({ admitted: { covered: 1, total: 10 }, defaultView: { covered: 4, total: 4 } }),
    ).join("\n");
    expect(lines).toContain("gap -90 points");
  });

  /**
   * THE ARM THAT DID NOT EXIST WHEN THE NULL MESSAGE WAS WRITTEN. The worker
   * catches a throw and, before this arm, left the value null — so a failure
   * printed the "seed the database" message at an instance that is seeded.
   */
  it("names a failure as a failure, never as an unseeded database", () => {
    const line = coverageLines({ error: "connect ECONNREFUSED" })[0];
    expect(line).toContain("unavailable");
    expect(line).toContain("ECONNREFUSED");
    expect(line).not.toContain("user_preferences");
    expect(line).not.toMatch(/\(\d+%\)/);
  });

  it("names the unseeded database, and does not describe an empty result", () => {
    const line = coverageLines(null)[0];
    expect(line).toContain("user_preferences");
    expect(line).not.toMatch(/\(\d+%\)/);
    expect(line).not.toMatch(/\d+\/\d+/);
  });

  it("says no denominator for an empty view inside a non-empty set", () => {
    const lines = coverageLines(base({ defaultView: null })).join("\n");
    expect(lines).toContain("7/10");
    expect(lines).toContain("no denominator");
    expect(lines).not.toContain("gap");
  });
});

/**
 * briefCoverage's USE of shownIn, which `shownIn`'s own tests cannot see.
 *
 * THIS IS THE GAP THAT WAS LOAD-BEARING AT A MERGE. With #168's rename already
 * in main and this branch carrying the fix, dropping this side of the conflict
 * would have compiled, passed every existing test, and reported five content
 * types on a view showing ten. Reverting the filter to a per-card bucket lookup
 * reddens the first assertion below and nothing else.
 *
 * THE VIEW IS CONSTRUCTED, NEVER TAKEN FROM DEFAULT_VIEW. If DEFAULT_VIEW ever
 * became "all" a test keyed on the constant would go vacuous silently — in the
 * file whose whole subject is a figure that agreed by coincidence rather than by
 * construction.
 */
describe("coverageSlices", () => {
  const cards = [card("MODEL", "s"), card("TOOL", null), card("NEWS", "s"), card("BUSINESS", null)];

  it('admits every content type on "all", so the two slices agree', () => {
    const { admitted, defaultView } = coverageSlices(cards, "all");
    expect(admitted).not.toBeNull();
    expect(defaultView?.total).toBe(admitted?.total);
    expect(defaultView?.covered).toBe(admitted?.covered);
  });

  // Stops the "all" assertion passing by shownIn having become an identity.
  it('keeps a strict, non-empty subset on "built"', () => {
    const { admitted, defaultView } = coverageSlices(cards, "built");
    expect(defaultView?.total).toBeGreaterThan(0);
    expect(defaultView?.total).toBeLessThan(admitted!.total);
    expect(defaultView?.total).toBe(2);
  });

  /**
   * No denominator, not zero. A view that admits nothing from a non-empty set is
   * not a summariser failure, and collapsing the two would blame it for an empty
   * filter — the distinction this module exists to draw, in a test written to
   * guard something else.
   */
  it("gives no denominator for a view that admits nothing", () => {
    const newsOnly = [card("NEWS", null), card("BUSINESS", null)];
    const { admitted, defaultView } = coverageSlices(newsOnly, "built");
    expect(admitted).not.toBeNull();
    expect(defaultView).toBeNull();
  });
});

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
   * TWO DELIBERATE ABSENCES, RECORDED SO THE NEXT READER INHERITS A DECISION
   * RATHER THAN RE-DERIVING WHETHER THE GAP IS INTENDED.
   *
   * 1. Nothing asserts that briefCoverage passes DEFAULT_VIEW to coverageSlices.
   *    coverageSlices above closes the larger gap — whether the view's semantics
   *    are used at all — and leaves one line, one argument. Much smaller, and
   *    still not zero. A test claiming to pin it existed here once, compared a
   *    value against itself through a conditional, and could not fail.
   *
   * 2. Nothing asserts that the coverage lines are emitted on a pass where
   *    summaries did not run. It is UNGUARDED, CORRECTLY UNGUARDED. An earlier
   *    claim that it "holds by signature" claimed more than the signature gives:
   *    the signature makes coverageLines unable to depend on summary state, but
   *    the unconditionality is src/worker/main.ts's CONTROL FLOW — straight-line,
   *    no branch — and no signature protects that. A guard would be
   *    integration-level, belonging with the compose smoke test.
   */
});
