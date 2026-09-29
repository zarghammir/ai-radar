/**
 * What a saved item may carry, restated from the save schema.
 *
 * They mirror `saveBodySchema` in src/api/reader.ts so the reader is stopped in
 * the editor with an explanation rather than after they have typed.
 * saved-limits.test.ts drives the REAL schema at each boundary, so a limit that
 * drifts looser or tighter fails there rather than in front of someone.
 *
 * #183 removed the route that once enforced this server-side, so the schema is
 * now the single definition of a save's shape rather than a second copy of it.
 * That makes this mirror MORE load-bearing, not less: nothing downstream will
 * reject an over-long note any more, so the editor is the only thing that
 * stops it.
 */
export const NOTE_MAX = 2000;
export const TAG_MAX_LENGTH = 60;
export const TAGS_MAX = 20;
