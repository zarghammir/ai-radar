import { describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { readDeliveryStatus } from "./delivery";
import {
  classifyDeliveryHealth,
  DELIVERY_HEALTH_STATES,
  FAILING_AFTER_CONSECUTIVE_FAILURES,
  summariseDeliveryHealth,
  type DeliveryHealth,
  type DeliveryHistory,
} from "./delivery-health";

const history = (over: Partial<DeliveryHistory> = {}): DeliveryHistory => ({
  decisions: 5,
  consecutiveFailures: 0,
  latestOutcome: "sent",
  ...over,
});

describe("classifyDeliveryHealth", () => {
  it("is OK after a send", () => {
    expect(classifyDeliveryHealth(history())).toBe("OK");
  });

  it("is FAILING at the threshold, not one short of it", () => {
    const n = FAILING_AFTER_CONSECUTIVE_FAILURES;
    expect(
      classifyDeliveryHealth(history({ consecutiveFailures: n - 1, latestOutcome: "failed" })),
    ).toBe("OK");
    expect(
      classifyDeliveryHealth(history({ consecutiveFailures: n, latestOutcome: "failed" })),
    ).toBe("FAILING");
  });

  /**
   * The requirement #149 was filed with: an instance nobody subscribed to must
   * not read as broken. Without this branch it reads as whatever its failure
   * count happens to be, and the owner chases a sender that is working.
   */
  it("is IDLE when the last morning had nobody to send to", () => {
    expect(classifyDeliveryHealth(history({ latestOutcome: "skipped" }))).toBe("IDLE");
  });

  /**
   * THE ORDER IS LOAD-BEARING. A run of failures followed by "nobody is
   * subscribed" is not an outage anyone can fix by fixing the sender. Ordered
   * the other way, an instance whose last reader unsubscribed reads FAILING
   * forever and the alarm never clears.
   */
  it("prefers IDLE over FAILING when the last reader has gone", () => {
    expect(
      classifyDeliveryHealth(history({ consecutiveFailures: 99, latestOutcome: "skipped" })),
    ).toBe("IDLE");
  });

  // Never attempted is not a health reading. Returning a state here is how
  // zero-failures-out-of-zero-attempts gets reported as fine.
  it("answers null when nothing has ever been decided", () => {
    expect(classifyDeliveryHealth(history({ decisions: 0 }))).toBeNull();
  });

  /**
   * COMPLETENESS FROM THE OTHER END.
   *
   * Asserted against the exported list rather than by counting the cases
   * above: a test that walks its own examples cannot notice a state nobody
   * wrote an example for. If a fourth state is added and nothing can produce
   * it, this fails — which is exactly how the first draft's unreachable
   * "UNKNOWN" would have been caught had it survived.
   */
  it("can actually reach every state it declares", () => {
    const reached = new Set<DeliveryHealth>(
      [
        history(),
        history({
          consecutiveFailures: FAILING_AFTER_CONSECUTIVE_FAILURES,
          latestOutcome: "failed",
        }),
        history({ latestOutcome: "skipped" }),
      ]
        .map((h) => classifyDeliveryHealth(h))
        .filter((s): s is DeliveryHealth => s !== null),
    );
    expect([...reached].sort()).toEqual([...DELIVERY_HEALTH_STATES].sort());
  });
});

describe("summariseDeliveryHealth", () => {
  // The floor. A caller must pass a branch that says there was nothing to
  // count before it can reach a count.
  it("says nothing was examined rather than reporting zero failures", () => {
    const summary = summariseDeliveryHealth(history({ decisions: 0 }));
    expect(summary.kind).toBe("nothing-examined");
    expect(summary).not.toHaveProperty("failing");
    expect(summary).not.toHaveProperty("health");
  });

  it("carries the threshold, so the number is not a figure to take on trust", () => {
    const summary = summariseDeliveryHealth(
      history({ consecutiveFailures: 2, latestOutcome: "failed" }),
    );
    expect(summary.kind).toBe("examined");
    if (summary.kind === "examined") {
      expect(summary.health).toBe("FAILING");
      expect(summary.threshold).toBe(FAILING_AFTER_CONSECUTIVE_FAILURES);
      expect(summary.decisions).toBe(5);
    }
  });
});

/**
 * The threshold is a TIME in disguise, and the mistake this guards is copying
 * source-health's number without its cadence: delivery is decided once per
 * local day, ingest lands about seven times a day. Three there is half a day;
 * three here would be three days of silence — longer than the collector
 * outage went unnoticed.
 */
describe("the threshold", () => {
  it("is two mornings, which is under the worst silence this project has had", () => {
    expect(FAILING_AFTER_CONSECUTIVE_FAILURES).toBe(2);
    expect(FAILING_AFTER_CONSECUTIVE_FAILURES).toBeGreaterThan(1);
    expect(FAILING_AFTER_CONSECUTIVE_FAILURES).toBeLessThan(4);
  });
});

/**
 * What the surface may carry.
 *
 * brief_sends.detail is free text copied out of a third party's HTTP body, and
 * push_subscriptions.endpoint is an address anyone holding it can push to. The
 * route is unauthenticated, so this asserts the KEY SET rather than trusting a
 * reviewer to notice a field being added later.
 *
 * THE TWO HALVES ARE NOT REDUNDANT, AND THE KEY SET IS THE LOAD-BEARING ONE.
 * Do not relax it on the grounds that the substring checks cover it — they do
 * not. A detail re-homed under a friendlier key, `{ "message": "HTTP 500: Bad
 * Gateway" }`, contains none of the three needles and would sail through every
 * `not.toContain` below while putting a third party's text back on an
 * unauthenticated response. The substrings are the BACKSTOP, for a leak that
 * arrives inside a key that is already allowed.
 */
describe("the surface does not leak", () => {
  const fakeDb = (row: Record<string, unknown>) =>
    ({ execute: async () => [row] }) as unknown as Db;

  it("serves counts and a state, never an endpoint or stored error text", async () => {
    const status = await readDeliveryStatus(
      fakeDb({
        decisions: 3,
        consecutive_failures: 2,
        latest_outcome: "failed",
        latest_day: "2026-09-22",
        latest_delivered: 0,
        latest_failed: 1,
        subscriptions: 1,
      }),
    );

    expect(Object.keys(status).sort()).toEqual(
      ["lastDecisionDay", "lastDelivered", "lastFailed", "subscriptions", "summary"].sort(),
    );
    const serialised = JSON.stringify(status);
    expect(serialised).not.toContain("endpoint");
    expect(serialised).not.toContain("detail");
    expect(serialised).not.toContain("https://");
  });

  // The unhealthy reading rendered end to end, not just the happy one.
  it("renders the FAILING state from real row shapes", async () => {
    const status = await readDeliveryStatus(
      fakeDb({
        decisions: 3,
        consecutive_failures: 2,
        latest_outcome: "failed",
        latest_day: "2026-09-22",
        latest_delivered: 0,
        latest_failed: 1,
        subscriptions: 1,
      }),
    );
    expect(status.summary.kind).toBe("examined");
    if (status.summary.kind === "examined") expect(status.summary.health).toBe("FAILING");
    expect(status.lastFailed).toBe(1);
  });

  it("renders the empty instance as nothing-examined, not as healthy", async () => {
    const status = await readDeliveryStatus(
      fakeDb({
        decisions: 0,
        consecutive_failures: 0,
        latest_outcome: null,
        latest_day: null,
        latest_delivered: 0,
        latest_failed: 0,
        subscriptions: 0,
      }),
    );
    expect(status.summary.kind).toBe("nothing-examined");
  });
});
