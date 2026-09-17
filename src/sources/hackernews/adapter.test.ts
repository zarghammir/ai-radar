import { describe, expect, it } from "vitest";
import type { Source } from "@/db/schema";
import type { FetchContext } from "../types";
import { hackerNewsAdapter, matchesKeywords, DEFAULT_AI_KEYWORDS } from "./adapter";

function sourceWith(config: Record<string, unknown>): Source {
  return {
    id: 1,
    key: "hn",
    name: "Hacker News",
    kind: "hackernews",
    tier: "COMMUNITY",
    url: null,
    homepage: "https://news.ycombinator.com",
    enabled: true,
    config,
    defaultContentType: "DISCUSSION",
    lastFetchedAt: null,
    lastError: null,
    createdAt: new Date("2026-09-16T00:00:00Z"),
  } as Source;
}

/** A fake HN transport: `items` maps id -> payload, `failIds` reject with HTTP 500. */
function transport(ids: number[], items: Record<number, unknown>, failIds: number[] = []) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (/\/v0\/[a-z]+stories\.json$/.test(url)) {
      return { ok: true, status: 200, text: async () => JSON.stringify(ids) } as Response;
    }
    const m = url.match(/\/item\/(\d+)\.json$/);
    if (m) {
      const id = Number(m[1]);
      if (failIds.includes(id)) {
        return { ok: false, status: 500, text: async () => "" } as Response;
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(items[id] ?? null),
      } as Response;
    }
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function contextFor(fetchImpl: typeof fetch) {
  const logged: string[] = [];
  const ctx: FetchContext = {
    since: new Date("2026-09-01T00:00:00Z"),
    fetch: fetchImpl,
    log: (m) => logged.push(m),
  };
  return { ctx, logged };
}

const story = (id: number, over: Partial<Record<string, unknown>> = {}) => ({
  id,
  type: "story",
  title: `OpenAI ships a new model ${id}`,
  url: `https://example.com/${id}`,
  by: "someone",
  time: 1_760_000_000,
  score: 100,
  descendants: 40,
  ...over,
});

describe("matchesKeywords", () => {
  it("matches short keywords only as whole words", () => {
    expect(matchesKeywords("The new AI model", ["ai"])).toBe(true);
    expect(matchesKeywords("Chain of command", ["ai"])).toBe(false);
  });
  it("matches multi-word phrases as substrings", () => {
    expect(matchesKeywords("A machine learning breakthrough", DEFAULT_AI_KEYWORDS)).toBe(true);
  });
  it("rejects titles with no AI signal", () => {
    expect(matchesKeywords("Postgres 19 released", DEFAULT_AI_KEYWORDS)).toBe(false);
  });
});

describe("hackerNewsAdapter", () => {
  it("returns stories that clear the points floor and the keyword filter", async () => {
    const { fetchImpl } = transport([1, 2], { 1: story(1), 2: story(2, { score: 3 }) });
    const { ctx } = contextFor(fetchImpl);
    const out = await hackerNewsAdapter.fetch(sourceWith({}), ctx);
    expect(out.map((i) => i.externalId)).toEqual(["1"]);
    expect(out[0].metadata?.points).toBe(100);
    expect(out[0].metadata?.hnUrl).toBe("https://news.ycombinator.com/item?id=1");
  });

  it("reports items it could not fetch instead of dropping them silently", async () => {
    const { fetchImpl } = transport([1, 2], { 1: story(1), 2: story(2) }, [2]);
    const { ctx, logged } = contextFor(fetchImpl);
    const out = await hackerNewsAdapter.fetch(sourceWith({}), ctx);
    expect(out.map((i) => i.externalId)).toEqual(["1"]);
    expect(logged.join("\n")).toContain("2");
    expect(logged.length).toBe(1);
  });

  it("marks a self-post with no outbound link as a discussion", async () => {
    const { fetchImpl } = transport([1], { 1: story(1, { url: undefined, text: "body" }) });
    const { ctx } = contextFor(fetchImpl);
    const out = await hackerNewsAdapter.fetch(sourceWith({}), ctx);
    expect(out[0].contentType).toBe("DISCUSSION");
    expect(out[0].url).toBe("https://news.ycombinator.com/item?id=1");
  });
});

describe("the Show HN list", () => {
  const showSource = (over: Record<string, unknown> = {}) =>
    ({
      ...sourceWith({ list: "show", limit: 10, minPoints: 3, ...over }),
      defaultContentType: "RELEASE",
    }) as Source;

  it("reads showstories, not topstories", async () => {
    const { fetchImpl, calls } = transport([1], { 1: story(1) });
    await hackerNewsAdapter.fetch(showSource(), contextFor(fetchImpl).ctx);
    expect(calls.some((u) => u.endsWith("/v0/showstories.json"))).toBe(true);
    expect(calls.some((u) => u.endsWith("/v0/topstories.json"))).toBe(false);
  });

  it("leaves a self-post's type to the source, because a debut is not a discussion", async () => {
    // The front page assigns DISCUSSION to a post with no outbound link, and
    // that is right there: someone is asking or arguing. On Show HN the same
    // shape is a person launching a thing and describing it rather than
    // linking to it. Undefined here means normalizeItem falls back to the
    // source default, which the catalogue sets to RELEASE.
    const selfPost = story(1, { url: undefined, text: "I built this over a year" });
    const { fetchImpl } = transport([1], { 1: selfPost });
    const [item] = await hackerNewsAdapter.fetch(showSource(), contextFor(fetchImpl).ctx);
    expect(item.contentType).toBeUndefined();
  });

  it("still marks a front-page self-post as a discussion", async () => {
    // The positive control for the line above: the change must be confined to
    // the show list, or it silently retypes every Ask HN thread.
    const selfPost = story(1, { url: undefined, text: "what does everyone think" });
    const { fetchImpl } = transport([1], { 1: selfPost });
    const src = sourceWith({ list: "top", limit: 10, minPoints: 3 });
    const [item] = await hackerNewsAdapter.fetch(src, contextFor(fetchImpl).ctx);
    expect(item.contentType).toBe("DISCUSSION");
  });

  it("keeps the thread url and the engagement counts, and invents no velocity", async () => {
    const { fetchImpl } = transport([1], { 1: story(1, { score: 7, descendants: 2 }) });
    const [item] = await hackerNewsAdapter.fetch(showSource(), contextFor(fetchImpl).ctx);
    expect(item.metadata).toMatchObject({
      hnId: 1,
      hnUrl: "https://news.ycombinator.com/item?id=1",
      points: 7,
      comments: 2,
    });
    // Nothing that looks like a rate. An item arrives with a score; whether it
    // is rising needs history this repo does not keep, and a delta against
    // nothing is a number that looks measured and is not.
    const keys = Object.keys(item.metadata ?? {});
    expect(keys.filter((k) => /velocity|rate|rising|trend|delta|perHour/i.test(k))).toEqual([]);
  });

  it("applies the configured points floor rather than the front page's", async () => {
    const items = { 1: story(1, { score: 4 }), 2: story(2, { score: 2 }) };
    const { fetchImpl } = transport([1, 2], items);
    const out = await hackerNewsAdapter.fetch(showSource(), contextFor(fetchImpl).ctx);
    expect(out.map((i) => i.externalId)).toEqual(["1"]);
  });

  it("reports zero for an empty list rather than succeeding quietly", async () => {
    // The ticket's control. Asserted before anything else can throw, because a
    // diagnostic that only runs when the rest survives is not a diagnostic for
    // the case it exists to catch.
    const { fetchImpl, calls } = transport([], {});
    const out = await hackerNewsAdapter.fetch(showSource(), contextFor(fetchImpl).ctx);
    expect(out).toEqual([]);
    // Floor on the control itself: it must have actually asked for the list.
    // An empty result because no request was made would pass the line above
    // while proving nothing.
    expect(calls.filter((u) => u.endsWith("/v0/showstories.json")).length).toBe(1);
  });
});
