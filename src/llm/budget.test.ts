import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_STORIES_PER_DAY, passAllowance, readDailyCap, usageDay } from "./budget";

describe("readDailyCap", () => {
  it("takes the documented default when unset", () => {
    expect(readDailyCap({})).toBe(DEFAULT_MAX_STORIES_PER_DAY);
  });

  it("reads a number", () => {
    expect(readDailyCap({ LLM_MAX_STORIES_PER_DAY: "5" })).toBe(5);
  });

  it("allows an explicit zero, which switches spending off", () => {
    expect(readDailyCap({ LLM_MAX_STORIES_PER_DAY: "0" })).toBe(0);
  });

  // The direction of the mistake is the point. An operator who typed a cap
  // wrong was trying to LIMIT spending, so an unreadable value must fail
  // closed; falling back to the default spends money they did not authorise.
  it("fails closed to zero on a value that is not a whole number", () => {
    expect(readDailyCap({ LLM_MAX_STORIES_PER_DAY: "twenty" })).toBe(0);
    expect(readDailyCap({ LLM_MAX_STORIES_PER_DAY: "-5" })).toBe(0);
    expect(readDailyCap({ LLM_MAX_STORIES_PER_DAY: "2.5" })).toBe(0);
  });
});

describe("usageDay", () => {
  it("is the UTC calendar day", () => {
    expect(usageDay(new Date("2026-09-21T23:59:59Z"))).toBe("2026-09-21");
    expect(usageDay(new Date("2026-09-22T00:00:01Z"))).toBe("2026-09-22");
  });
});

// The default in code and the value in .env.example are two copies of one
// number. Pinned together so editing the file people actually copy cannot
// leave the guard on a different figure than the documentation.
describe(".env.example", () => {
  it("documents the same default cap this module uses", () => {
    const env = readFileSync(".env.example", "utf8");
    const match = env.match(/^LLM_MAX_STORIES_PER_DAY=(\d+)$/m);
    expect(match, "LLM_MAX_STORIES_PER_DAY is not documented in .env.example").not.toBeNull();
    expect(Number(match![1])).toBe(DEFAULT_MAX_STORIES_PER_DAY);
  });

  it("ships with the provider switched off", () => {
    const env = readFileSync(".env.example", "utf8");
    expect(env).toMatch(/^LLM_PROVIDER=none$/m);
  });
});

describe("passAllowance", () => {
  const THREE_HOURLY = 180;
  const at = (hour: number, minute = 30) => new Date(Date.UTC(2026, 9, 3, hour, minute));

  /** One UTC day of passes, spending what each is allowed. */
  function dayOfPasses(cap: number, intervalMinutes: number) {
    const allowed: number[] = [];
    let remaining = cap;
    for (let minute = 30; minute < 24 * 60; minute += intervalMinutes) {
      const now = new Date(Date.UTC(2026, 9, 3, 0, minute));
      const take = passAllowance(remaining, now, intervalMinutes);
      allowed.push(take);
      remaining -= take;
    }
    return { allowed, remaining };
  }

  /**
   * THE DEFECT, STATED AS AN ASSERTION. #192 measured 3 of 22 stories under 24
   * hours old carrying a summary, because the first passes of the day spent the
   * whole cap on what had arrived by then.
   *
   * THIS IS THE TEST THAT A PLAIN `return remaining` FAILS, and the one below
   * is not: a day's total of twenty is true of the unpaced version too. The
   * quantity that changes across the defect is what the FIRST pass takes.
   */
  it("does not let the first pass of the day spend the whole cap", () => {
    expect(passAllowance(20, at(0), THREE_HOURLY)).toBe(3);
    expect(passAllowance(20, at(0), THREE_HOURLY)).toBeLessThan(20);
  });

  it("still spends the whole cap over the day, with nothing reserved", () => {
    const { allowed, remaining } = dayOfPasses(20, THREE_HOURLY);
    expect(allowed).toEqual([3, 3, 3, 3, 2, 2, 2, 2]);
    expect(allowed.reduce((a, b) => a + b, 0)).toBe(20);
    expect(remaining).toBe(0);
  });

  /**
   * A skipped pass must not strand its share. The divisor is passes LEFT, not
   * passes elapsed, so the next pass absorbs what the missing one did not take
   * — which is why nothing has to be carried forward anywhere.
   */
  it("gives a skipped pass's share to the next one", () => {
    // Nothing spent by midday, which is four three-hourly passes missed.
    expect(passAllowance(20, at(12), THREE_HOURLY)).toBe(5);
  });

  it("lets the last pass of the day spend everything left", () => {
    expect(passAllowance(7, at(23, 50), THREE_HOURLY)).toBe(7);
  });

  /**
   * A deployment that collects once a day has exactly one chance to spend, and
   * pacing it would leave most of the cap unused for ever. The rule handles it
   * without a special case, because one pass left means a divisor of one.
   */
  it("hands the whole cap to a worker that runs once a day", () => {
    expect(passAllowance(20, at(6, 0), 24 * 60)).toBe(20);
  });

  it("never exceeds what the day has left", () => {
    expect(passAllowance(1, at(0), THREE_HOURLY)).toBe(1);
    expect(passAllowance(0, at(0), THREE_HOURLY)).toBe(0);
    expect(passAllowance(-5, at(0), THREE_HOURLY)).toBe(0);
  });

  // The documented fallback: an interval that cannot be divided by is not a
  // reason to spend nothing, and not a reason to throw inside a paid run.
  it("falls back to the remaining budget on an unusable interval", () => {
    expect(passAllowance(20, at(0), 0)).toBe(20);
    expect(passAllowance(20, at(0), Number.NaN)).toBe(20);
  });
});
