/**
 * How many stories a brief shows. ONE implementation, deliberately in a module
 * with no database imports so both the API and the fixtures can use it.
 *
 * It lived in src/api/brief.ts, which imports drizzle — importing that from
 * fixture code would ship the database layer to the browser.
 *
 * THIS USED TO BE A READING-TIME BUDGET and it is now a COUNT. The owner
 * specified it directly: "for the 5 minutes ... you have to pick only 5 news
 * stories", "for the 10 minutes ... 10, maybe 12 stories", "for the full
 * story, just have them."
 *
 * WHY THAT IS A BETTER RULE AND NOT JUST A DIFFERENT ONE. The old rule
 * accumulated each story's `readingMinutes` and stopped when the next one would
 * exceed the target. Every one of those minute values is an ESTIMATE the app
 * makes about a reader it has never met, so the total was a guess presented as
 * a measurement — and the count it produced varied with that guess rather than
 * with anything the reader chose. A count is a promise the app can actually
 * keep.
 *
 * TEN, NOT TWELVE. He said "10, maybe 12". Ten is inside his range and it is
 * the number the stored setting, the label and the selection all say at once;
 * twelve would have meant a control labelled one number, storing another, and
 * returning a third. "Maybe 12" reads as an upper bound he would tolerate, not
 * a thing he asked for.
 */
export const BRIEF_LENGTHS = ["5", "10", "all"] as const;
export type BriefLength = (typeof BRIEF_LENGTHS)[number];

/**
 * How many stories each setting shows. A TOTAL Record, so adding a length
 * without deciding its count is a compile error rather than a brief that
 * silently shows everything.
 *
 * `Infinity` rather than a large number: "all" means all, and a literal like
 * 999 would be a cap nobody had chosen, waiting to surprise someone on the day
 * a brief got big. The candidate limit in brief.ts is the real ceiling and it
 * is stated in one place.
 */
export const BRIEF_STORY_COUNTS: Record<BriefLength, number> = {
  "5": 5,
  "10": 10,
  all: Infinity,
};

/**
 * Take the first N, where N is what the reader chose.
 *
 * ORDER IS THE CALLER'S JOB. This takes a prefix, so whatever the caller sorted
 * by is what "the first five" means — see recentStories, which sorts newest
 * first.
 */
export function takeBriefStories<T>(stories: T[], length: BriefLength): T[] {
  const count = BRIEF_STORY_COUNTS[length];
  return Number.isFinite(count) ? stories.slice(0, count) : stories;
}
