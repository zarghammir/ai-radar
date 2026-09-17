/**
 * What a saved item may carry, restated from the route's own schema.
 *
 * They mirror `saveBodySchema` in src/api/reader.ts so the reader is stopped in
 * the editor with an explanation rather than by a rejected write after they
 * have typed. saved-limits.test.ts drives the REAL schema at each boundary, so
 * a limit that drifts looser (a rejected write) or tighter (a capability
 * quietly withdrawn) fails there rather than in front of someone.
 */
export const NOTE_MAX = 2000;
export const TAG_MAX_LENGTH = 60;
export const TAGS_MAX = 20;
