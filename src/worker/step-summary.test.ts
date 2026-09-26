import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { summaryLines, withoutQuotedValues, writeStepSummary } from "./step-summary";

const OFF = {
  skipped: "LLM_PROVIDER is none",
  budgetAtStart: 0,
  attempted: 0,
  succeeded: 0,
  failed: 0,
};
const ON = { skipped: null, budgetAtStart: 20, attempted: 6, succeeded: 6, failed: 0 };
const WAITING = {
  outcome: "not-due" as const,
  detail: "not yet 07:30 where the reader is",
  localDay: "2026-09-26",
  storyCount: 0,
  attempted: 0,
  delivered: 0,
  failed: 0,
};
const NO_KEY = {
  outcome: "not-due" as const,
  detail: "NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set",
  localDay: "",
  storyCount: 0,
  attempted: 0,
  delivered: 0,
  failed: 0,
};
const SENT = {
  outcome: "sent" as const,
  detail: null,
  localDay: "2026-09-26",
  storyCount: 6,
  attempted: 1,
  delivered: 1,
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

describe("summaryLines", () => {
  it("says OFF and names the variable to set", () => {
    const [summaries] = summaryLines(OFF, WAITING);
    expect(summaries).toContain("summaries: OFF");
    expect(summaries).toContain("LLM_PROVIDER");
  });

  it("says ON with the counts when it ran", () => {
    const [summaries] = summaryLines(ON, SENT);
    expect(summaries).toContain("summaries: ON");
    expect(summaries).toContain("6 written");
  });

  /**
   * Waiting for the brief time is the state on most passes and is NOT off.
   * Reporting it as OFF would put a false alarm on nearly every run, and a line
   * that cries wolf is a line the reader stops reading — which is the failure
   * this whole report exists to avoid.
   */
  it("distinguishes waiting for the brief time from being switched off", () => {
    expect(summaryLines(OFF, WAITING)[1]).toContain("delivery: ON");
    expect(summaryLines(OFF, NO_KEY)[1]).toContain("delivery: OFF");
    expect(summaryLines(OFF, NO_KEY)[1]).toContain("VAPID");
  });

  it("reports a thrown feature as ERROR rather than as off", () => {
    const [summaries, delivery] = summaryLines(
      { error: "database is unavailable" },
      { error: "boom" },
    );
    expect(summaries).toContain("summaries: ERROR");
    expect(delivery).toContain("delivery: ERROR");
  });

  it("redacts a quoted value on its way into the report", () => {
    const [summaries] = summaryLines(
      { ...OFF, skipped: 'LLM_PROVIDER is "sk-secret-looking"' },
      WAITING,
    );
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
