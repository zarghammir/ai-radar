import { beforeEach, describe, expect, it, vi } from "vitest";

const getSaved = vi.fn();
vi.mock("@/lib/api/client", () => ({ getSaved: (...args: unknown[]) => getSaved(...args) }));

const {
  getSavedSnapshot,
  getServerSavedSnapshot,
  patchSavedStory,
  removeSavedStory,
  resetSavedStoreForTests,
  subscribeSaved,
} = await import("@/lib/api/saved-store");

type Card = { id: number; tags: string[]; note: string | null; read: boolean };

function card(id: number, extra: Partial<Card> = {}): Card {
  return { id, tags: [], note: null, read: false, ...extra };
}

/** Subscribes and resolves once the store has left "loading". */
function settled() {
  return new Promise<void>((resolve) => {
    const unsubscribe = subscribeSaved(() => {
      if (getSavedSnapshot().kind !== "loading") {
        unsubscribe();
        resolve();
      }
    });
  });
}

beforeEach(() => {
  resetSavedStoreForTests();
  getSaved.mockReset();
});

describe("the saved list store", () => {
  it("holds the stories a successful read returned", async () => {
    getSaved.mockResolvedValue({ stories: [card(1), card(2)], nextCursor: null, hasMore: false });
    await settled();
    const state = getSavedSnapshot();
    expect(state.kind).toBe("ready");
    // The floor: a store that returned "ready" with nothing in it would pass
    // the kind check above while proving nothing about the read.
    expect(state.kind === "ready" && state.stories.map((s) => s.id)).toEqual([1, 2]);
  });

  it("A READ THAT FAILED IS NOT A READER WHO HAS SAVED NOTHING", async () => {
    // The defect this whole screen is shaped around. An empty list and an
    // unreachable store must never arrive at the same value, because the screen
    // would then tell someone their notes are gone when they are out of reach.
    getSaved.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await settled();
    expect(getSavedSnapshot().kind).toBe("failed");
    expect(getSavedSnapshot()).not.toEqual({ kind: "ready", stories: [] });
  });

  it("tells an empty list apart from a failure, in the other direction too", async () => {
    getSaved.mockResolvedValue({ stories: [], nextCursor: null, hasMore: false });
    await settled();
    expect(getSavedSnapshot()).toEqual({ kind: "ready", stories: [] });
  });

  it("starts ONE read however many screens subscribe", async () => {
    getSaved.mockResolvedValue({ stories: [card(1)], nextCursor: null, hasMore: false });
    const first = settled();
    subscribeSaved(() => {});
    subscribeSaved(() => {});
    await first;
    expect(getSaved).toHaveBeenCalledTimes(1);
  });

  it("renders as loading on the server, every time, with the same object", () => {
    // useSyncExternalStore compares by reference; a fresh object each call is
    // an infinite render loop rather than a wrong pixel.
    expect(getServerSavedSnapshot()).toBe(getServerSavedSnapshot());
    expect(getServerSavedSnapshot().kind).toBe("loading");
  });
});

describe("optimistic changes", () => {
  beforeEach(async () => {
    getSaved.mockResolvedValue({
      stories: [card(1, { tags: ["ship"] }), card(2)],
      nextCursor: null,
      hasMore: false,
    });
    await settled();
  });

  it("applies a change and can put it back exactly as it was", () => {
    const before = getSavedSnapshot();
    const rollback = patchSavedStory(1, { note: "read this before Friday" } as Partial<Card>);
    const during = getSavedSnapshot();
    expect(during.kind === "ready" && during.stories[0].note).toBe("read this before Friday");
    rollback();
    expect(getSavedSnapshot()).toEqual(before);
  });

  it("removes a story and can put it back", () => {
    const before = getSavedSnapshot();
    const rollback = removeSavedStory(1);
    const during = getSavedSnapshot();
    expect(during.kind === "ready" && during.stories.map((s) => s.id)).toEqual([2]);
    rollback();
    expect(getSavedSnapshot()).toEqual(before);
  });

  it("leaves the other stories alone", () => {
    patchSavedStory(1, { read: true } as Partial<Card>);
    const state = getSavedSnapshot();
    expect(state.kind === "ready" && state.stories[1]).toEqual(card(2));
  });
});

describe("changing a list that is not there", () => {
  it("does nothing, and hands back a rollback that also does nothing", async () => {
    getSaved.mockRejectedValue(new Error("unreachable"));
    await settled();
    const before = getSavedSnapshot();
    const rollback = patchSavedStory(1, { read: true } as Partial<Card>);
    expect(getSavedSnapshot()).toEqual(before);
    rollback();
    // A rollback that resurrected a stale "ready" over a failure would show
    // the reader a list the app can no longer reach.
    expect(getSavedSnapshot()).toEqual(before);
  });
});
