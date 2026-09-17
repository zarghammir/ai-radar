/**
 * Stopping a browser script the moment its floor breaks.
 *
 * THE DEFECT THIS EXISTS FOR, found by the reviewer on PR #74. A script
 * measures something, records an honest floor failure — "expected 3 radios on
 * /settings, found 0" — and then carries on to interact with the page. The
 * first interaction throws a Playwright timeout, the process dies there, and
 * the floor is never printed, because floors are reported at the END.
 *
 * So CI says `locator.focus: Timeout 30000ms exceeded` and points at
 * Playwright, when the answer was already computed and sitting in a variable:
 * the page under test was not the page that loaded. The diagnostic built for
 * precisely that case was defeated by ORDERING.
 *
 * The rule: once the floor is broken, everything after it is measuring
 * something else. Bail before the first interaction, print what was measured,
 * and let the floor say why.
 */
export class FloorBroken extends Error {}

/**
 * Throws if THIS SECTION has put something on the floor. Call it after a count
 * or a state check and BEFORE the first click, focus, fill or keypress that
 * assumes that count.
 *
 * `since` is the floor's length when the section began, and it is the whole
 * point. The first version bailed on a non-empty array, which meant a failure
 * in an EARLIER, UNRELATED block ended the entire script: one synthetic
 * failure in verify-today's first block abandoned Save, Hide and the
 * four-viewport sweep, and the report then named a single failure, which reads
 * as one thing being wrong. It could never produce a false green — the floor
 * was still non-empty and the run still exited 1 — but it cost exactly the
 * diagnostic yield this helper exists to protect.
 *
 * The rationale holds only for its own case: once THIS check has failed, the
 * interactions below it are measuring something else. A failure three blocks
 * ago says nothing about this one.
 */
export function bailIfBroken(floor, since = 0) {
  if (floor.length > since) throw new FloorBroken(floor[floor.length - 1]);
}

/** The mark to pass back as `since`. Read it at the top of a section. */
export function sectionStart(floor) {
  return floor.length;
}

/**
 * The top-level handler. A FloorBroken is a REPORTED failure, not a crash, so
 * it must not print a stack trace — the floor already says what happened, and
 * a stack over the top of it is what sent the reader to Playwright last time.
 */
export function isFloorBail(error) {
  return error instanceof FloorBroken;
}
