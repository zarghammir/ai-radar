/**
 * READ-ONLY capture of why ingestion has been failing, run before migrating.
 *
 * WHY IT EXISTS. Migration 0003 rewrites every `sources.last_error` and
 * `ingest_runs.error` to a placeholder. It was a no-op when it was written —
 * those columns were null everywhere — and it is not one now: they hold two
 * days of failure diagnostics. Applying the pending migrations destroys the
 * evidence for the outage they fix, so this runs first.
 *
 * WHY IT IS AWKWARD, AND WHAT THAT FORCED. The text being captured is the
 * exact text #99 exists to remove: 0003's own message says it "may have
 * contained part of the database connection string". THIS REPOSITORY IS PUBLIC
 * AND ACTIONS LOGS ARE WORLD-READABLE. A probe that printed those columns raw
 * would recreate the leak #121 closed, in a step whose purpose is preserving
 * evidence. So:
 *
 *   - every string read from the database goes through redactConnectionParts
 *     BEFORE it can reach stdout — AT READ TIME, not trusting write-time
 *     redaction, because write-time redaction only landed at d8ec412 and rows
 *     older than that were written without it;
 *   - error text is REPORTED AS SHAPES WITH COUNTS, never row by row;
 *   - an unrecognised shape is printed truncated, and the truncation is stated.
 *
 * WHAT THIS DOES NOT PRINT, so the operator knows what he is not seeing:
 *   - no connection string, host, port, user, password or database name
 *   - no row-level error text; only classified shapes and counts
 *   - no story, item or source CONTENT — keys and column names only
 *   - no SQL parameters
 *
 * IT IS READ-ONLY BY CONSTRUCTION: every statement below is a SELECT. It takes
 * no argument that could make it write, and it never calls migrate or seed.
 */
import "dotenv/config";
import postgres from "postgres";
import { getTableColumns } from "drizzle-orm";
import { rawItems, stories } from "@/db/schema";
import { redactConnectionParts } from "@/db/redact";

/** Nothing reaches stdout except through here. */
const say = (line: string) => console.log(redactConnectionParts(line));

/**
 * The shapes we expect. An error matching NONE of these is the interesting
 * case and is reported separately — without it this probe could only ever
 * agree with the diagnosis it was written to confirm.
 */
const SHAPES: Array<[string, RegExp]> = [
  ["missing column", /column "([a-z_]+)" of relation "([a-z_]+)" does not exist/i],
  ["missing column (bare)", /column "([a-z_]+)" does not exist/i],
  ["missing relation", /relation "([a-z_]+)" does not exist/i],
  ["not-null violation", /null value in column "([a-z_]+)"/i],
  ["unique violation", /duplicate key value violates unique constraint "([a-z_]+)"/i],
  ["type mismatch", /invalid input syntax for type/i],
  ["permission denied", /permission denied for/i],
  ["connection", /ECONNREFUSED|ENOTFOUND|CONNECT_TIMEOUT|terminating connection/i],
];

function classify(text: string): { shape: string; detail: string } {
  for (const [shape, re] of SHAPES) {
    const m = text.match(re);
    if (m) return { shape, detail: m.slice(1).filter(Boolean).join(".") || "-" };
  }
  return { shape: "UNRECOGNISED", detail: "-" };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  say("=== 1. MIGRATIONS APPLIED IN THIS DATABASE ===");
  const applied = await sql`
    select count(*)::int as n, max(created_at) as latest
    from drizzle.__drizzle_migrations`.catch(() => null);
  if (!applied) {
    say(
      "  the drizzle journal table could not be read — this database may never have been migrated",
    );
  } else {
    say(`  ${applied[0].n} migration(s) applied, most recent at ${applied[0].latest ?? "unknown"}`);
  }

  say("");
  say("=== 2. COLUMNS THE CODE EXPECTS vs COLUMNS THIS DATABASE HAS ===");
  say("  This is the definitive check. It can disagree with the diagnosis:");
  say("  if nothing is missing, the failure is NOT a schema gap.");
  for (const [label, table] of [
    ["raw_items", rawItems],
    ["stories", stories],
  ] as const) {
    const expected = Object.values(getTableColumns(table))
      .map((c) => c.name)
      .sort();
    const rows = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = ${label}`;
    const actual = new Set(rows.map((r) => r.column_name));
    const missing = expected.filter((c) => !actual.has(c));
    say(`  ${label}: ${expected.length} expected, ${actual.size} present`);
    say(missing.length ? `    MISSING: ${missing.join(", ")}` : "    MISSING: none");
  }

  say("");
  say("=== 3. FAILURE SHAPES IN ingest_runs.error (redacted at read, counted) ===");
  const runs = await sql<{ error: string | null; started_at: Date }[]>`
    select error, started_at from ingest_runs
    where error is not null order by started_at desc limit 2000`;
  say(`  ${runs.length} failed run row(s) read (most recent 2000)`);
  const byShape = new Map<string, { n: number; oldest: string; newest: string; sample: string }>();
  for (const r of runs) {
    const text = redactConnectionParts(r.error ?? "");
    const { shape, detail } = classify(text);
    const key = `${shape} :: ${detail}`;
    const when = new Date(r.started_at).toISOString().slice(0, 16);
    const cur = byShape.get(key);
    if (!cur) byShape.set(key, { n: 1, oldest: when, newest: when, sample: text.slice(0, 200) });
    else {
      cur.n++;
      if (when < cur.oldest) cur.oldest = when;
      if (when > cur.newest) cur.newest = when;
    }
  }
  for (const [key, v] of [...byShape.entries()].sort((a, b) => b[1].n - a[1].n)) {
    say(`  ${String(v.n).padStart(5)}x  ${key}   first ${v.oldest}  last ${v.newest}`);
    if (key.startsWith("UNRECOGNISED")) {
      say(`         sample (redacted, first 200 chars): ${v.sample}`);
    }
  }
  if (byShape.size === 0) say("  none — no failed runs are recorded");

  say("");
  say("=== 4. sources.last_error, shapes only ===");
  const srcs = await sql<{ key: string; last_error: string | null }[]>`
    select key, last_error from sources where last_error is not null`;
  const srcShapes = new Map<string, number>();
  for (const s of srcs) {
    const { shape, detail } = classify(redactConnectionParts(s.last_error ?? ""));
    const key = `${shape} :: ${detail}`;
    srcShapes.set(key, (srcShapes.get(key) ?? 0) + 1);
  }
  say(`  ${srcs.length} source(s) carry an error`);
  for (const [k, n] of [...srcShapes.entries()].sort((a, b) => b[1] - a[1])) {
    say(`  ${String(n).padStart(5)}x  ${k}`);
  }

  say("");
  say("=== WHAT THIS DID NOT PRINT ===");
  say("  no connection string, host, port, user, password or database name");
  say("  no row-level error text (only classified shapes and counts)");
  say("  no story, item or source content — keys and column names only");
  say("  every string above passed through redactConnectionParts at read time");

  await sql.end();
}

main().catch((err: unknown) => {
  // The probe's own failure goes through the same redaction as everything else.
  console.error(redactConnectionParts(err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
