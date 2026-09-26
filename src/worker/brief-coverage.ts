import type { Db } from "@/db/client";
import type { ContentType } from "@/db/schema";
import { briefWindow, storiesInWindow } from "@/api/brief";
import { userPreferences } from "@/db/schema";
import { DEFAULT_VIEW } from "@/lib/api/brief-length";
import { typesForView, type BriefView } from "@/lib/api/views";

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

/**
 * Whether a story appears on a given view — the page's own rule, exported so it
 * can be pinned.
 *
 * Exists as a named function because the "all" branch is the one an in-memory
 * reimplementation loses, and a test can only guard a branch it can reach. The
 * production call passes DEFAULT_VIEW; the test passes both, which is what
 * makes the non-drift claim checkable rather than asserted.
 */
export function shownIn(view: BriefView): (card: { contentType: ContentType }) => boolean {
  const types = typesForView(view);
  return (card) => types.includes(card.contentType);
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
  // ONE query, filtered in memory through the SAME FUNCTION the route's SQL
  // filter is built from. A second `storiesInWindow` call with `types` would be
  // a second trip for a subset of rows already in hand.
  //
  // `typesForView` RATHER THAN `VIEW_OF` DIRECTLY, and the difference is not
  // cosmetic. typesForView has two branches: `view === "all"` returns every
  // content type, anything else filters on VIEW_OF. An earlier draft read
  // VIEW_OF itself, which reimplemented the second branch and not the first —
  // and "all" is OVERLOADED in this codebase, being both a VIEW meaning
  // everything and a VIEW_OF bucket labelling the reporting-layer five.
  //
  // So if DEFAULT_VIEW ever became "all", the page would show ten types and
  // this figure would report those five. It agreed with the page only because
  // of which constant happened to be set, while the comment claimed it agreed
  // BY CONSTRUCTION. Calling the function makes that true: one definition,
  // special case included.
  const cards = await storiesInWindow(db, window);

  return {
    from: window.from,
    to: window.to,
    window: slice(cards),
    defaultView: slice(cards.filter(shownIn(DEFAULT_VIEW))),
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
    // THE ONLY PATH HERE IS A MISSING user_preferences ROW. An empty window
    // returns an object with `window: null` instead, so this message described
    // a condition it can no longer be reached by — and "the database is not
    // seeded" and "nothing arrived this morning" want different actions, which
    // is the distinction this module's own header exists to draw.
    return [
      "- **brief coverage: cannot be computed** — there is no user_preferences row, so this instance has no brief window yet. Seed the database; this is not a statement about summaries",
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
