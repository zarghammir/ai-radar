import { describe, expect, it } from "vitest";
import { coverageLines, type BriefCoverage } from "./brief-coverage";

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

  // An empty window is NO DENOMINATOR. Reporting zero would say the summariser
  // failed on stories that do not exist.
  it("says no denominator rather than reporting a figure", () => {
    const line = coverageLines(null)[0];
    expect(line).toContain("no denominator");
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
