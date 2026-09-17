import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/**
 * The advisory lock, driven through the accessors the routes and the worker
 * now use. Types cannot see any of this: a getSql() handing out a fresh client
 * per call typechecks perfectly.
 */
const TEST_DB = "ai_radar_client_test";
const configured = process.env.DATABASE_URL;

if (!configured && process.env.CI) {
  throw new Error("CI must set DATABASE_URL; refusing to skip the client tests silently");
}
if (!configured) console.warn("\n!! DATABASE_URL is not set: the client tests did NOT run.\n");
const withDb = configured ? describe : describe.skip;

const urlFor = (database: string) => {
  const u = new URL(configured!);
  u.pathname = `/${database}`;
  return u.toString();
};

withDb("the database client, against a real database", () => {
  let admin: ReturnType<typeof postgres>;
  let setup: ReturnType<typeof postgres>;

  beforeAll(async () => {
    admin = postgres(urlFor("postgres"), { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => {});
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
    setup = postgres(urlFor(TEST_DB), { max: 2, onnotice: () => {} });
    await migrate(drizzle(setup), { migrationsFolder: "./drizzle" });
    process.env.DATABASE_URL = urlFor(TEST_DB);
  }, 60_000);

  afterAll(async () => {
    const g = globalThis as unknown as { __aiRadarSql?: { end: (o?: unknown) => Promise<void> } };
    await g.__aiRadarSql?.end({ timeout: 5 }).catch(() => {});
    await setup?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => {});
    await admin?.end();
  }, 30_000);

  it("hands back the same client and the same database every time", async () => {
    // The memoisation, asserted directly. A fresh client per call would give
    // the worker one pool to run on and another to close, and would put the
    // advisory lock on a pool nothing else uses.
    const { getDb, getSql } = await import("@/db/client");
    expect(getSql()).toBe(getSql());
    expect(getDb()).toBe(getDb());
  });

  it("lets exactly one of two concurrent callers hold the ingest lock", async () => {
    // The lock's SEMANTICS are covered by src/worker/lock.test.ts, thoroughly
    // and including the pool-churn case. This asserts only the narrower thing
    // my change could break: that the accessor hands back a client on which
    // reserve() and the lock still work. Calling it proof of the lock itself
    // would be borrowing someone else's coverage.
    const { getSql } = await import("@/db/client");
    const { withIngestLock } = await import("@/worker/lock");

    let running = 0;
    let bothRanTogether = false;
    const attempt = () =>
      withIngestLock(getSql(), async () => {
        running += 1;
        if (running > 1) bothRanTogether = true;
        await new Promise((r) => setTimeout(r, 120));
        running -= 1;
        return "done";
      });

    const [a, b] = await Promise.all([attempt(), attempt()]);
    const ran = [a, b].filter((o) => o.ran);
    expect(ran).toHaveLength(1);
    expect(bothRanTogether).toBe(false);
  });
});
