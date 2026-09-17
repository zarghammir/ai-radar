import { beforeEach, describe, expect, it, vi } from "vitest";

const getPreferences = vi.fn();
const putPreferences = vi.fn();
vi.mock("@/lib/api/client", () => ({
  getPreferences: () => getPreferences(),
  putPreferences: (patch: unknown) => putPreferences(patch),
}));

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
  getPreferences.mockReset();
  putPreferences.mockReset();
});

describe("how long Today runs when the URL says nothing", () => {
  it("uses the length the reader saved", async () => {
    // Before this existed the page used a hardcoded ten minutes, so the
    // control in Settings was written by the reader and read by nobody.
    for (const length of ["5", "10", "all"] as const) {
      getPreferences.mockResolvedValue(preferences(length));
      await expect(defaultBriefLength()).resolves.toBe(length);
    }
    expect(getPreferences).toHaveBeenCalledTimes(3);
  });

  it("falls back to ten minutes when the preference cannot be read", async () => {
    // The one place guessing is right: the alternative is no brief at all, the
    // guess is visible in the switch on the page, and one press corrects it.
    getPreferences.mockRejectedValue(new Error("unreachable"));
    await expect(defaultBriefLength()).resolves.toBe(FALLBACK_BRIEF_LENGTH);
  });

  it("falls back when the stored value is one this build cannot render", async () => {
    getPreferences.mockResolvedValue(preferences("90"));
    await expect(defaultBriefLength()).resolves.toBe(FALLBACK_BRIEF_LENGTH);
  });

  it("never writes the fallback back", async () => {
    // A fallback that saved itself would overwrite the reader's real choice
    // with a guess the moment the database hiccuped — and it would look like a
    // preference they had set, so nothing downstream could tell.
    getPreferences.mockRejectedValue(new Error("unreachable"));
    await defaultBriefLength();
    getPreferences.mockResolvedValue(preferences("all"));
    await defaultBriefLength();
    // The positive beside the negative: without it, a mis-wired mock would
    // make "never called" true for the wrong reason and prove nothing.
    expect(getPreferences).toHaveBeenCalledTimes(2);
    expect(putPreferences).not.toHaveBeenCalled();
  });
});
