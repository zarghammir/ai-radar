import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_STORIES_PER_DAY, readDailyCap, usageDay } from "./budget";

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
