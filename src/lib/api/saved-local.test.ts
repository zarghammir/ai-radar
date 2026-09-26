import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The saved store AS IT SITS ON A DEVICE.
 *
 * saved-store.test.ts mocks getSaved, so nothing in the suite exercised the
 * localStorage path these tests cover — which is why the defect below lived in
 * a fully green suite. The owner reported it from his phone.
 *
 * WHY A FAKE localStorage AND NOT A DOM. The suite runs in node with no jsdom,
 * and adding a browser environment for this is a dependency decision that is
 * not mine to take in a bug fix. The fake stores RAW STRINGS, so every value
 * here still crosses the real serialize/parse boundary — the thing that
 * actually loses data. The REAL path is covered separately, in a browser, by
 * scripts/shoot-saved-states.mjs, which clicks the button and photographs the
 * result. Neither is sufficient alone and the split is deliberate.
 */

const SAVED_KEY = "ai-radar-fixture-saved";
const MARKS_KEY = "ai-radar-fixture-marks";

class FakeStorage {
  private data = new Map<string, string>();
  /** Keys whose WRITE must be refused, the way a full quota refuses one. */
  refuse = new Set<string>();

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    if (this.refuse.has(key)) {
      const error = new Error("QuotaExceededError: the quota has been exceeded.");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  /** Seeds a key with the EXACT string an older build would have left. */
  seedRaw(key: string, raw: string): void {
    this.data.set(key, raw);
  }
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.data);
  }
}

let storage: FakeStorage;

beforeEach(async () => {
  storage = new FakeStorage();
  (globalThis as { window?: unknown }).window = { localStorage: storage };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

/** Imported inside each test: these modules read `window` when called, not when
 *  imported, but a fresh import keeps one test's state out of the next. */
async function api() {
  return await import("@/lib/api/client");
}

/** A story as the app would hand it to setSaved. Only the fields the store
 *  actually persists matter here. */
function story(id: number) {
  return {
    id,
    slug: `story-${id}`,
    title: `Story ${id}`,
    url: `https://example.com/${id}`,
    readingMinutes: 1,
    saved: false,
    read: false,
    tags: [],
  } as unknown as Parameters<Awaited<ReturnType<typeof api>>["setSaved"]>[0];
}

describe("a saved id this device cannot turn into a story (#the-save-button)", () => {
  /**
   * THE OWNER'S DEVICE, EXACTLY. He said two things that sounded contradictory:
   * "says Saved but nothing's there" and "Saved is empty". Both are true at
   * once in this state, because the button renders from the ids key and the
   * Saved page can only render from the marks key.
   */
  it("reports it as UNRESOLVED rather than as an empty bin", async () => {
    storage.seedRaw(SAVED_KEY, "[1275]");
    // No marks key at all — the second write never landed.
    const { getSaved, localSavedIds } = await api();

    const response = await getSaved();

    expect(response.stories).toHaveLength(0);
    // The whole point. Without this the screen cannot tell the reader apart
    // from someone who has saved nothing.
    expect(response.unresolved).toBe(1);
    // And the id really is still there: this is not a device that lost the save.
    expect([...localSavedIds()]).toEqual([1275]);
  });

  it("counts every unresolvable id, not just the first", async () => {
    storage.seedRaw(SAVED_KEY, "[1, 2, 3]");
    const { getSaved } = await api();
    expect((await getSaved()).unresolved).toBe(3);
  });

  it("separates the readable from the unreadable in one list", async () => {
    storage.seedRaw(SAVED_KEY, "[10, 11]");
    storage.seedRaw(
      MARKS_KEY,
      JSON.stringify({
        "10": { note: null, tags: [], savedAt: "2026-09-25T00:00:00.000Z", card: { id: 10 } },
      }),
    );
    const { getSaved } = await api();

    const response = await getSaved();
    // A partial failure must not read as a complete list, which is what a
    // screen showing only `stories` would have shown.
    expect(response.stories.map((s) => s.id)).toEqual([10]);
    expect(response.unresolved).toBe(1);
  });

  it("reports nothing unresolved for a reader who has genuinely saved nothing", async () => {
    // The floor for the three above: if `unresolved` were simply the id count,
    // or always positive, every assertion here would still pass and none of
    // them would mean anything.
    const { getSaved } = await api();
    const response = await getSaved();
    expect(response.stories).toHaveLength(0);
    expect(response.unresolved).toBe(0);
  });
});

describe("the PREVIOUS stored shape, through the NEW reader, through persist", () => {
  /**
   * The standing rule for a persisted field. Both keys below are written as
   * RAW STRINGS exactly as a shipped build left them, then read back by the
   * reader this change ships — no in-memory construction, no shortcut past
   * JSON.
   */
  it("reads a device saved by the old build unchanged", async () => {
    storage.seedRaw(SAVED_KEY, "[42]");
    storage.seedRaw(
      MARKS_KEY,
      JSON.stringify({
        "42": {
          note: "worth re-reading",
          tags: ["infra"],
          savedAt: "2026-09-20T08:00:00.000Z",
          card: { id: 42, title: "An older save", readingMinutes: 2 },
        },
      }),
    );
    const { getSaved } = await api();

    const response = await getSaved();
    expect(response.unresolved).toBe(0);
    expect(response.stories).toHaveLength(1);
    // The note and the tag survive the new reader. Losing these silently is
    // the failure this rule exists to catch.
    expect(response.stories[0].note).toBe("worth re-reading");
    expect(response.stories[0].tags).toEqual(["infra"]);
    expect(response.stories[0].savedAt).toBe("2026-09-20T08:00:00.000Z");
  });

  it("does not make the broken half-state worse", async () => {
    // His phone is in this state right now. A reader that threw, cleared the
    // key, or dropped the id would turn a recoverable bug into a lost save.
    storage.seedRaw(SAVED_KEY, "[1275]");
    const { getSaved, localSavedIds } = await api();

    await expect(getSaved()).resolves.toBeTruthy();
    expect([...localSavedIds()]).toEqual([1275]);
    expect(storage.getItem(SAVED_KEY)).toBe("[1275]");
  });
});

describe("saving is one operation across two keys: both, or neither", () => {
  it("writes both keys when the device accepts them", async () => {
    const { setSaved } = await api();
    await setSaved(story(7), true);

    expect(JSON.parse(storage.getItem(SAVED_KEY) as string)).toEqual([7]);
    expect(Object.keys(JSON.parse(storage.getItem(MARKS_KEY) as string))).toEqual(["7"]);
  });

  /**
   * THE DEFECT, PINNED. The marks write is ~20x the bytes of the ids write and
   * grows with every save, so a quota refuses THAT one first. The old code
   * swallowed the refusal and wrote the id anyway, producing a device whose
   * button says "Saved" and whose bin says "Nothing saved".
   *
   * Reverting setSaved to two independent swallowing writes reddens THIS test
   * and not the others.
   */
  it("writes NEITHER key when the marks write is refused", async () => {
    storage.refuse.add(MARKS_KEY);
    const { setSaved } = await api();

    await expect(setSaved(story(7), true)).rejects.toThrow(/refused the write/);

    // The half-state must not exist. An id here with no card is the bug.
    expect(storage.getItem(SAVED_KEY)).toBeNull();
    expect(storage.getItem(MARKS_KEY)).toBeNull();
  });

  it("leaves an existing save exactly as it was when a later write is refused", async () => {
    const { setSaved } = await api();
    await setSaved(story(1), true);
    const before = storage.snapshot();

    storage.refuse.add(MARKS_KEY);
    await expect(setSaved(story(2), true)).rejects.toThrow();

    // Not merely "id 2 is absent" — the whole store is byte-identical, so a
    // rollback cannot have half-restored something either.
    expect(storage.snapshot()).toEqual(before);
  });

  it("THROWS, because the button's rollback is what tells the reader", async () => {
    // StoryActions catches this and shows "Could not save that. Try again."
    // A write that fails silently is the thing being fixed; a write that fails
    // loudly is recoverable.
    storage.refuse.add(MARKS_KEY);
    const { setSaved } = await api();
    await expect(setSaved(story(9), true)).rejects.toBeInstanceOf(Error);
  });
});
