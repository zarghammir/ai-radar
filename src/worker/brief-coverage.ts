import type { Db } from "@/db/client";
import { briefWindow, storiesInWindow } from "@/api/brief";
import { userPreferences } from "@/db/schema";
import { DEFAULT_VIEW } from "@/lib/api/brief-length";
import { VIEW_OF, type BriefView } from "@/lib/api/views";

/**
 * How much of the brief the reader would open carries a summary.
 *
 * THIS IS THE ACCEPTANCE NUMBER FOR THE TARGETING FIX, reported on every pass
 * rather than measured once. "The summariser ran" was true on the pass that
 * wrote seventeen summaries and put ONE of them in a ten-story brief; this is
 * the number that was not, and a figure nobody has to remember to measure is
 * the only kind that survives.
 *
 * ── IT REPORTS TWO DENOMINATORS, AND THE FIRST DRAFT REPORTED THE WRONG ONE ──
 *
 * The page the owner opens is view-filtered. `src/app/page.tsx` resolves
 * `parseView(cookie) ?? DEFAULT_VIEW`, DEFAULT_VIEW is "built", and that view
 * shows five of the ten content types — MODEL, TOOL, RELEASE, PAPER, RESEARCH.
 * NEWS, DISCUSSION, TREND, BUSINESS and REGULATION are not on his default
 * screen at all.
 *
 * So a figure computed over the whole window answers "how much of the window
 * carries a summary" when the defect is "how much of the brief HE OPENS carries
 * one". The instrument was pointed at the superset — the same mistake as the
 * bug it was built to measure, one level up.
 *
 * Both are reported because THE GAP BETWEEN THEM IS THE INTERESTING QUANTITY:
 * it is what says whether the selector needs the same treatment, and it cannot
 * be recovered from either figure alone.
 *
 * ── AND THE RULE THAT MAKES ONE SETTING SAFE TO IGNORE AND THE OTHER NOT ──
 *
 *   LENGTH TRUNCATES.  takeWithinReadingTime breaks on the first story that
 *                      would overrun, so every length is a PREFIX. Covering the
 *                      front of the list covers the front of every length.
 *
 *   VIEW FILTERS.      typesForView keeps a SUBSEQUENCE. The front of the whole
 *                      is not the front of the part: if one story in three is
 *                      "built", the tenth he sees sits near unfiltered position
 *                      thirty.
 *
 * Both live in the reader's browser for the same reason (#94, #91). Only one of
 * them can be ignored by a server-side selector, and it is not obvious which
 * until you ask whether the operation is a prefix.
 *
 * A null slice is NO DENOMINATOR, never zero: an empty window and a window
 * whose stories are all unsummarised are different facts.
 */
export interface CoverageSlice {
  covered: number;
  total: number;
}

export interface BriefCoverage {
  from: Date;
  to: Date;
  /** Every story in the window, whatever its type. */
  window: CoverageSlice | null;
  /** Only the types the reader's DEFAULT view shows — the page he opens. */
  defaultView: CoverageSlice | null;
  defaultViewName: BriefView;
}

function slice(cards: { summary: string | null }[]): CoverageSlice | null {
  if (cards.length === 0) return null;
  return { covered: cards.filter((card) => card.summary !== null).length, total: cards.length };
}

export async function briefCoverage(db: Db, now: Date): Promise<BriefCoverage | null> {
  const [prefs] = await db
    .select({ briefTime: userPreferences.briefTime, timezone: userPreferences.timezone })
    .from(userPreferences)
    .limit(1);
  if (!prefs) return null;

  const window = briefWindow(now, prefs.briefTime, prefs.timezone);
  // ONE query, filtered in memory by the SAME map the route's SQL filter is
  // built from. A second `storiesInWindow` call with `types` would be a second
  // trip for a subset of rows already in hand, and keying the split on VIEW_OF
  // rather than on a copied list is what stops the two definitions drifting.
  const cards = await storiesInWindow(db, window);

  return {
    from: window.from,
    to: window.to,
    window: slice(cards),
    defaultView: slice(cards.filter((card) => VIEW_OF[card.contentType] === DEFAULT_VIEW)),
    defaultViewName: DEFAULT_VIEW,
  };
}

function describe(label: string, value: CoverageSlice | null): string {
  if (value === null) return `${label}: no denominator`;
  return `${value.covered}/${value.total} (${Math.round((value.covered / value.total) * 100)}%) ${label}`;
}

/** The report lines, or the honest absence of them. */
export function coverageLines(coverage: BriefCoverage | null): string[] {
  if (coverage === null) {
    return [
      "- **brief coverage: no denominator** — nothing is in the reader's window, which is not the same as none of it being summarised",
    ];
  }

  const lines = [
    `- **brief coverage** — ${describe("in the whole window", coverage.window)}; ` +
      `${describe(`on the "${coverage.defaultViewName}" view he opens`, coverage.defaultView)}`,
    `  window ${coverage.from.toISOString()} → ${coverage.to.toISOString()}`,
  ];

  // The gap is the quantity that says whether the SELECTOR needs the same fix,
  // and it is not recoverable from either figure on its own.
  if (coverage.window && coverage.defaultView) {
    const whole = coverage.window.covered / coverage.window.total;
    const seen = coverage.defaultView.covered / coverage.defaultView.total;
    lines.push(
      `  gap ${Math.round((whole - seen) * 100)} points — positive means the spend is landing off his default screen`,
    );
  }
  return lines;
}
