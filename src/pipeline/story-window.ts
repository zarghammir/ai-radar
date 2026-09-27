/**
 * THE PIPELINE'S TWO HORIZONS, AND THEY ARE MEASURED ON DIFFERENT CLOCKS.
 *
 * They live in a leaf module with no imports because the brief needs to read
 * them and their home modules are heavy: importing STORY_WINDOW_HOURS from
 * pipeline/run.ts pulled the source registry, every adapter and the HTTP
 * client into the brief route's bundle, and the route-cost guard caught it.
 * RANKING_WINDOW_HOURS has the same problem — rank-all.ts imports run.ts.
 * Both modules re-export their own constant, so nothing that already imported
 * one had to change.
 *
 * THE DISTINCTION MATTERS MORE THAN THE NUMBERS.
 *
 *   STORY_WINDOW_HOURS    72   CLUSTERING only. How long a story stays open
 *                              to absorb later reports of the same thing —
 *                              pipeline/run.ts, the candidate query.
 *
 *   RANKING_WINDOW_HOURS  168  RE-SCORING. Which stories rank-all.ts keeps a
 *                              current score for. THIS, not the one above, is
 *                              the set whose `score` column is maintained.
 *
 * An earlier version of the brief's docblock said run.ts re-scored inside
 * STORY_WINDOW_HOURS. It does not; that constant governs clustering alone.
 * Getting this wrong is easy and the consequence is not cosmetic: it is the
 * difference between knowing which stories carry a real score and guessing.
 *
 * AND BOTH ARE MEASURED ON PUBLICATION, via `stories.lastActivityAt`, which
 * run.ts sets from the newest source's `publishedAt`. The brief admits on
 * ARRIVAL (`raw_items.fetched_at`). So the two are not 72 versus 168 — they
 * are 72 of one clock against 168 of another, and a story can be recent on
 * one and ancient on the other. See src/api/brief.ts.
 */
export const STORY_WINDOW_HOURS = 72;
export const RANKING_WINDOW_HOURS = 7 * 24;
