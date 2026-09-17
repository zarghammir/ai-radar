import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Importing the database handle must not require a database.
 *
 * `next build` imports every route module to collect its configuration, and an
 * image is built with no DATABASE_URL. A module-level throw therefore made the
 * application impossible to build — "Failed to collect configuration for
 * /api/topics" — while every unit test and the whole CI job stayed green,
 * because both run with DATABASE_URL set. Only the compose smoke caught it.
 */
describe("the database client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("imports without a connection string", async () => {
    const mod = await import("@/db/client");
    expect(mod.db).toBeDefined();
  });

  it("still fails clearly when something actually asks for the database", async () => {
    // Deferring the error must not lose it: a missing connection string is a
    // real problem at the moment a query is attempted, and the message has to
    // keep naming the fix.
    const { db } = await import("@/db/client");
    expect(() => db.select()).toThrow(/DATABASE_URL is not set/);
  });
});
