import { appendFileSync } from "node:fs";
import type { SummaryRunResult } from "@/llm/run-summaries";
import type { BriefRunResult } from "@/notify/run-brief";

/**
 * One line per optional feature, where the owner will actually see it.
 *
 * THE DEFECT THIS EXISTS FOR. #162 made the on state REACHABLE; it did not make
 * the current state LEGIBLE. Each optional feature announces itself once, by
 * `console.log`, into a scheduled job's log that nobody opens — and "summaries
 * are off" is a SUCCESSFUL run, so the failure alarm never fires on it. If the
 * owner's key is empty, misnamed, or forwarded to the wrong job, he finds out
 * the way he found out last time: nothing happens, for an unknown number of
 * weeks.
 *
 * A step summary turns that into one run. It costs nothing and it is the
 * difference between a silent month and a glance.
 */

/**
 * Anything in double quotes, replaced.
 *
 * The reason strings are written to name VARIABLES rather than values, and one
 * of them breaks that rule: an unrecognised provider reports `LLM_PROVIDER is
 * "antropic"`, which interpolates the value of a repository secret. Harmless in
 * that instance and not a rule to depend on — the next reason string nobody
 * checks could carry a key. So the quoted part never reaches the report, and
 * the variable's NAME, which is the actionable half, always does.
 */
export function withoutQuotedValues(text: string): string {
  return text.replace(/"[^"]*"/g, "<value>");
}

/** `summaries: OFF — LLM_PROVIDER is none` and the like. */
export function summaryLines(
  summaries: SummaryRunResult | { error: string },
  brief: BriefRunResult | { error: string },
): string[] {
  const lines: string[] = [];

  if ("error" in summaries) {
    lines.push(`- **summaries: ERROR** — ${withoutQuotedValues(summaries.error)}`);
  } else if (summaries.skipped) {
    lines.push(`- **summaries: OFF** — ${withoutQuotedValues(summaries.skipped)}`);
  } else {
    lines.push(
      `- **summaries: ON** — ${summaries.succeeded} written, ${summaries.failed} failed, ${summaries.budgetAtStart} of today's budget available at the start`,
    );
  }

  if ("error" in brief) {
    lines.push(`- **delivery: ERROR** — ${withoutQuotedValues(brief.error)}`);
  } else if (brief.outcome === "not-due") {
    // "not yet 07:30" is the normal state on most passes and is not an OFF.
    // Reporting it as off would train the reader to ignore the line.
    const detail = brief.detail ?? "no reason recorded";
    const waiting = detail.startsWith("not yet");
    lines.push(
      waiting
        ? `- **delivery: ON** — waiting for the brief time (${withoutQuotedValues(detail)})`
        : `- **delivery: OFF** — ${withoutQuotedValues(detail)}`,
    );
  } else {
    lines.push(
      `- **delivery: ${brief.outcome.toUpperCase()}** — ${brief.delivered} delivered, ${brief.failed} failed, ${brief.storyCount} stories`,
    );
  }

  return lines;
}

/**
 * Append to the run's step summary, if there is one.
 *
 * NEVER THROWS and never requires the variable to exist: the same file runs on
 * a laptop and in Actions, and a worker that died because it could not write a
 * report would be a worse bug than the invisibility it fixes.
 */
export function writeStepSummary(lines: string[], env: Partial<Record<string, string>>): void {
  const path = env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(path, `### This pass\n${lines.join("\n")}\n`);
  } catch {
    // Not worth failing a pass over, and not worth a line in the log either:
    // the console output above already carries the same facts.
  }
}
