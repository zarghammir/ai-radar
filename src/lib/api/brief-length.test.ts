import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Both paths are driven here, because they fail in opposite ways.
 *
 * On fixtures the client is right. Against the real API a SERVER component
 * must call the same function the route calls: fetching a relative
 * /api/preferences from the server has no origin to resolve against and throws
 * on every load — and the fallback below would swallow it and use ten minutes
 * forever, so the reader's saved length would never work and nothing would say
 * so. Today shipped that exact defect once already.
 */
let usingFixtures = true;
const clientGetPreferences = vi.fn();
const putPreferences = vi.fn();
const readerGetPreferences = vi.fn();
const getDb = vi.fn(() => "a-database-handle");

vi.mock("@/lib/api/client", () => ({
  get USING_FIXTURES() {
    return usingFixtures;
  },
  getPreferences: () => clientGetPreferences(),
  putPreferences: (patch: unknown) => putPreferences(patch),
}));
vi.mock("@/db/client", () => ({ getDb: () => getDb() }));
vi.mock("@/api/reader", () => ({ getPreferences: (db: unknown) => readerGetPreferences(db) }));

const { FALLBACK_BRIEF_LENGTH, defaultBriefLength } = await import("@/lib/api/brief-length");

function preferences(briefLength: string) {
  return {
    topicKeys: [],
    briefTime: "07:30",
    timezone: "UTC",
    briefLength,
    notificationChannel: "none",
    email: null,
    theme: "system",
    onboardedAt: null,
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
}

beforeEach(() => {
  usingFixtures = true;
  clientGetPreferences.mockReset();
  putPreferences.mockReset();
  readerGetPreferences.mockReset();
  getDb.mockClear();
});

describe("how long Today runs when the URL says nothing", () => {
  it("uses the length the reader saved", async () => {
    // Before this existed the page used a hardcoded ten minutes, so the
    // control in Settings was written by the reader and read by nobody.
    for (const length of ["5", "10", "all"] as const) {
      clientGetPreferences.mockResolvedValue(preferences(length));
      await expect(defaultBriefLength()).resolves.toBe(length);
    }
    expect(clientGetPreferences).toHaveBeenCalledTimes(3);
  });

  it("falls back to ten minutes when the preference cannot be read", async () => {
    // The one place guessing is right: the alternative is no brief at all, the
    // guess is visible in the switch on the page, and one press corrects it.
    clientGetPreferences.mockRejectedValue(new Error("unreachable"));
    await expect(defaultBriefLength()).resolves.toBe(FALLBACK_BRIEF_LENGTH);
  });

  it("falls back when the stored value is one this build cannot render", async () => {
    clientGetPreferences.mockResolvedValue(preferences("90"));
    await expect(defaultBriefLength()).resolves.toBe(FALLBACK_BRIEF_LENGTH);
  });

  it("never writes the fallback back", async () => {
    // A fallback that saved itself would overwrite the reader's real choice
    // with a guess the moment the database hiccuped — and it would look like a
    // preference they had set, so nothing downstream could tell.
    clientGetPreferences.mockRejectedValue(new Error("unreachable"));
    await defaultBriefLength();
    clientGetPreferences.mockResolvedValue(preferences("all"));
    await defaultBriefLength();
    // The positive beside the negative: without it, a mis-wired mock would
    // make "never called" true for the wrong reason and prove nothing.
    expect(clientGetPreferences).toHaveBeenCalledTimes(2);
    expect(putPreferences).not.toHaveBeenCalled();
  });
});

describe("against the real API, on the server", () => {
  beforeEach(() => {
    usingFixtures = false;
  });

  it("calls the same function the route calls, and never the HTTP client", async () => {
    readerGetPreferences.mockResolvedValue(preferences("5"));
    await expect(defaultBriefLength()).resolves.toBe("5");
    // The positive and the negative together. The negative alone would pass if
    // the module simply threw before reaching either one.
    expect(readerGetPreferences).toHaveBeenCalledTimes(1);
    expect(readerGetPreferences).toHaveBeenCalledWith("a-database-handle");
    expect(clientGetPreferences).not.toHaveBeenCalled();
  });

  it("still falls back, rather than taking Today down with it", async () => {
    readerGetPreferences.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(defaultBriefLength()).resolves.toBe(FALLBACK_BRIEF_LENGTH);
    expect(readerGetPreferences).toHaveBeenCalledTimes(1);
  });
});
