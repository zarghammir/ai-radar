import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RADAR_QUERY, type RadarQuery } from "@/lib/api/radar-query";

/**
 * Both paths, because they fail in opposite ways — the shape
 * catalogue-server.test.ts set. The fixture path never touches a database, so
 * everything the live path does with one is untested unless it is asserted
 * separately.
 */
let usingFixtures = true;
const fixtureRadar = vi.fn();
const radarPage = vi.fn();
const unknownKeys = vi.fn();

vi.mock("@/lib/api/client", () => ({
  get USING_FIXTURES() {
    return usingFixtures;
  },
}));
vi.mock("@/db/client", () => ({ getDb: () => "a-database-handle" }));
vi.mock("@/lib/api/fixtures", () => ({
  fixtureRadar: (types: unknown, sort: unknown) => fixtureRadar(types, sort),
}));
vi.mock("@/api/radar", () => ({
  radarPage: (...args: unknown[]) => radarPage(...args),
  unknownKeys: (db: unknown, kind: unknown, keys: unknown) => unknownKeys(db, kind, keys),
}));

const { loadRadar } = await import("@/lib/api/radar-server");

const PAGE = { stories: [{ id: 1 }], nextCursor: "next", hasMore: true };

function query(over: Partial<RadarQuery> = {}): RadarQuery {
  return { ...DEFAULT_RADAR_QUERY, ...over };
}

beforeEach(() => {
  usingFixtures = true;
  fixtureRadar.mockReset();
  radarPage.mockReset();
  unknownKeys.mockReset();
  unknownKeys.mockResolvedValue([]);
});

describe("on fixtures", () => {
  it("serves the fixture feed and reports no unknown filters", async () => {
    fixtureRadar.mockReturnValue(PAGE);
    await expect(loadRadar(query({ kind: "models" }))).resolves.toEqual({ ...PAGE, unknown: [] });
    expect(fixtureRadar).toHaveBeenCalledWith(["MODEL"], "newest");
    expect(radarPage).not.toHaveBeenCalled();
  });
});

describe("against the database", () => {
  beforeEach(() => {
    usingFixtures = false;
    radarPage.mockResolvedValue(PAGE);
  });

  it("expands the chip into content types and names the window", async () => {
    const now = new Date("2026-09-16T12:00:00Z");
    await loadRadar(query({ kind: "news", range: "24h", sort: "importance" }), now);

    const [, filters, sort, limit, cursor] = radarPage.mock.calls[0];
    expect(filters.type).toEqual(["NEWS", "BUSINESS", "REGULATION"]);
    expect(filters.sinceRaw).toBe("24h");
    expect(filters.since.toISOString()).toBe("2026-09-15T12:00:00.000Z");
    expect(filters.includeAdjacent).toBe(false);
    expect(sort).toBe("importance");
    expect(limit).toBeGreaterThan(0);
    // The first page is the top of the feed, never a continuation.
    expect(cursor).toBeNull();
  });

  /**
   * A key that names nothing would otherwise narrow the feed to zero rows and
   * look exactly like a quiet week — the one failure this screen must never
   * show, because the reader cannot tell it from a broken collector.
   */
  it("drops a topic the installation does not have, and says which", async () => {
    unknownKeys.mockImplementation((_db: unknown, kind: string, keys: string[]) =>
      Promise.resolve(kind === "topic" ? keys.filter((k) => k === "ghost") : []),
    );

    const feed = await loadRadar(query({ topic: ["agents", "ghost"] }));

    expect(feed.unknown).toEqual(["ghost"]);
    expect(radarPage.mock.calls[0][1].topic).toEqual(["agents"]);
  });

  it("hands back the page the query returned", async () => {
    await expect(loadRadar(query())).resolves.toEqual({ ...PAGE, unknown: [] });
  });
});
