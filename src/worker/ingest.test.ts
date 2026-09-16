import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { sources, stories } from "@/db/schema";
import { ingestOnce } from "./ingest";

/**
 * The worker's one-shot path, end to end, against a real Postgres.
 *
 * Its own database: this suite truncates between tests and would otherwise
 * delete a developer's seeded catalogue.
 */
const TEST_DB = "ai_radar_ingest_test";
const configured = process.env.DATABASE_URL;

if (!configured && process.env.CI) {
  throw new Error("CI must set DATABASE_URL; refusing to skip the ingest pass tests silently");
}
if (!configured) {
  console.warn(
    "\n!! DATABASE_URL is not set: the ingest pass tests did NOT run.\n" +
      "!! Copy .env.example to .env and point DATABASE_URL at a local Postgres.\n",
  );
}

const withDb = configured ? describe : describe.skip;

function urlFor(database: string): string {
  const u = new URL(configured!);
  u.pathname = `/${database}`;
  return u.toString();
}

/** Pinned: a ranker driven by the wall clock passes today and fails at a boundary. */
const NOW = new Date("2026-09-16T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toUTCString();

const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Test feed</title>
<item><title>A new model lands</title><link>https://example.test/model</link><guid>https://example.test/model</guid><pubDate>${hoursAgo(2)}</pubDate><description>One</description></item>
<item><title>A second unrelated release</title><link>https://example.test/release</link><guid>https://example.test/release</guid><pubDate>${hoursAgo(3)}</pubDate><description>Two</description></item>
</channel></rss>`;

/** No network: what is under test is the wiring, not anyone's feed. */
const fakeNetwork = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.includes("example.test/feed")) {
    return { ok: true, status: 200, text: async () => FEED } as Response;
  }
  return { ok: false, status: 404, text: async () => "" } as Response;
}) as unknown as typeof fetch;

withDb("ingestOnce", () => {
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let db: Db;

  beforeAll(async () => {
    admin = postgres(urlFor("postgres"), { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
    sql = postgres(urlFor(TEST_DB), { max: 4, onnotice: () => {} });
    db = drizzle(sql, { schema }) as unknown as Db;
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`).catch(() => {});
    await admin?.end();
  });

  beforeEach(async () => {
    await sql.unsafe(
      `TRUNCATE story_topics, raw_items, stories, topics, ingest_runs, sources RESTART IDENTITY CASCADE`,
    );
    await db.insert(sources).values({
      key: "test-feed",
      name: "Test feed",
      kind: "rss",
      tier: "HIGH_QUALITY_REPORTING",
      url: "https://example.test/feed",
    });
  });

  it("scores the stories it just ingested, in the one pass", async () => {
    const outcome = await ingestOnce(db, sql, {
      now: NOW,
      fetchImpl: fakeNetwork,
      sink: () => {},
    });

    expect(outcome.ran).toBe(true);
    if (!outcome.ran) return;

    // Floors first. "Every story is scored" is true of no stories at all, so a
    // pass that ingested nothing would satisfy the assertions below for the
    // wrong reason — which is exactly how this test would agree with itself on
    // a day the fake returned nothing.
    expect(outcome.result.ingest.itemsInserted).toBeGreaterThan(0);
    expect(outcome.result.ranked.ranked).toBeGreaterThan(0);

    const rows = await db.select().from(stories);
    expect(rows.length).toBeGreaterThan(0);

    // `stories.score` is NOT NULL DEFAULT 0, so "the score is not null" is true
    // of a story nothing ever ranked. The components are what only a scored
    // story has, so that is what this asserts.
    const scored = rows.filter((s) => Object.keys(s.scoreComponents ?? {}).length > 0);
    expect(scored).toHaveLength(rows.length);
    expect(scored.every((s) => s.score > 0)).toBe(true);
  }, 30_000);

  it("reports the same number of scored stories as it wrote", async () => {
    const outcome = await ingestOnce(db, sql, {
      now: NOW,
      fetchImpl: fakeNetwork,
      sink: () => {},
    });
    expect(outcome.ran).toBe(true);
    if (!outcome.ran) return;

    const rows = await db.select().from(stories);
    // A count the caller reports about itself is worth nothing unless it agrees
    // with the table.
    expect(outcome.result.ranked.ranked).toBe(rows.length);
  }, 30_000);
});
