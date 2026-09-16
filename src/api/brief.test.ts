import { describe, expect, it } from "vitest";
import { briefWindow, parseBriefLength, takeWithinReadingTime } from "./brief";
import type { StoryCard } from "./stories";

const card = (readingMinutes: number, slug = `s${readingMinutes}`) =>
  ({ slug, readingMinutes }) as StoryCard;

describe("briefWindow", () => {
  it("starts at today's brief time once it has passed", () => {
    const now = new Date("2026-09-16T12:00:00Z");
    const w = briefWindow(now, "07:30", "UTC");
    expect(w.from.toISOString()).toBe("2026-09-16T07:30:00.000Z");
    expect(w.to).toEqual(now);
  });

  it("starts at yesterday's brief time when today's has not arrived", () => {
    const now = new Date("2026-09-16T06:00:00Z");
    expect(briefWindow(now, "07:30", "UTC").from.toISOString()).toBe("2026-09-15T07:30:00.000Z");
  });

  it("reads the brief time in the reader's zone, not in UTC", () => {
    // 08:00 in New York is 12:00Z, so 07:30 local has passed and is 11:30Z.
    const now = new Date("2026-09-16T12:00:00Z");
    expect(briefWindow(now, "07:30", "America/New_York").from.toISOString()).toBe(
      "2026-09-16T11:30:00.000Z",
    );
  });

  it("uses yesterday's offset across a daylight-saving change", () => {
    // New York moves to EDT at 02:00 on 2026-03-08. At 07:00 EDT the brief
    // time has not arrived, so the window starts at 07:30 the previous day —
    // which was still EST, an hour further from UTC. Subtracting 24 hours from
    // today's instant would land 11:30Z and be an hour wrong.
    const now = new Date("2026-03-08T11:00:00Z");
    expect(briefWindow(now, "07:30", "America/New_York").from.toISOString()).toBe(
      "2026-03-07T12:30:00.000Z",
    );
  });

  it("handles a zone ahead of UTC", () => {
    // 21:00Z is 06:00 on the 17th in Tokyo, so that day's 07:30 is still an
    // hour away and the window runs from the 16th's, which is 22:30Z on the
    // 15th. My first expectation here was a day out, and the second assertion
    // is what caught it: a window cannot start after the moment it ends.
    const now = new Date("2026-09-16T21:00:00Z");
    const w = briefWindow(now, "07:30", "Asia/Tokyo");
    expect(w.from.toISOString()).toBe("2026-09-15T22:30:00.000Z");
    expect(w.from.getTime()).toBeLessThan(now.getTime());
  });

  it("rejects a brief time or a zone it cannot use", () => {
    const now = new Date("2026-09-16T12:00:00Z");
    expect(() => briefWindow(now, "7:30", "UTC")).toThrow(/briefTime/);
    expect(() => briefWindow(now, "25:00", "UTC")).toThrow(/briefTime/);
    expect(() => briefWindow(now, "07:30", "Mars/Olympus")).toThrow(/time zone/);
  });
});

describe("parseBriefLength", () => {
  it("falls back to the reader's own default", () => {
    expect(parseBriefLength(null, "5")).toBe("5");
    expect(parseBriefLength("all", "10")).toBe("all");
  });
  it("rejects anything else", () => {
    expect(() => parseBriefLength("7", "10")).toThrow(/length/);
  });
});

describe("takeWithinReadingTime", () => {
  it("fills a five-minute budget and stops", () => {
    const taken = takeWithinReadingTime([card(2), card(2), card(3), card(1)], "5");
    expect(taken.map((s) => s.readingMinutes)).toEqual([2, 2]);
  });

  it("returns everything for all", () => {
    expect(takeWithinReadingTime([card(9), card(9)], "all")).toHaveLength(2);
  });

  it("always returns one story even when it is longer than the budget", () => {
    // A brief that shows nothing because the best story is long is not a brief.
    expect(takeWithinReadingTime([card(40), card(1)], "5")).toHaveLength(1);
  });

  it("returns nothing when there is nothing", () => {
    expect(takeWithinReadingTime([], "5")).toEqual([]);
  });
});
