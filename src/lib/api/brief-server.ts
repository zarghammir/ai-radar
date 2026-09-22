import { getDb } from "@/db/client";
import { briefWindow, storiesInWindow, sweepSummary, takeWithinReadingTime } from "@/api/brief";
import { getPreferences } from "@/api/reader";
import { USING_FIXTURES } from "@/lib/api/client";
import { fixtureBrief } from "@/lib/api/fixtures";
import { typesForView, type BriefView } from "@/lib/api/views";
import type { BriefLengthParam, BriefResponse } from "@/lib/api/types";

/**
 * How the Today page gets its brief, ON THE SERVER.
 *
 * It reads the database directly rather than fetching /api/brief over HTTP.
 * An earlier version called fetch("/api/brief") from a server component, and a
 * relative URL has no base on the server — so every load threw and the page
 * rendered its "cannot reach your stories" state while the route itself was
 * answering 200 with a perfectly good empty brief.
 *
 * That defect was invisible against fixtures, which never touch the network,
 * and it would have looked like an empty database to anyone reading the screen
 * rather than the state marker. A server component fetching its own API is a
 * round trip through the process it is already inside; this is the shorter and
 * more honest path.
 *
 * It calls the SAME functions the route calls, so the page and the API cannot
 * disagree about what a brief is.
 */
export async function loadBrief(
  length: BriefLengthParam,
  view: BriefView = "all",
): Promise<BriefResponse> {
  if (USING_FIXTURES) return fixtureBrief(length, view);

  const db = getDb();
  const prefs = await getPreferences(db);
  const window = briefWindow(new Date(), prefs.briefTime, prefs.timezone);
  const ranked = await storiesInWindow(db, window, { types: typesForView(view) });
  const stories = takeWithinReadingTime(ranked, length);
  // Read whether the brief is empty or not: a reader asking "why so few?" on a
  // short brief deserves the same facts as one asking "why none?".
  const sweep = await sweepSummary(db, window.from);

  return {
    window: {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      briefTime: window.briefTime,
      timezone: window.timezone,
    },
    length,
    view,
    // Both describe the response, not the window.
    count: stories.length,
    readingMinutes: stories.reduce((n, s) => n + s.readingMinutes, 0),
    stories: stories as unknown as BriefResponse["stories"],
    sweep,
  };
}
