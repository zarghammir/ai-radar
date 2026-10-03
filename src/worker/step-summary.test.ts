import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { summaryLines, withoutQuotedValues, writeStepSummary } from "./step-summary";

const OFF = {
  skipped: "LLM_PROVIDER is none",
  budgetAtStart: 0,
  passBudget: 0,
  attempted: 0,
  succeeded: 0,
  failed: 0,
};
// The two budget figures are the shape since #192: the day has twenty left and
// THIS pass was allowed six of them. They are reported separately because
// "the day is spent" and "this pass has had its share" look identical with
// only one number, and an operator reading the step summary has to tell them
// apart.
const ON = {
  skipped: null,
  budgetAtStart: 20,
  passBudget: 6,
  attempted: 6,
  succeeded: 6,
  failed: 0,
};
describe("withoutQuotedValues", () => {
  /**
   * The reason strings are written to name VARIABLES, not values — and exactly
   * one breaks that rule. `readLlmSettings` reports an unrecognised provider as
   * `LLM_PROVIDER is "antropic"`, interpolating the value of a repository
   * secret into a string this PR now publishes.
   *
   * Harmless for that one value, and not a property to depend on: the next
   * reason string nobody audits could carry a key. So the quoted part never
   * reaches the report, and the variable NAME — the actionable half — always
   * does.
   */
  it("strips a quoted value while keeping the variable name", () => {
    expect(
      withoutQuotedValues('LLM_PROVIDER is "antropic", which is not one of none, ollama'),
    ).toBe("LLM_PROVIDER is <value>, which is not one of none, ollama");
  });

  it("leaves a reason that names only a variable untouched", () => {
    expect(withoutQuotedValues("ANTHROPIC_API_KEY is not set")).toBe(
      "ANTHROPIC_API_KEY is not set",
    );
  });

  it("strips every quoted run, not just the first", () => {
    expect(withoutQuotedValues('a "one" b "two" c')).toBe("a <value> b <value> c");
  });
});

/**
 * ONE FEATURE, ONE LINE. These used to assert a second line for brief delivery
 * beside each summaries line. #189 removed that feature, and the assertions went
 * with it rather than being weakened to tolerate its absence — a test that
 * stopped checking a second line while still passing two arguments would have
 * kept passing through the whole removal.
 */
describe("summaryLines", () => {
  it("says OFF and names the variable to set", () => {
    const [summaries] = summaryLines(OFF);
    expect(summaries).toContain("summaries: OFF");
    expect(summaries).toContain("LLM_PROVIDER");
  });

  it("says ON with the counts when it ran", () => {
    const [summaries] = summaryLines(ON);
    expect(summaries).toContain("summaries: ON");
    expect(summaries).toContain("6 written");
    // Both budget figures, because one of them alone cannot say whether a pass
    // that wrote six of a remaining twenty stopped early or stopped on purpose.
    expect(summaries).toContain("6 allowed this pass");
    expect(summaries).toContain("20 left today");
  });

  /**
   * Waiting for the brief time is the state on most passes and is NOT off.
   * Reporting it as OFF would put a false alarm on nearly every run, and a line
   * that cries wolf is a line the reader stops reading — which is the failure
   * this whole report exists to avoid.
   */
  it("reports a thrown feature as ERROR rather than as off", () => {
    const [summaries] = summaryLines({ error: "database is unavailable" });
    expect(summaries).toContain("summaries: ERROR");
  });

  it("redacts a quoted value on its way into the report", () => {
    const [summaries] = summaryLines({ ...OFF, skipped: 'LLM_PROVIDER is "sk-secret-looking"' });
    expect(summaries).not.toContain("sk-secret-looking");
    expect(summaries).toContain("<value>");
  });
});

describe("writeStepSummary", () => {
  it("writes nothing and does not throw when the variable is absent", () => {
    expect(() => writeStepSummary(["- a"], {})).not.toThrow();
  });

  it("appends to the file the runner names", () => {
    const path = join(mkdtempSync(join(tmpdir(), "step-")), "summary.md");
    writeStepSummary(["- **summaries: OFF** — LLM_PROVIDER is none"], {
      GITHUB_STEP_SUMMARY: path,
    });
    expect(readFileSync(path, "utf8")).toContain("summaries: OFF");
  });

  // A laptop, a broken path, a read-only mount. A worker that died because it
  // could not write a report would be a worse bug than the invisibility it fixes.
  it("does not throw when the path cannot be written", () => {
    expect(() =>
      writeStepSummary(["- a"], { GITHUB_STEP_SUMMARY: "/nonexistent-dir/nope/summary.md" }),
    ).not.toThrow();
  });
});
