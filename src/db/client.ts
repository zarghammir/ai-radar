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
 * withIngestLock takes a session-level advisory lock on a connection reserved
 * from this client. Handing out a fresh client per call would give two callers
 * two pools, both would reserve successfully, and both would believe they hold
 * a lock that is meant to admit one — a single-writer guarantee silently
 * failing, presenting later as corrupted slugs rather than as an error. Types
 * cannot see this, so it has a test with a fresh-client-per-call control.
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
