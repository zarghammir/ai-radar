import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What Today falls back to when the URL says nothing.
 *
 * THE SUBJECT OF THIS FILE MOVED IN #94 and the tests moved with it. They used
 * to drive two paths — the client on fixtures, the database on a live build —
 * because the length was a column in a shared row. It is the reader's now and
 * lives on their device, so there is exactly one path: the cookie that carries
 * a device-held value to a page rendered on the server.
 *
 * The strongest assertion here is therefore a NEGATIVE with teeth: the database
 * and the HTTP client are mocked, and neither may be touched. That is the #94
 * guarantee stated as a test — one reader's length cannot reach another's page,
 * because the shared row is not consulted at all.
 */
let cookieValue: string | undefined;
const cookieGet = vi.fn((name: string) =>
  name === "ai-radar-fixture-brief-length" && cookieValue !== undefined
    ? { value: cookieValue }
    : undefined,
);
const getDb = vi.fn();
const readerGetPreferences = vi.fn();
const clientGetPreferences = vi.fn();

vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock("@/db/client", () => ({ getDb: () => getDb() }));
vi.mock("@/api/reader", () => ({ getPreferences: () => readerGetPreferences() }));
vi.mock("@/lib/api/client", () => ({
  USING_FIXTURES: false,
  getPreferences: () => clientGetPreferences(),
}));

const { FALLBACK_BRIEF_LENGTH, defaultBriefLength } = await import("@/lib/api/brief-length");

beforeEach(() => {
  cookieValue = undefined;
  cookieGet.mockClear();
  getDb.mockClear();
  readerGetPreferences.mockClear();
  clientGetPreferences.mockClear();
});

describe("the length Today starts from", () => {
  it("is the one this browser chose", async () => {
    for (const length of ["5", "10", "all"] as const) {
      cookieValue = length;
      await expect(defaultBriefLength()).resolves.toBe(length);
    }
    // The positive beside the negatives below: the cookie really was consulted,
    // so a green here cannot come from the fallback happening to agree.
    expect(cookieGet).toHaveBeenCalledWith("ai-radar-fixture-brief-length");
  });

  it("NEVER CONSULTS THE SHARED ROW — this is the #94 guarantee", async () => {
    // If either of these were called, one reader's saved length could decide
    // another reader's brief. The row is not merely ignored, it is unreachable
    // from here: there is no code path to it left.
    cookieValue = "5";
    await defaultBriefLength();
    cookieValue = undefined;
    await defaultBriefLength();

    expect(getDb, "the database was opened to decide a reader's length").not.toHaveBeenCalled();
    expect(readerGetPreferences, "the shared row was read").not.toHaveBeenCalled();
    expect(clientGetPreferences, "the preferences endpoint was called").not.toHaveBeenCalled();
    // And the positive: something WAS consulted, so "nothing was called" is not
    // true merely because the function did nothing at all.
    expect(cookieGet).toHaveBeenCalledTimes(2);
  });

  it("falls back to ten minutes when this browser has never chosen", async () => {
    await expect(defaultBriefLength()).resolves.toBe(FALLBACK_BRIEF_LENGTH);
  });

  it("falls back when the cookie holds a length this build cannot draw", async () => {
    // A cookie is reader-writable, so its contents are untrusted input. It must
    // not be able to put Today into a state it has no rendering for.
    for (const nonsense of ["42", "", "<script>", "ALL", "five"]) {
      cookieValue = nonsense;
      await expect(defaultBriefLength(), `accepted ${JSON.stringify(nonsense)}`).resolves.toBe(
        FALLBACK_BRIEF_LENGTH,
      );
    }
  });

  it("survives a cookie that cannot even be DECODED, by the other branch", async () => {
    // Malformed percent-encoding makes decodeURIComponent THROW rather than
    // return, which unwinds into defaultBriefLength's catch without the
    // allowlist ever running. Asserting the return value alone would be
    // VACUOUS — both branches answer "10" — so the branches are told apart by
    // the thing only one of them does: the catch logs.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const malformed of ["%", "%E0%A4", "%zz", "5%"]) {
        logged.mockClear();
        cookieValue = malformed;
        await expect(defaultBriefLength(), `on ${malformed}`).resolves.toBe(FALLBACK_BRIEF_LENGTH);
        expect(logged, `${malformed} should have thrown into the catch`).toHaveBeenCalledTimes(1);
      }
      // The control, in the same test: a merely unrecognised value reaches the
      // allowlist, answers the SAME "10", and logs nothing.
      logged.mockClear();
      cookieValue = "42";
      await expect(defaultBriefLength()).resolves.toBe(FALLBACK_BRIEF_LENGTH);
      expect(logged, "an unrecognised value must not go through the catch").not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});
