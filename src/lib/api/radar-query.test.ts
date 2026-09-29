import { describe, expect, it } from "vitest";
import { CONTENT_TYPES } from "@/db/schema";
import {
  DEFAULT_RADAR_QUERY,
  KIND_LABELS,
  KIND_TYPES,
  RADAR_KINDS,
  RADAR_RANGES,
  RADAR_SORTS,
  extraFilterCount,
  parseRadarQuery,
  radarApiParams,
  radarHref,
  radarSearchParams,
} from "./radar-query";

describe("the chips", () => {
  /**
   * The defect this catches is a type with no chip: it appears in the feed
   * under All and is unreachable by any filter, which reads as a broken
   * filter rather than as a missing one. Derived from CONTENT_TYPES, so
   * adding a type to the database fails here rather than on the screen.
   */
  it("reach every content type between them", () => {
    const covered = new Set(RADAR_KINDS.flatMap((kind) => KIND_TYPES[kind]));
    expect([...covered].sort()).toEqual([...CONTENT_TYPES].sort());
  });

  it("never place one type under two chips", () => {
    const all = RADAR_KINDS.flatMap((kind) => KIND_TYPES[kind]);
    expect(all.length).toBe(new Set(all).size);
  });

  it("leave All unconstrained rather than listing everything", () => {
    expect(KIND_TYPES.all).toEqual([]);
  });

  it("all have a label", () => {
    for (const kind of RADAR_KINDS) expect(KIND_LABELS[kind]).toBeTruthy();
  });
});

describe("parseRadarQuery", () => {
  it("answers the front door when the URL says nothing", () => {
    expect(parseRadarQuery({})).toEqual(DEFAULT_RADAR_QUERY);
  });

  it("reads the chip, the sort and the range", () => {
    expect(parseRadarQuery({ kind: "research", sort: "importance", range: "24h" })).toMatchObject({
      kind: "research",
      sort: "importance",
      range: "24h",
    });
  });

  /**
   * The API throws on an unrecognised value because a caller sending one has
   * a bug. A READER holding a stale link does not, and an error page in place
   * of a working screen helps nobody — so this falls back, and never widens.
   */
  it("falls back rather than throwing on a value it does not know", () => {
    const query = parseRadarQuery({ kind: "x", sort: "newst", range: "99y" });
    expect(query).toEqual(DEFAULT_RADAR_QUERY);
  });

  it("keeps repeated topic and source keys, de-duplicated", () => {
    const query = parseRadarQuery({ topic: ["agents", "agents", "chips"], source: "openai-blog" });
    expect(query.topic).toEqual(["agents", "chips"]);
    expect(query.source).toEqual(["openai-blog"]);
    expect(extraFilterCount(query)).toBe(3);
  });
});

describe("the URL it writes back", () => {
  it("omits every default, so the plain feed has a clean URL", () => {
    expect(radarSearchParams(DEFAULT_RADAR_QUERY).toString()).toBe("");
    expect(radarHref(DEFAULT_RADAR_QUERY, {})).toBe("/radar");
  });

  it("round-trips whatever it writes", () => {
    for (const kind of RADAR_KINDS) {
      for (const sort of RADAR_SORTS) {
        for (const range of RADAR_RANGES) {
          const query = { ...DEFAULT_RADAR_QUERY, kind, sort, range };
          const params = radarSearchParams(query);
          expect(parseRadarQuery(Object.fromEntries(params))).toEqual(query);
        }
      }
    }
  });

  it("changes one field and keeps the rest", () => {
    const query = { ...DEFAULT_RADAR_QUERY, kind: "models" as const, range: "30d" as const };
    expect(radarHref(query, { sort: "trending" })).toBe(
      "/radar?kind=models&sort=trending&range=30d",
    );
  });
});

describe("the query it sends the API", () => {
  it("expands a chip into the types the API speaks", () => {
    const params = radarApiParams({ ...DEFAULT_RADAR_QUERY, kind: "news" }, null);
    expect(params.getAll("type")).toEqual(["NEWS", "BUSINESS", "REGULATION"]);
  });

  it("sends no type at all for All, because empty means unfiltered", () => {
    expect(radarApiParams(DEFAULT_RADAR_QUERY, null).getAll("type")).toEqual([]);
  });

  it("names the range as the API's own parameter", () => {
    const params = radarApiParams({ ...DEFAULT_RADAR_QUERY, range: "24h" }, "abc");
    expect(params.get("since")).toBe("24h");
    expect(params.get("sort")).toBe("newest");
    expect(params.get("cursor")).toBe("abc");
  });

  it("carries topic, source and verification through", () => {
    const params = radarApiParams(
      {
        ...DEFAULT_RADAR_QUERY,
        topic: ["agents"],
        source: ["openai-blog"],
        verification: ["PRIMARY_SOURCE"],
      },
      null,
    );
    expect(params.getAll("topic")).toEqual(["agents"]);
    expect(params.getAll("source")).toEqual(["openai-blog"]);
    expect(params.getAll("verification")).toEqual(["PRIMARY_SOURCE"]);
  });
});
