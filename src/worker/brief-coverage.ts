import type { Db } from "@/db/client";
import { briefWindow, storiesInWindow } from "@/api/brief";
import { userPreferences } from "@/db/schema";

/**
 * How much of the brief the reader would open carries a summary.
 *
 * THIS IS THE ACCEPTANCE NUMBER FOR THE TARGETING FIX, and it is reported on
 * every pass rather than measured once. "The summariser ran" was true on the
 * pass that wrote seventeen summaries and put ONE of them in a ten-story brief;
 * this is the number that was not, and a figure nobody has to remember to
 * measure is the only kind that survives.
 *
 * It cannot be a test. It is a fact about the live corpus at an instant, and
 * the window it is computed over MOVES — so the report carries the bounds
 * beside the fraction, because a bare fraction cannot separate "selection is
 * wrong" from "the window rolled past what was summarised", and those need
 * different fixes.
 *
 * Returns null rather than a zero when there is nothing to judge: an empty
 * window is no denominator, not 0% coverage.
 */
export interface BriefCoverage {
  covered: number;
  total: number;
  from: Date;
  to: Date;
}

export async function briefCoverage(db: Db, now: Date): Promise<BriefCoverage | null> {
  const [prefs] = await db
    .select({ briefTime: userPreferences.briefTime, timezone: userPreferences.timezone })
    .from(userPreferences)
    .limit(1);
  if (!prefs) return null;

  const window = briefWindow(now, prefs.briefTime, prefs.timezone);
  const cards = await storiesInWindow(db, window);
  if (cards.length === 0) return null;

  return {
    covered: cards.filter((card) => card.summary !== null).length,
    total: cards.length,
    from: window.from,
    to: window.to,
  };
}

/** The report line, or the honest absence of one. */
export function coverageLine(coverage: BriefCoverage | null): string {
  if (coverage === null) {
    return "- **brief coverage: no denominator** — nothing is in the reader's window, which is not 0%";
  }
  const pct = Math.round((coverage.covered / coverage.total) * 100);
  return (
    `- **brief coverage: ${coverage.covered}/${coverage.total}** (${pct}%) of the stories in the reader's window carry a summary` +
    ` — window ${coverage.from.toISOString()} → ${coverage.to.toISOString()}`
  );
}
