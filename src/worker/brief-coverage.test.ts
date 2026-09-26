import { describe, expect, it } from "vitest";
import { coverageLine } from "./brief-coverage";

describe("coverageLine", () => {
  const window = { from: new Date("2026-09-26T07:30:00Z"), to: new Date("2026-09-26T12:00:00Z") };

  it("reports the fraction WITH the window bounds", () => {
    const line = coverageLine({ covered: 7, total: 10, ...window });
    expect(line).toContain("7/10");
    expect(line).toContain("70%");
    // The bounds are the point. A bare fraction cannot separate "selection is
    // wrong" from "the window rolled past what was summarised", and those two
    // need different fixes — so the number never travels without them.
    expect(line).toContain("2026-09-26T07:30:00.000Z");
    expect(line).toContain("2026-09-26T12:00:00.000Z");
  });

  /**
   * An empty window is NO DENOMINATOR, not zero coverage. Reporting 0% would
   * say the summariser failed on stories that do not exist — the same
   * absence-read-as-failure shape this project keeps removing.
   */
  it("says no denominator rather than reporting a figure", () => {
    const line = coverageLine(null);
    expect(line).toContain("no denominator");
    // Asserted on the SHAPE of a reported figure, not on the substring "0%".
    // The message deliberately explains itself with "which is not 0%", so the
    // literal check failed on the explanation — the property is that no
    // coverage FRACTION or PERCENTAGE is presented as a measurement, and these
    // are the two forms coverageLine uses when it has one.
    expect(line).not.toMatch(/\(\d+%\)/);
    expect(line).not.toMatch(/\d+\/\d+/);
  });

  it("rounds rather than printing a long fraction", () => {
    expect(coverageLine({ covered: 1, total: 3, ...window })).toContain("33%");
  });
});
