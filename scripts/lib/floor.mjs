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
 * Throws if anything is already on the floor. Call it after a count or a
 * state check and BEFORE the first click, focus, fill or keypress that
 * assumes that count.
 */
export function bailIfBroken(floor) {
  if (floor.length > 0) throw new FloorBroken(floor[floor.length - 1]);
}

/**
 * The top-level handler. A FloorBroken is a REPORTED failure, not a crash, so
 * it must not print a stack trace — the floor already says what happened, and
 * a stack over the top of it is what sent the reader to Playwright last time.
 */
export function isFloorBail(error) {
  return error instanceof FloorBroken;
}
