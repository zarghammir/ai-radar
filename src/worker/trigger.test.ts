import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { sources } from "@/db/schema";
import { withIngestLock } from "./lock";
import { handleIngestTrigger } from "./trigger";

/**
 * Its own database, like the pipeline tests: this suite truncates between
 * tests, and pointed at a developer's database it would delete their seeded
 * catalogue.
 */
const TEST_DB = "ai_radar_worker_test";
const configured = process.env.DATABASE_URL;

if (!configured && process.env.CI) {
  throw new Error("CI must set DATABASE_URL; refusing to skip the ingest trigger tests silently");
}
if (!configured) {
  console.warn(
    "\n!! DATABASE_URL is not set: the ingest trigger tests did NOT run.\n" +
      "!! Copy .env.example to .env and point DATABASE_URL at a local Postgres.\n",
  );
}

const withDb = configured ? describe : describe.skip;

function urlFor(database: string): string {
  const u = new URL(configured!);
  u.pathname = `/${database}`;
  return u.toString();
}

const SECRET = "3f7c1d9e2b5a8c4f";
const env = { INTERNAL_API_SECRET: SECRET };

function post(secret?: string | null): Request {
  const headers = new Headers();
  if (secret != null) headers.set("x-internal-secret", secret);
  return new Request("http://localhost/api/internal/ingest", { method: "POST", headers });
}

withDb("POST /api/internal/ingest", () => {
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
    // One enabled source pointed at a closed port: the fetch fails at once, so
    // the run is fast and offline, and runIngest still writes its ingest_runs
    // row. What is being tested is whether the trigger reached the pipeline.
    await db.insert(sources).values({
      key: "closed-port",
      name: "Closed port",
      kind: "rss",
      tier: "HIGH_QUALITY_REPORTING",
      url: "http://127.0.0.1:9/feed",
    });
  });

  async function runCount(): Promise<number> {
    const rows = await sql<{ n: number }[]>`select count(*)::int as n from ingest_runs`;
    return rows[0].n;
  }

  it("rejects a request with no secret header without touching the database", async () => {
    const response = await handleIngestTrigger(post(null), { db, sql, env });
    expect(response.status).toBe(401);
    expect(await runCount()).toBe(0);
  });

  it("rejects a wrong secret without touching the database", async () => {
    const response = await handleIngestTrigger(post("not-the-secret"), { db, sql, env });
    expect(response.status).toBe(401);
    expect(await runCount()).toBe(0);
  });

  it("rejects a secret that is merely a prefix of the real one", async () => {
    const response = await handleIngestTrigger(post(SECRET.slice(0, -1)), { db, sql, env });
    expect(response.status).toBe(401);
    expect(await runCount()).toBe(0);
  });

  it("runs the ingest when the secret is right", async () => {
    // The positive beside the negatives: without it, a route broken in both
    // directions would satisfy every rejection test above.
    const response = await handleIngestTrigger(post(SECRET), { db, sql, env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ran).toBe(true);
    expect(body.sources).toBe(1);
    expect(await runCount()).toBe(1);
  }, 30_000);

  it("declines with 409 while another ingest is running, and does not start a second", async () => {
    const other = postgres(urlFor(TEST_DB), { max: 2, onnotice: () => {} });
    try {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const holding = withIngestLock(other, async () => {
        await held;
        return "held";
      });
      await new Promise((r) => setTimeout(r, 100));

      try {
        const response = await handleIngestTrigger(post(SECRET), { db, sql, env });
        expect(response.status).toBe(409);
        expect(await runCount()).toBe(0);
      } finally {
        // Released in a finally so a failing assertion fails fast instead of
        // hanging until the test timeout with the lock still held.
        release();
        await holding;
      }
    } finally {
      await other.end();
    }
  }, 30_000);

  it("refuses to serve at all when the server's own secret is the placeholder", async () => {
    // Unreadable configuration is not permission. It must not fall through to
    // "no secret required", and it must not run.
    const response = await handleIngestTrigger(post("change-me"), {
      db,
      sql,
      env: { INTERNAL_API_SECRET: "change-me" },
    });
    expect(response.status).toBe(503);
    expect(await runCount()).toBe(0);
  });

  it("refuses to serve when the server has no secret configured at all", async () => {
    const response = await handleIngestTrigger(post(""), { db, sql, env: {} });
    expect(response.status).toBe(503);
    expect(await runCount()).toBe(0);
  });
});
