import { describe, expect, it } from "vitest";
import { briefSummary } from "@/lib/api/brief-summary";
import { fixtureBrief, fixtureEmptyBrief } from "@/lib/api/fixtures";
import type { BriefResponse, StoryCard } from "@/lib/api/types";

function briefOf(stories: Partial<StoryCard>[], length: BriefResponse["length"]): BriefResponse {
  const full = stories.map((s, i) => ({ ...fixtureBrief("all").stories[i], ...s }));
  return {
    window: fixtureBrief("all").window,
    length,
    count: full.length,
    readingMinutes: full.reduce((t, s) => t + s.readingMinutes, 0),
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

    // Derived from the selection rule rather than assumed: only the FIRST story
    // can push past the budget, because every later one that would exceed it is
    // skipped. So an over-budget brief always holds exactly one story, and the
    // copy can say "the top story alone" truthfully.
    it("is only ever reachable with a single story, which is why the copy can say so", () => {
      for (const length of ["5", "10"] as const) {
        const b = fixtureBrief(length);
        if (b.readingMinutes > Number(length)) expect(b.count).toBe(1);
      }
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
