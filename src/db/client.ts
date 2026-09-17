import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * The database, connected on first use rather than on import.
 *
 * Importing this module must not require a database. `next build` imports every
 * route module to collect its configuration, and an image is built with no
 * DATABASE_URL, so a module-level throw made the application impossible to
 * build — "Failed to collect configuration for /api/topics", with this file as
 * the cause. Every unit test and the whole lint-typecheck-test-build job stayed
 * green, because both run with DATABASE_URL set; only the compose smoke saw it.
 *
 * Accessors rather than exported values, and deliberately not a Proxy. A proxy
 * would have to answer `in` and Object.keys from the real handle, which means
 * connecting in order to answer them — so enumerating this module's exports
 * would connect to a database, which is the failure above wearing a different
 * hat. A function cannot be enumerated into a connection, has stable identity,
 * and has no trap semantics to get subtly wrong.
 */
function connect() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and edit it.");
  }
  // Reuse the connection across hot reloads in development.
  const globalForDb = globalThis as unknown as { __aiRadarSql?: ReturnType<typeof postgres> };
  const sql =
    globalForDb.__aiRadarSql ??
    postgres(connectionString, { max: 10, prepare: false, onnotice: () => {} });
  if (process.env.NODE_ENV !== "production") globalForDb.__aiRadarSql = sql;
  return { sql, db: drizzle(sql, { schema }) };
}

type Connection = ReturnType<typeof connect>;
export type Db = Connection["db"];
export type Sql = Connection["sql"];

let connection: Connection | null = null;

/**
 * Memoised on purpose, and it is the load-bearing part.
 *
 * NOT for the lock's sake. pg_try_advisory_lock is database-global rather than
 * pool-local, so two separate clients are two sessions and the second is
 * refused exactly as a second connection in one pool would be — measured, not
 * assumed. An earlier version of this comment claimed both callers would
 * believe they held the lock, and that is false; it is left recorded here
 * because a wrong rationale is worse than none, and this one would have led
 * someone to conclude the lock is safe because the client is memoised and then
 * remove the reserve() that actually keeps it safe.
 *
 * The real reason is the line above: globalThis is only populated when
 * NODE_ENV !== "production", so in production a non-memoised accessor builds a
 * NEW POOL on every call — connection exhaustion, and a worker running on one
 * pool while the process closes another. Types cannot see that, so it has a
 * test, and that test has to run as production or it cannot fail.
 */
function current(): Connection {
  connection ??= connect();
  return connection;
}

export function getDb(): Db {
  return current().db;
}

/** The raw client, for the one thing drizzle cannot express: reserving a single
 *  connection for a session-level advisory lock (src/worker/lock.ts). */
export function getSql(): Sql {
  return current().sql;
}

export { schema };
