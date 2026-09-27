import { describe, expect, it } from "vitest";
import { briefSummary, emptyBriefReason } from "@/lib/api/brief-summary";
import { fixtureBrief, fixtureEmptyBrief } from "@/lib/api/fixtures";
import type { BriefResponse, StoryCard } from "@/lib/api/types";

function briefOf(stories: Partial<StoryCard>[], length: BriefResponse["length"]): BriefResponse {
  const full = stories.map((s, i) => ({ ...fixtureBrief("all").stories[i], ...s }));
  return {
    window: fixtureBrief("all").window,
    length,
    view: "all",
    count: full.length,
    readingMinutes: full.reduce((t, s) => t + s.readingMinutes, 0),
    sweep: null,
    stories: full,
  };
}

describe("briefSummary", () => {
  it("pluralises the story count", () => {
    expect(briefSummary(briefOf([{ readingMinutes: 3 }], "all")).count).toBe("1 story");
    expect(briefSummary(briefOf([{ readingMinutes: 3 }, { readingMinutes: 2 }], "all")).count).toBe(
      "2 stories",
    );
  });

  it("says nothing about minutes on an empty day, rather than '0 minutes'", () => {
    const empty = briefSummary(fixtureEmptyBrief());
    expect(empty.count).toBe("Nothing yet");
    expect(empty.minutes).toBeNull();
  });

  /**
   * THE OVER-BUDGET BLOCK IS GONE, AND ITS REMOVAL IS THE POINT.
   *
   * It asserted the header explained a brief running longer than the reader's
   * MINUTE budget. Selection is now a COUNT, so there is no budget to overrun
   * and the sentence it guarded would have fired on an ordinary five-story
   * brief while naming a setting that no longer means minutes.
   *
   * The field is removed from BriefSummary rather than left returning null, so
   * anything still reading it fails to compile. That compile error is the
   * guard this block used to be — a runtime test cannot assert the absence of
   * a field that no longer exists on the type.
   *
   * What survives is below: the header still reports the reading time of what
   * it actually selected, which is a measurement of the CONTENT and was never
   * the thing that broke.
   */
  describe("reading time is still reported, as a measurement of what was chosen", () => {
    it("adds up the minutes of the stories actually in the brief", () => {
      const s = briefSummary(briefOf([{ readingMinutes: 4 }, { readingMinutes: 3 }], "5"));
      expect(s.count).toBe("2 stories");
      expect(s.minutes).toBe("7 minutes");
    });

    it("says seven minutes for a five-story brief without calling it an overrun", () => {
      // Exactly the case the retired copy would have shouted about.
      const s = briefSummary(briefOf([{ readingMinutes: 7 }], "5"));
      expect(s.minutes).toBe("7 minutes");
      expect(JSON.stringify(s)).not.toMatch(/setting|budget|longer than/i);
    });
  });

  describe("unread", () => {
    it("counts unread stories rather than comparing against a previous brief", () => {
      const s = briefSummary(briefOf([{ read: true }, { read: false }, { read: false }], "all"));
      expect(s.unread).toBe("2 unread");
    });

    it("says nothing when everything is unread, which is the ordinary morning", () => {
      expect(briefSummary(briefOf([{ read: false }, { read: false }], "all")).unread).toBeNull();
    });

    it("says nothing when everything has been read", () => {
      expect(briefSummary(briefOf([{ read: true }, { read: true }], "all")).unread).toBeNull();
    });
  });
});

describe("why an empty brief is empty (#148)", () => {
  /**
   * The screen that caused this ticket said "the database answered, so this is
   * a quiet morning rather than a fault" on a day the collector had written 64
   * stories. Every case below exists to stop that sentence being shown when it
   * is not true.
   */
  const emptyWith = (sweep: BriefResponse["sweep"]): BriefResponse => ({
    ...briefOf([], "all"),
    count: 0,
    stories: [],
    window: { ...briefOf([], "all").window, briefTime: "07:30" },
    sweep,
  });

  it("says the collector has never finished, which is not a quiet morning", () => {
    const r = emptyBriefReason(emptyWith({ lastFinishedAt: null, itemsSinceWindowOpened: 0 }));
    expect(r.kind).toBe("never-swept");
    // NOT a substring assertion on the prose. The copy CONTRASTS itself with a
    // quiet morning — "the collector not having run rather than a quiet
    // morning" — and a negative match on the phrase cannot tell asserting it
    // from denying it. The kind is the claim; the words are free to change.
    expect(r.body).toMatch(/collector not having run/);
  });

  it("calls it quiet ONLY when the collector ran and found nothing", () => {
    const r = emptyBriefReason(
      emptyWith({ lastFinishedAt: "2026-09-22T05:17:00.000Z", itemsSinceWindowOpened: 0 }),
    );
    expect(r.kind).toBe("quiet");
    expect(r.body).toMatch(/genuinely quiet/);
  });

  /** THE ONE THE TICKET IS ABOUT. */
  it("refuses to call it quiet when stories HAVE arrived since the window opened", () => {
    const r = emptyBriefReason(
      emptyWith({ lastFinishedAt: "2026-09-22T12:17:00.000Z", itemsSinceWindowOpened: 13 }),
    );
    expect(r.kind).toBe("arrived-but-filtered");
    // The number and the remedy, not a reassurance.
    expect(r.body).toMatch(/13 stories have arrived/);
    expect(r.body).toMatch(/Widen the filter|check your brief time/);
    expect(r.body).not.toMatch(/quiet/);
  });

  it("pluralises a single arrival", () => {
    const r = emptyBriefReason(
      emptyWith({ lastFinishedAt: "2026-09-22T12:17:00.000Z", itemsSinceWindowOpened: 1 }),
    );
    expect(r.body).toMatch(/1 story has arrived/);
  });

  it("treats fixture mode as its own case rather than a quiet day", () => {
    const r = emptyBriefReason(emptyWith(null));
    expect(r.kind).toBe("no-collector");
    expect(r.body).toMatch(/sample stories/);
  });
});
