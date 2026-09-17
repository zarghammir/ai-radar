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
/**
 * Turn a database error into a line that is safe to print in a PUBLIC CI log.
 *
 * WHY THIS EXISTS. This repository is public, so its Actions logs are readable
 * by anyone. GitHub masks the VALUE of a registered secret; it does not mask
 * the PARTS of one. `DATABASE_URL` is registered as a whole string, so the
 * host, port, user, password and database name inside it are each unmasked the
 * moment something prints them on their own — and drivers print parts, not URLs.
 *
 * WHAT postgres.js ACTUALLY PRINTS, captured from a real run rather than
 * assumed (see the shapes asserted in describe-db-error.test.ts):
 *   getaddrinfo ENOTFOUND db.example.com          <- host, in the MESSAGE
 *   write CONNECT_TIMEOUT 10.0.0.1:5432           <- host and port, in the MESSAGE
 *   role "someuser" does not exist                <- user, in the MESSAGE
 * An earlier version of this function only dropped the error's `cause`, which
 * is where a QUERY-shaped error carries `address`/`port`. That left every
 * CONNECTION-shaped error untouched, because postgres.js builds those
 * coordinates into the message itself (node_modules/postgres/src/errors.js).
 *
 * SO THE REDACTION IS BY VALUE, NOT BY SHAPE. We parsed the URL, so we know
 * each part; anything that matches one is replaced wherever it appears. That
 * holds for message shapes this driver has not produced yet, which a pattern
 * written against today's messages could not.
 *
 * What survives on purpose: the sentence that says what went wrong and the
 * error code. `write CONNECT_TIMEOUT [host]:[port] [CONNECT_TIMEOUT]` still
 * tells you the server never answered. A log hardened into uselessness gets
 * reverted at 2am by someone who needs it.
 */
export function describeDbError(error: unknown): string {
  if (!(error instanceof Error)) return redactConnectionParts(String(error));
  const code = errorCode(error);
  return redactConnectionParts(code ? `${error.message} [${code}]` : error.message);
}

/**
 * The code can sit on the error itself (ENOTFOUND, CONNECT_TIMEOUT, and every
 * PostgresError's SQLSTATE) or on its cause (a query wrapping a socket error).
 * Reading only the cause, as this once did, silently dropped the code for the
 * connection failures that matter most on a first run.
 */
function errorCode(error: Error): string | null {
  const own = (error as { code?: unknown }).code;
  if (own !== undefined && own !== null && own !== "") return String(own);
  const cause: unknown = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object" && "code" in cause) {
    const fromCause = (cause as { code?: unknown }).code;
    if (fromCause !== undefined && fromCause !== null && fromCause !== "") {
      return String(fromCause);
    }
  }
  return null;
}

/**
 * Replace every fragment of DATABASE_URL with a label naming what was removed.
 *
 * Longest match first, so `host:port` and the full URL are consumed before the
 * shorter parts inside them. Fragments under three characters are left alone:
 * substituting a one- or two-character value would corrupt unrelated words, and
 * a credential that short is not what this is defending.
 */
function redactConnectionParts(text: string): string {
  const url = process.env.DATABASE_URL;
  if (!url) return text;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // The URL is set but unparseable, so its parts are unknown and nothing can
    // be checked against them. Refusing to print is the only safe answer.
    //
    // This is a SUBSTITUTION, not a loss: the sentence below tells the operator
    // that DATABASE_URL will not parse, which is very nearly what the swallowed
    // message was about to say anyway.
    //
    // KNOWN DEGRADATION, one credential format. postgres.js also accepts the
    // libpq keyword DSN ("host=db.example.com user=me dbname=radar"), which
    // `new URL()` rejects. Someone connecting that way would connect fine and
    // then get this line for EVERY error, with the real reason swallowed.
    // Remote — .env.example and Neon both hand out URL-form strings — and left
    // as a caveat rather than a parser, because a second parser is a second
    // thing to get wrong. Named here so the next person meets it instead of
    // discovering it.
    return "[redacted: DATABASE_URL is set but could not be parsed, so the parts that would need removing are unknown]";
  }

  // Both forms of every part that can be percent-encoded: the RAW form as it
  // sits in the URL, and the DECODED form a driver is likely to print. Today
  // postgres.js prints decoded values, so the decoded form is the one that
  // fires — but the whole reason this redacts by value rather than by message
  // shape is to cover forms nothing has produced yet. Carrying both for the
  // user and only one for the password would be that principle applied to one
  // field and dropped for the next, in the file that exists to apply it.
  const rawDatabase = parsed.pathname.replace(/^\//, "");
  const candidates: Array<[string, string]> = [
    [url, "[connection string]"],
    [`${parsed.hostname}:${parsed.port}`, "[host]:[port]"],
    [safeDecode(parsed.password), "[password]"],
    [parsed.password, "[password]"],
    [parsed.hostname, "[host]"],
    [safeDecode(parsed.username), "[user]"],
    [parsed.username, "[user]"],
    [safeDecode(rawDatabase), "[database]"],
    [rawDatabase, "[database]"],
    [parsed.port, "[port]"],
  ];

  let out = text;
  for (const [value, label] of candidates
    .filter(([value]) => value.length >= 3)
    .sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(value).join(label);
  }
  return out;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

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
