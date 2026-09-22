import { describe, expect, it } from "vitest";
import { briefSummary, emptyBriefReason } from "@/lib/api/brief-summary";
import { fixtureBrief, fixtureEmptyBrief } from "@/lib/api/fixtures";
import { takeWithinReadingTime } from "@/api/reading-budget";
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
    expect(empty.overBudget).toBeNull();
  });

  describe("the over-budget brief", () => {
    // The contract returns at least one story even when that story alone is
    // longer than the budget. An empty brief on a day with news is worse. But
    // the header must not present it as though nothing happened.
    it("explains a brief that runs longer than the selected budget", () => {
      const s = briefSummary(briefOf([{ readingMinutes: 6 }], "5"));
      expect(s.count).toBe("1 story");
      expect(s.minutes).toBe("6 minutes");
      expect(s.overBudget).toBe(
        "longer than your 5-minute setting — the top story alone runs 6 minutes",
      );
    });

    it("stays silent when the brief fits", () => {
      expect(briefSummary(briefOf([{ readingMinutes: 4 }], "5")).overBudget).toBeNull();
    });

    it("stays silent when the brief exactly fills the budget", () => {
      // The boundary: 5 minutes under a 5-minute setting is not over.
      expect(briefSummary(briefOf([{ readingMinutes: 5 }], "5")).overBudget).toBeNull();
    });

    it("never fires on 'all', which has no budget to exceed", () => {
      expect(briefSummary(briefOf([{ readingMinutes: 40 }], "all")).overBudget).toBeNull();
    });

    /**
     * The copy says "the top story alone", which is only honest if an
     * over-budget selection can hold exactly one story and never two.
     *
     * An earlier version of this test asked the FIXTURES for that state:
     *   if (b.readingMinutes > Number(length)) expect(b.count).toBe(1);
     * Every fixture story is one minute, so the condition was never true and
     * the assertion never ran — changing toBe(1) to toBe(999) left the suite
     * green. Worse, the PR body said in plain words that the over-budget state
     * is unreachable with these fixtures, so the fact that this guard could not
     * fire was already written down one document away from the test depending
     * on it firing. Both statements could not be load-bearing.
     *
     * It now exercises the RULE against a story set built to force the state,
     * which is the thing the copy actually depends on.
     */
    it("holds exactly one story when the top story alone exceeds the budget", () => {
      const base = fixtureBrief("all").stories;
      const long = { ...base[0], id: 9001, score: 99, readingMinutes: 6 };
      const others = [
        { ...base[1], id: 9002, score: 50, readingMinutes: 1 },
        { ...base[2], id: 9003, score: 40, readingMinutes: 1 },
      ];
      const chosen = takeWithinReadingTime([long, ...others], "5");
      // Unconditional: no `if` can skip these.
      expect(chosen).toHaveLength(1);
      expect(chosen[0].id).toBe(9001);
      expect(chosen.reduce((t, s) => t + s.readingMinutes, 0)).toBeGreaterThan(5);
    });

    /**
     * STOPS at the first story that will not fit; it does not keep looking for
     * a smaller one to squeeze in. docs/api.md: "until the cumulative reading
     * time would exceed the target".
     *
     * An earlier version of this test asserted [9101, 9103] — the first story,
     * then SKIPPING the one that did not fit and taking a later one that did.
     * That was greedy-fill, which is what the fixtures' own copy of the rule
     * did, and this test pinned the divergence in place while claiming to
     * verify it. The two rules agreed only because every fixture story is one
     * minute. This input is the smallest one that tells them apart.
     */
    it("stops at the first story that does not fit, rather than filling the gap", () => {
      const base = fixtureBrief("all").stories;
      const stories = [
        { ...base[0], id: 9101, score: 99, readingMinutes: 4 },
        { ...base[1], id: 9102, score: 80, readingMinutes: 4 },
        { ...base[2], id: 9103, score: 70, readingMinutes: 1 },
      ];
      const chosen = takeWithinReadingTime(stories, "5");
      expect(chosen.map((s) => s.id)).toEqual([9101]);
      // Greedy-fill would have produced this, and did until it was caught.
      expect(chosen.map((s) => s.id)).not.toEqual([9101, 9103]);
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
