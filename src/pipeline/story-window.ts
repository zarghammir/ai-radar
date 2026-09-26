/**
 * How long a story stays open to absorb later reports of the same thing —
 * and, because of that, how long the pipeline keeps its score up to date.
 *
 * IT LIVES IN A LEAF MODULE ON PURPOSE. It used to sit in pipeline/run.ts, and
 * the brief imported it from there so the two could not drift. That was right
 * about the duplication and wrong about the cost: run.ts pulls the whole
 * ingestion pipeline — the source registry, every adapter, the HTTP client —
 * so a single numeric constant dragged all of it into the brief route's
 * bundle. The route-cost guard caught it, which is exactly what that guard is
 * for.
 *
 * So the number moved down here, where it has no imports at all and anything
 * may read it. run.ts re-exports it, so nothing that already imported it from
 * there had to change.
 *
 * TWO CONSUMERS, AND THE SECOND IS THE NON-OBVIOUS ONE:
 *
 *   src/pipeline/run.ts   clustering, and the set of stories it re-scores.
 *   src/api/brief.ts      the brief's recency bound. Past this horizon a
 *                         story's stored score is no longer maintained, so
 *                         ordering by it would rank on a stale number.
 *
 * Those two must be the SAME number or the brief sorts by scores the pipeline
 * has stopped updating. That is why it is one constant and not two.
 */
export const STORY_WINDOW_HOURS = 72;
