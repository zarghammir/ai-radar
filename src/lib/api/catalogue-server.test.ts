import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Both paths, because they fail in opposite ways — the same shape as
 * brief-length.test.ts, and for the same reason. A FIXTURE PATH CANNOT
 * EXERCISE A RELATIVE FETCH: every call that works in fixture mode is untested
 * against the mode it will actually run in, so the live path gets its own
 * assertions rather than an assumption.
 */
let usingFixtures = true;
const clientGetTopics = vi.fn();
const listTopics = vi.fn();
const getDb = vi.fn(() => "a-database-handle");

vi.mock("@/lib/api/client", () => ({
  get USING_FIXTURES() {
    return usingFixtures;
  },
  getTopics: () => clientGetTopics(),
}));
vi.mock("@/db/client", () => ({ getDb: () => getDb() }));
vi.mock("@/api/catalogue", () => ({
  listTopics: (db: unknown, now: unknown) => listTopics(db, now),
}));

const { loadTopics } = await import("@/lib/api/catalogue-server");

const CATALOGUE = [{ key: "agents", name: "Agents", group: "field", storyCount: 3 }];

beforeEach(() => {
  usingFixtures = true;
  clientGetTopics.mockReset();
  listTopics.mockReset();
  getDb.mockClear();
});

describe("reading the catalogue on fixtures", () => {
  it("hands back what the client returned", async () => {
    clientGetTopics.mockResolvedValue(CATALOGUE);
    await expect(loadTopics()).resolves.toEqual(CATALOGUE);
  });

  it("answers null when the read FAILED, never an empty list", async () => {
    // An empty catalogue is a young install; an unreadable one is a broken
    // app. The Interests panel says something different for each, and it
    // cannot if both arrive as [].
    clientGetTopics.mockRejectedValue(new Error("unreachable"));
    await expect(loadTopics()).resolves.toBeNull();
  });

  it("answers an empty list when there genuinely are none", async () => {
    clientGetTopics.mockResolvedValue([]);
    await expect(loadTopics()).resolves.toEqual([]);
  });
});

describe("reading the catalogue against the real API, on the server", () => {
  beforeEach(() => {
    usingFixtures = false;
  });

  it("calls the same function the route calls, and never the HTTP client", async () => {
    // Fetching a relative /api/topics from a server component throws on every
    // load, and loadTopics would catch it and report "could not be read"
    // forever — the Interests panel permanently and honestly broken, which is
    // the worst kind, because nothing looks wrong with it.
    listTopics.mockResolvedValue(CATALOGUE);
    await expect(loadTopics()).resolves.toEqual(CATALOGUE);
    expect(listTopics).toHaveBeenCalledTimes(1);
    expect(listTopics.mock.calls[0][0]).toBe("a-database-handle");
    expect(listTopics.mock.calls[0][1]).toBeInstanceOf(Date);
    expect(clientGetTopics).not.toHaveBeenCalled();
  });

  it("still answers null rather than taking the page down", async () => {
    listTopics.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(loadTopics()).resolves.toBeNull();
    expect(listTopics).toHaveBeenCalledTimes(1);
  });
});
