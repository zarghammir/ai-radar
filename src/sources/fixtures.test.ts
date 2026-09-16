import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Source } from "@/db/schema";
import type { FetchContext, FetchedItem } from "./types";
import { rssAdapter } from "./rss/adapter";
import { arxivAdapter } from "./arxiv/adapter";
import { hackerNewsAdapter } from "./hackernews/adapter";
import { normalizeItem } from "@/pipeline/normalize";

/**
 * Every adapter run against a real response captured from the live service,
 * with no network. The inline fixtures in the sibling adapter tests pin
 * specific edge cases; these pin the shape the services actually return, which
 * is what changes without warning.
 *
 * See fixtures/README.md for what was captured, from where and when.
 */
const fixture = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../fixtures/${rel}`, import.meta.url)), "utf8");

function sourceWith(over: Partial<Source>): Source {
  return {
    id: 1,
    key: "fixture",
    name: "Fixture",
    kind: "rss",
    tier: "PRIMARY",
    url: "https://example.com/feed",
    homepage: "https://example.com",
    enabled: true,
    config: {},
    defaultContentType: "NEWS",
    lastFetchedAt: null,
    lastError: null,
    createdAt: new Date("2026-09-16T00:00:00Z"),
    ...over,
  } as Source;
}

function contextServing(body: (url: string) => string | null) {
  const logs: string[] = [];
  const ctx: FetchContext = {
    since: new Date("2026-09-01T00:00:00Z"),
    fetch: (async (input: string | URL | Request) => {
      const url = String(input);
      const text = body(url);
      if (text === null) throw new Error(`fixture has no response for ${url}`);
      return { ok: true, status: 200, text: async () => text } as Response;
    }) as unknown as typeof fetch,
    log: (m) => logs.push(m),
  };
  return { ctx, logs };
}

/** Assertions every adapter's output must satisfy, whatever the service. */
function expectUsable(items: FetchedItem[], floor: number) {
  // Floor first: every check below passes vacuously on an empty array.
  expect(items.length).toBeGreaterThanOrEqual(floor);
  for (const i of items) {
    expect(i.title.trim().length).toBeGreaterThan(0);
    expect(i.url).toMatch(/^https?:\/\//);
    expect(i.externalId.length).toBeGreaterThan(0);
    if (i.publishedAt) expect(Number.isNaN(i.publishedAt.getTime())).toBe(false);
  }
  const ids = items.map((i) => i.externalId);
  expect(new Set(ids).size).toBe(ids.length);
}

describe("rss adapter against captured responses", () => {
  it("reads a real RSS 2.0 feed", async () => {
    const { ctx } = contextServing(() => fixture("rss/techcrunch-ai.rss.xml"));
    const items = await rssAdapter.fetch(sourceWith({}), ctx);
    expectUsable(items, 20);
    expect(items.every((i) => i.publishedAt !== null)).toBe(true);
  });

  it("reads a real Atom feed", async () => {
    const { ctx } = contextServing(() => fixture("rss/simon-willison.atom.xml"));
    const items = await rssAdapter.fetch(sourceWith({}), ctx);
    expectUsable(items, 30);
    expect(items.every((i) => i.publishedAt !== null)).toBe(true);
  });

  it("honours maxItems on a real feed", async () => {
    const { ctx } = contextServing(() => fixture("rss/simon-willison.atom.xml"));
    const items = await rssAdapter.fetch(sourceWith({ config: { maxItems: 5 } }), ctx);
    expect(items).toHaveLength(5);
  });

  it("produces rows the normalizer accepts", async () => {
    const { ctx } = contextServing(() => fixture("rss/techcrunch-ai.rss.xml"));
    const items = await rssAdapter.fetch(sourceWith({}), ctx);
    const source = { id: 1, key: "techcrunch-ai", defaultContentType: "NEWS" as const };
    const rows = items.map((i) => normalizeItem(i, source));
    expect(rows.filter(Boolean)).toHaveLength(items.length);
    for (const r of rows) expect(Number.isNaN(r!.publishedAt.getTime())).toBe(false);
  });
});

describe("arxiv adapter against a captured response", () => {
  it("reads a real arXiv query response", async () => {
    const { ctx } = contextServing(() => fixture("arxiv/arxiv-query.atom.xml"));
    const items = await arxivAdapter.fetch(sourceWith({ kind: "arxiv", url: null }), ctx);
    expectUsable(items, 12);
    expect(items.every((i) => i.contentType === "PAPER")).toBe(true);
    expect(items.every((i) => i.url.startsWith("https://arxiv.org/abs/"))).toBe(true);
    expect(items.every((i) => Array.isArray(i.metadata?.authors))).toBe(true);
    // Version suffixes belong in the URL, never in the id used for dedupe.
    expect(items.every((i) => !/v\d+$/.test(i.externalId))).toBe(true);
  });
});

describe("hackernews adapter against captured responses", () => {
  const items = JSON.parse(fixture("hackernews/items.json")) as Record<string, unknown>;
  const serve = (url: string) => {
    if (url.endsWith("topstories.json")) return fixture("hackernews/topstories.json");
    const m = url.match(/\/item\/(\d+)\.json$/);
    if (m) return JSON.stringify(items[m[1]] ?? null);
    return null;
  };

  it("filters a real front page to AI stories over the points floor", async () => {
    const { ctx } = contextServing(serve);
    const out = await hackerNewsAdapter.fetch(
      sourceWith({ kind: "hackernews", url: null, config: { limit: 12 } }),
      ctx,
    );
    expectUsable(out, 3);
    for (const i of out) expect(Number(i.metadata?.points)).toBeGreaterThanOrEqual(20);
    const titles = out.map((i) => i.title);
    expect(titles.some((t) => t.includes("Mistral"))).toBe(true);
    // Captured at 19 points, so the floor is what excludes it, not the filter.
    expect(titles.some((t) => t.includes("AMD Matrix Cores"))).toBe(false);
  });

  it("applies the points floor from config", async () => {
    const { ctx } = contextServing(serve);
    const out = await hackerNewsAdapter.fetch(
      sourceWith({ kind: "hackernews", url: null, config: { limit: 12, minPoints: 15 } }),
      ctx,
    );
    expect(out.map((i) => i.title).some((t) => t.includes("AMD Matrix Cores"))).toBe(true);
  });

  it("reports nothing when every captured item resolves", async () => {
    const { ctx, logs } = contextServing(serve);
    await hackerNewsAdapter.fetch(
      sourceWith({ kind: "hackernews", url: null, config: { limit: 12 } }),
      ctx,
    );
    expect(logs).toEqual([]);
  });
});
