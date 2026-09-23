/**
 * Whether the brief is actually being delivered, as distinct from there being
 * nothing to deliver or nobody to deliver it to.
 *
 * The defect this exists for (#149): `brief_sends` records every delivery the
 * worker decided on, and NOTHING READS IT. From outside, "the push service has
 * refused us every morning this week", "nobody is subscribed" and "it went" are
 * one observable — no notification arrived. The reader concludes it was a quiet
 * week.
 *
 * That is the collector outage in miniature. During it the data was never
 * missing: `ingest_runs` recorded all twenty-six failures faithfully. THE
 * READING WAS MISSING, for four days. This is the reading for delivery.
 *
 * Modelled on source-health.ts deliberately, down to the shape of the summary
 * — but NOT down to the number, which is the one thing that must not be copied.
 */

/**
 * Consecutive failed mornings before delivery is called failing.
 *
 * TWO, WHERE SOURCE HEALTH USES THREE, and the difference is the whole reason
 * this constant is not simply imported.
 *
 * source-health.ts says its own threshold is "a time in disguise", and it is
 * right: it counts ingest passes, which land about seven times a day, so its
 * three is somewhere between nine and fourteen hours. Delivery is decided ONCE
 * PER LOCAL DAY. Copying the number would have copied the wrong duration —
 * three there is half a day, three here is THREE DAYS of a reader getting
 * nothing and assuming the news is quiet.
 *
 *   N = 1   ~24h   a single transient 500 from a push service raises an alarm
 *   N = 2   ~48h   a blip survives; two missed mornings is already a real outage
 *   N = 3   ~72h   longer than the collector outage went unnoticed
 *
 * Two. One is too eager for the same reason source-health rejects it — an alarm
 * that cries wolf is muted, and then the real one is muted with it. Three is
 * longer than this project's worst recorded silence, which is the thing this
 * ticket exists to stop repeating.
 */
export const FAILING_AFTER_CONSECUTIVE_FAILURES = 2;

/**
 * Four states, and each one exists because it names a DIFFERENT failure. A
 * state nothing can reach is not coverage, and a reader that can only ever say
 * "fine" is not a reader.
 *
 *   OK       a brief went out recently.
 *            Detects nothing — it is the absence of the others, and it is the
 *            only state that is allowed to mean "no action".
 *
 *   FAILING  the push service refused us on consecutive mornings.
 *            Detects: a rotated or malformed VAPID key, a push service
 *            rejecting this sender, every subscription dead at once, the
 *            network path out of the worker being broken.
 *
 *   IDLE     delivery ran and had nobody to send to.
 *            Detects: nobody has pressed the button, or every browser that had
 *            was retired by its push service. ACTIONABLE BUT NOT AN OUTAGE —
 *            and separated from FAILING precisely so that an instance nobody
 *            subscribed to does not read as broken, which #149 required.
 *
 * THERE IS DELIBERATELY NO "UNKNOWN" HERE, and the first draft of this file
 * had one. It meant "no delivery has ever been decided" — which is the exact
 * condition `nothing-examined` already carries in the summary below, so it was
 * a fourth state that the summary could never return. An unreachable state
 * reads as coverage and is not: it would have sat in this union being handled
 * by consumers that could never receive it, while the real never-attempted
 * case went out through a different branch.
 *
 * Emptiness is handled in exactly ONE place, and that place is the summary.
 */
export type DeliveryHealth = "OK" | "FAILING" | "IDLE";

/** Every value, so a consumer can prove it handles all of them. */
export const DELIVERY_HEALTH_STATES = ["OK", "FAILING", "IDLE"] as const;

export interface DeliveryHistory {
  /** Rows in brief_sends. A decision NOT to send is still a decision. */
  decisions: number;
  /** Failed decisions since the most recent successful send. */
  consecutiveFailures: number;
  /** The outcome of the most recent decision, or null if there is none. */
  latestOutcome: "sent" | "skipped" | "failed" | null;
}

/**
 * The state, or `null` when there is nothing to judge.
 *
 * NULL RATHER THAN A FOURTH STATE. "No delivery has ever been decided" is not
 * a health reading, it is the absence of one, and inventing a state for it
 * would put the never-attempted case inside the same union as the answers —
 * where a consumer that forgets it reads zero failures and calls it fine.
 * Zero failures out of zero attempts is arithmetically true and operationally
 * a lie, and this signature is what stops a caller reaching the count without
 * passing the branch that says there were none.
 */
export function classifyDeliveryHealth(
  history: DeliveryHistory,
  threshold: number = FAILING_AFTER_CONSECUTIVE_FAILURES,
): DeliveryHealth | null {
  if (history.decisions === 0) return null;

  // Checked BEFORE the failure count, and the order is load-bearing. A run of
  // failures followed by "nobody is subscribed" is not an outage anyone can
  // fix by fixing the sender: there is currently no one to send to, and that
  // is the thing to say. Ordered the other way, an instance whose last reader
  // unsubscribed would read as FAILING forever.
  if (history.latestOutcome === "skipped") return "IDLE";

  return history.consecutiveFailures >= threshold ? "FAILING" : "OK";
}

/**
 * The reading, shaped so that "nothing is wrong" cannot be read out of
 * "nothing was examined".
 *
 * The empty case is a separate variant rather than a zero, for the same reason
 * it is in source-health.ts: a caller that reads `failing: 0` off an empty
 * table concludes delivery is fine. Here the consumer cannot reach a count
 * without first passing the branch that says there was nothing to count.
 */
export type DeliveryHealthSummary =
  | { kind: "nothing-examined" }
  | {
      kind: "examined";
      health: DeliveryHealth;
      /** Decisions recorded, which is the denominator for everything else. */
      decisions: number;
      consecutiveFailures: number;
      threshold: number;
    };

export function summariseDeliveryHealth(
  history: DeliveryHistory,
  threshold: number = FAILING_AFTER_CONSECUTIVE_FAILURES,
): DeliveryHealthSummary {
  const health = classifyDeliveryHealth(history, threshold);
  if (health === null) return { kind: "nothing-examined" };
  return {
    kind: "examined",
    health,
    decisions: history.decisions,
    consecutiveFailures: history.consecutiveFailures,
    threshold,
  };
}
