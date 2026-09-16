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
    if (url.endsWith("topstories.json")) {
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
