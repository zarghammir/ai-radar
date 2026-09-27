import type { Db } from "@/db/client";
import type { ContentType } from "@/db/schema";
import { briefHorizon, rankedSince, recentStories } from "@/api/brief";
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
 * So a figure over everything the brief admits answers "how much is
 * summarised" when the defect is "how much of the brief HE OPENS is". The
 * instrument was pointed at the superset — the same mistake as the bug it was
 * built to measure, one level up.
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
 * ── THE WORD "WINDOW" IS GONE FROM THIS FILE, DELIBERATELY ─────────────────
 *
 * #168 removed the brief's admission window: there is no longer a period the
 * brief covers, there are TWO CUTOFFS it admits by, and a field called `window`
 * described something that had stopped existing. Renamed rather than left as
 * vocabulary the owner reads — and renamed wholly, because half a rename is
 * what broke a build earlier in the day.
 *
 * A null slice is NO DENOMINATOR, never zero: nothing admitted and nothing
 * summarised are different facts.
 */
export interface CoverageSlice {
  covered: number;
  total: number;
}

export interface BriefCoverage {
  /**
   * BOTH CUTOFFS, from the same exported functions the query uses, because the
   * figure is meaningless without the shape of its denominator — and because
   * naming one of two is how this report was wrong before.
   *
   * `arrivedSince` is the product judgement about recency; `activeSince` is a
   * necessity, since `score` is only maintained inside RANKING_WINDOW_HOURS and
   * ordering by a stale one would rank an admitted story dead last. #171 is
   * filed to remove the second, and when it lands this denominator WIDENS with
   * no other visible change — which is exactly the kind of movement a figure
   * without its bounds cannot explain.
   */
  arrivedSince: Date;
  activeSince: Date;
  at: Date;
  /** Every story the brief admits, whatever its type. */
  admitted: CoverageSlice | null;
  /** Only the types the reader's DEFAULT view shows — the page he opens. */
  defaultView: CoverageSlice | null;
  defaultViewName: BriefView;
}

/**
 * Whether a story appears on a given view — the page's own rule, exported so it
 * can be pinned.
 *
 * Exists as a named function because the "all" branch is the one an in-memory
 * reimplementation loses, and a test can only guard a branch it can reach.
 */
export function shownIn(view: BriefView): (card: { contentType: ContentType }) => boolean {
  const types = typesForView(view);
  return (card) => types.includes(card.contentType);
}

function slice(cards: { summary: string | null }[]): CoverageSlice | null {
  if (cards.length === 0) return null;
  return { covered: cards.filter((card) => card.summary !== null).length, total: cards.length };
}

/**
 * The two slices, from cards and a view. PURE, and extracted so the composition
 * can be tested rather than only its parts.
 *
 * THE GAP THIS CLOSES was named and left open in an earlier commit: `shownIn`
 * had tests, and briefCoverage's USE of it had none, so reverting the filter to
 * a per-card bucket lookup would have compiled, passed every test, and reported
 * five content types on a view showing ten. Taking the view as an argument is
 * what lets a test reach the `view === "all"` branch, where the two differ.
 *
 * It takes the view honestly rather than as an injected seam: briefCoverage is
 * the only production caller and passes DEFAULT_VIEW. Compare the warning at
 * src/worker/ingest.ts:26 about a test-only argument on a production path —
 * this is not that, because the argument is load-bearing for the one caller.
 */
export function coverageSlices(
  cards: { summary: string | null; contentType: ContentType }[],
  view: BriefView,
): { admitted: CoverageSlice | null; defaultView: CoverageSlice | null } {
  return { admitted: slice(cards), defaultView: slice(cards.filter(shownIn(view))) };
}

export async function briefCoverage(db: Db, now: Date): Promise<BriefCoverage | null> {
  const [prefs] = await db
    .select({ briefTime: userPreferences.briefTime, timezone: userPreferences.timezone })
    .from(userPreferences)
    .limit(1);
  // Reading preferences at all is what makes an unseeded database
  // distinguishable from a quiet one. See coverageLines' null arm.
  if (!prefs) return null;

  // ONE query, split in memory through the SAME FUNCTION the route's SQL filter
  // is built from. A second `recentStories` call with `types` would be a second
  // trip for a subset of rows already in hand.
  //
  // `typesForView` rather than `VIEW_OF` directly, and the difference is not
  // cosmetic: typesForView has two branches, `view === "all"` returning every
  // content type and anything else filtering on VIEW_OF. An earlier draft read
  // VIEW_OF itself, which reimplemented the second and lost the first — and
  // "all" is OVERLOADED here, being both a VIEW meaning everything and a
  // VIEW_OF bucket labelling the reporting-layer five. So the figure agreed
  // with the page only because of which constant happened to be set, while the
  // comment claimed it agreed BY CONSTRUCTION.
  const cards = await recentStories(db);

  return {
    // From the same functions the query bounds itself with, not from copied
    // constants — two values that merely happen to match is how this report
    // came to print a 24-hour label on a 72-hour measurement.
    arrivedSince: briefHorizon(now),
    activeSince: rankedSince(now),
    at: now,
    ...coverageSlices(cards, DEFAULT_VIEW),
    defaultViewName: DEFAULT_VIEW,
  };
}

/**
 * What the reporter has to say about, including the case where it failed.
 *
 * THREE STATES, MIRRORING summaryLines. #164 gave the feature reporters a
 * `{ error }` arm for the same reason: a thing that did not run and a thing
 * that BROKE are different facts, and collapsing them means the report names
 * the wrong one.
 */
export type CoverageReport = BriefCoverage | null | { error: string };

function describe(label: string, value: CoverageSlice | null): string {
  if (value === null) return `${label}: no denominator`;
  return `${value.covered}/${value.total} (${Math.round((value.covered / value.total) * 100)}%) ${label}`;
}

/** The report lines, or the honest absence of them. */
export function coverageLines(coverage: CoverageReport): string[] {
  // THE ERROR ARM EXISTS BECAUSE THE null ARM HAD TWO PRODUCERS.
  //
  // The message below names its single true cause — no user_preferences row —
  // and that was correct for exactly one commit. The worker's call site catches
  // a throw and, before this arm, left `coverage` as null: so a database blip,
  // or reportingWindow raising on a stored timezone Intl cannot parse (a real
  // path, guarded in src/notify/window.ts for the same reason), printed "seed
  // the database" at an instance that is seeded, while the actual reason went to
  // console.error — the log this file's own header says nobody opens.
  if (coverage !== null && "error" in coverage) {
    return [
      `- **brief coverage: unavailable** — computing it failed: ${coverage.error}. This says nothing about how many stories carry a summary`,
    ];
  }

  if (coverage === null) {
    // THE ONLY PATH HERE IS A MISSING user_preferences ROW. An empty result
    // returns an object with `admitted: null` instead, so this message must not
    // describe one — "the database is not seeded" and "nothing arrived" want
    // different actions, which is the distinction this module exists to draw.
    return [
      "- **brief coverage: cannot be computed** — there is no user_preferences row, so this instance has no reader settings yet. Seed the database; this is not a statement about summaries",
    ];
  }

  const lines = [
    `- **brief coverage** — ${describe("of everything the brief admits", coverage.admitted)}; ` +
      `${describe(`on the "${coverage.defaultViewName}" view he opens`, coverage.defaultView)}`,
    // BOTH bounds, because the brief admits by two and #171 removes one of them.
    `  admits arrivals since ${coverage.arrivedSince.toISOString()} and activity since ${coverage.activeSince.toISOString()}, measured at ${coverage.at.toISOString()}`,
  ];

  // The gap is the quantity that says whether the SELECTOR needs the same fix,
  // and it is not recoverable from either figure on its own.
  if (coverage.admitted && coverage.defaultView) {
    const whole = coverage.admitted.covered / coverage.admitted.total;
    const seen = coverage.defaultView.covered / coverage.defaultView.total;
    lines.push(
      `  gap ${Math.round((whole - seen) * 100)} points — positive means the spend is landing off his default screen`,
    );
  }
  return lines;
}
