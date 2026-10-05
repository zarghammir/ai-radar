import { describe, expect, it } from "vitest";
import { briefWindow, parseBriefLength, rerankForReader, takeBriefStories } from "./brief";

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

describe("takeBriefStories", () => {
  const card = (readingMinutes: number) => ({ readingMinutes });

  /**
   * THE RULE CHANGED, SO THESE ASSERTIONS CHANGED WITH IT. They used to pin a
   * reading-time budget: take stories until the accumulated minutes would
   * exceed the target. The owner specified a count instead — "for the 5
   * minutes ... pick only 5 news stories" — so the old assertions are now
   * WRONG rather than merely stale, and pinning them would pin a rule the
   * product no longer has.
   */
  it("takes exactly five for the short brief", () => {
    const stories = Array.from({ length: 9 }, (_, i) => card(i + 1));
    expect(takeBriefStories(stories, "5")).toHaveLength(5);
  });

  it("takes exactly ten for the long brief", () => {
    // TWO-MINUTE STORIES, NOT ONE-MINUTE ONES, and that detail is the test.
    // With one-minute stories a ten-minute budget also returns ten, so the old
    // rule and the new one agree and this assertion cannot tell them apart —
    // it stayed green while the control was in place. At two minutes each the
    // old rule returns five and the new one returns ten.
    const stories = Array.from({ length: 30 }, () => card(2));
    expect(takeBriefStories(stories, "10")).toHaveLength(10);
  });

  it("IGNORES reading time entirely, which is the whole change", () => {
    // Five forty-minute stories. The old rule returned ONE of these, because
    // the first alone blew a five-minute budget. The new rule returns five.
    const stories = Array.from({ length: 5 }, () => card(40));
    expect(takeBriefStories(stories, "5")).toHaveLength(5);
  });

  it("takes everything on 'all'", () => {
    expect(takeBriefStories([card(9), card(9)], "all")).toHaveLength(2);
  });

  it("returns fewer than the count when there are fewer stories", () => {
    // Not padded, not an error: three is what there is.
    expect(takeBriefStories([card(1), card(1), card(1)], "5")).toHaveLength(3);
  });

  it("returns nothing for no stories", () => {
    expect(takeBriefStories([], "5")).toEqual([]);
  });

  it("takes a PREFIX, so the caller's order is the order", () => {
    // recentStories sorts newest first, so "the first five" must mean the five
    // newest. A rule that reordered would quietly change which five.
    const stories = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    expect(takeBriefStories(stories, "5").map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });
});

/**
 * The per-reader re-sort — #203. Pure, so it is tested without a database on
 * the two properties that matter: it keeps the newest-first bucket the query
 * established, and within a bucket it lifts what the reader follows by the
 * decayed bonus and nothing else.
 */
describe("rerankForReader", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  const card = (id: number, score: number, topics: string[], ageHours: number) => ({
    id,
    score,
    firstSeenAt: hoursAgo(ageHours),
    topics: topics.map((key) => ({ key })),
  });

  it("returns the cards untouched when the reader follows nothing", () => {
    const cards = [card(3, 50, ["agents"], 1), card(2, 40, [], 1), card(1, 30, ["agents"], 1)];
    expect(rerankForReader(cards, [true, true, true], [], now)).toBe(cards);
  });

  it("lifts a followed story within its bucket", () => {
    // Stored order: 50, 40, 30. The reader follows agents; the 30 carries it
    // and gains 14 at age zero, to 44 — above the 40, below the 50.
    const cards = [card(3, 50, [], 0), card(2, 40, [], 0), card(1, 30, ["agents"], 0)];
    const out = rerankForReader(cards, [true, true, true], ["agents"], now);
    expect(out.map((c) => c.id)).toEqual([3, 1, 2]);
  });

  /**
   * THE LINE A TASTE SETTING MAY NOT CROSS. The owner's ruling is that today's
   * arrivals lead; a followed story from last week may rise to the top of last
   * week, never above an unfollowed story from this morning.
   */
  it("never lifts an older story over today's arrivals", () => {
    const cards = [card(2, 10, [], 1), card(1, 60, ["agents"], 100)];
    const out = rerankForReader(cards, [true, false], ["agents"], now);
    expect(out.map((c) => c.id)).toEqual([2, 1]);
  });

  it("applies the bonus through the same age decay as the stored score", () => {
    // At the 48h half-life the 14-point first match is worth 7. A 40 with it
    // becomes 47 — enough to pass a 45, not a 48.
    const cards = [card(3, 48, [], 48), card(2, 45, [], 48), card(1, 40, ["agents"], 48)];
    const out = rerankForReader(cards, [false, false, false], ["agents"], now);
    expect(out.map((c) => c.id)).toEqual([3, 1, 2]);
  });

  it("breaks a tie by id, newest story first, as the query does", () => {
    const cards = [card(1, 40, [], 0), card(2, 26, ["agents"], 0)];
    // 26 + 14 = 40: a tie on score, so the higher id leads.
    const out = rerankForReader(cards, [true, true], ["agents"], now);
    expect(out.map((c) => c.id)).toEqual([2, 1]);
  });
});
