/**
 * The brief's reading-time budget rule. ONE implementation, deliberately in a
 * module with no database imports so both the API and the fixtures can use it.
 *
 * It lived in src/api/brief.ts, which imports drizzle — importing that from
 * fixture code would ship the database layer to the browser. Copying the rule
 * instead is what produced the defect this module exists to prevent: the
 * fixtures used `continue` (skip a story that does not fit, keep looking) while
 * the server used `break` (stop at the first that does not fit). Identical
 * while every story is one minute; divergent the moment durations vary. Under a
 * ten-minute budget, [6, 7, 3] gives [6] on the server and [6, 3] from the copy.
 *
 * docs/api.md settles it: "until the cumulative reading time would exceed the
 * target" is `break`, and the server implements it.
 *
 * Generic over anything carrying `readingMinutes`, so the API's StoryCard and
 * the fixtures' StoryCard both use it without either owning the other's type.
 */
export const BRIEF_LENGTHS = ["5", "10", "all"] as const;
export type BriefLength = (typeof BRIEF_LENGTHS)[number];

/**
 * Take stories until the reading time would exceed the target.
 *
 * A time budget, not a story count: "five-minute mode" means five minutes of
 * reading. Always returns at least one story when there are any, because a
 * brief that hides a long story rather than showing one is not a brief — which
 * is also why only the FIRST story can ever push the total past the budget.
 */
export function takeWithinReadingTime<T extends { readingMinutes: number }>(
  stories: T[],
  length: BriefLength,
): T[] {
  if (length === "all") return stories;
  const target = Number(length);
  const taken: T[] = [];
  let minutes = 0;
  for (const story of stories) {
    if (taken.length > 0 && minutes + story.readingMinutes > target) break;
    taken.push(story);
    minutes += story.readingMinutes;
  }
  return taken;
}
