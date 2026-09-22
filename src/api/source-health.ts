/**
 * Whether a source is actually working, as distinct from having nothing to say.
 *
 * The defect this exists for (#38): `import-ai` returns 403 to GitHub runners
 * on every hosted run — Substack refusing a datacenter IP, not a broken adapter
 * — and the run goes green with "1 failed" in a log nobody reads. **A source
 * dead for a week and a genuinely quiet week produce the same output.**
 *
 * The exit code is deliberately not changed. A scheduled run that goes red
 * every time one publisher blocks a datacenter is a notification people mute,
 * and a real outage then goes unseen along with it. This makes the two states
 * distinguishable rather than making one of them louder.
 */

/**
 * Consecutive failures before a source is called failing.
 *
 * The schedule in ingest.yml is a cron of every thirtieth minute, so this
 * threshold is a time in disguise:
 *
 * ⚠️ THE WALL-CLOCK COLUMN BELOW ASSUMES THE DECLARED HALF-HOURLY CRON, WHICH
 * GITHUB DOES NOT KEEP. Measured 2026-09-17 to 09-22: about 7 passes a day, so
 * each figure is roughly SEVEN TIMES LONGER in practice — N = 3 is most of a day,
 * not ninety minutes. The threshold is still the right shape, because it counts
 * PASSES rather than time; the note is here so nobody reads the column as a
 * promise about how quickly a source is flagged.
 *
 *   N = 1   30 minutes   any single 500 from any of eighteen feeds flags it
 *   N = 3   90 minutes   a blip survives; a real outage is caught before noon
 *   N = 6   3 hours
 *   N = 48  24 hours     a source dead overnight is still reported healthy
 *
 * Three. The failure this ticket is about — a publisher refusing a datacenter
 * IP — fails *every* run, so any threshold catches it and the only question is
 * how fast. What sets the floor is the other direction: with eighteen sources
 * polled every half hour, a threshold of one would flag a feed for a single
 * transient 500, and an alert that cries wolf is muted, which is the exact
 * failure mode the unchanged exit code is protecting against.
 *
 * Ninety minutes of uninterrupted failure is long enough that no single blip
 * reaches it and short enough that a source which died overnight is already
 * flagged when someone looks in the morning.
 */
export const UNHEALTHY_AFTER_CONSECUTIVE_FAILURES = 3;

/**
 * Three states, not two. A source that has never completed a run is not
 * healthy and is not failing — it is unknown, and calling it healthy is the
 * absence-shaped defect this whole ticket is about, in the reporting rather
 * than in the data.
 */
export type SourceHealth = "OK" | "FAILING" | "UNKNOWN";

export interface SourceRunHistory {
  /** Runs that finished, successfully or not. In-flight runs are neither. */
  completedRuns: number;
  /** Failures recorded since the most recent success. */
  consecutiveFailures: number;
}

export function classifySourceHealth(
  history: SourceRunHistory,
  threshold: number = UNHEALTHY_AFTER_CONSECUTIVE_FAILURES,
): SourceHealth {
  if (history.completedRuns === 0) return "UNKNOWN";
  return history.consecutiveFailures >= threshold ? "FAILING" : "OK";
}

/**
 * A summary over many sources, shaped so that "nothing is wrong" cannot be
 * read out of "nothing was examined".
 *
 * Returning `{ failing: 0 }` for an empty input is arithmetically correct and
 * is the shape that has bitten this repo repeatedly: a caller reads zero
 * failures and concludes the catalogue is healthy, when in fact no row was
 * looked at. The empty case is a different variant here, so a consumer cannot
 * reach a count without first passing the branch that says there were none.
 */
export type SourceHealthSummary =
  | { kind: "nothing-examined" }
  | { kind: "examined"; examined: number; ok: number; failing: number; unknown: number };

export function summariseSourceHealth(states: readonly SourceHealth[]): SourceHealthSummary {
  if (states.length === 0) return { kind: "nothing-examined" };
  return {
    kind: "examined",
    examined: states.length,
    ok: states.filter((s) => s === "OK").length,
    failing: states.filter((s) => s === "FAILING").length,
    unknown: states.filter((s) => s === "UNKNOWN").length,
  };
}
