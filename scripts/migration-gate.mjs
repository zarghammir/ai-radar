#!/usr/bin/env node
/**
 * Decides whether pending migrations may apply THEMSELVES.
 *
 * THE OUTAGE THIS EXISTS FOR. Migration 0004 added two columns; #71 began
 * writing them in the same change; nothing applies migrations on merge, so the
 * code went live against a database that had never seen them. Seventeen
 * sources failed every thirty minutes for four days.
 *
 * SO WHY NOT JUST RUN db:migrate ON MERGE. Because a migration that applies
 * itself is a DESTRUCTIVE OPERATION that applies itself. The set pending during
 * that outage was three irreversible DROPs and an UPDATE that erases
 * diagnostics — 0003 would have wiped the evidence for the outage before anyone
 * read it, automatically, and nobody would have chosen that.
 *
 * THE RULE, machine-evaluable rather than judgement, because "use judgement" is
 * the exceptions-list problem wearing a nicer hat:
 *
 *   ADDITIVE     may apply itself, and MUST RUN BEFORE the code that uses it
 *   DESTRUCTIVE  is a decision, and MUST RUN AFTER the code stops using it
 *
 * Those are OPPOSITE ORDERS. That is why this cannot be one step: a single
 * migrate-on-merge would put destructive changes on the additive schedule and
 * drop a column while the old code is still reading it — the mirror of the
 * outage it was built to fix.
 *
 * UNKNOWN COUNTS AS DESTRUCTIVE. A gate that cannot classify a statement must
 * not guess the answer that lets it proceed. Same rule as the alarm that cannot
 * tell whether an issue is open.
 */

/** Statements that only ever ADD. Everything else needs a human. */
const ADDITIVE = [
  /^create\s+(table|index|unique\s+index|schema|type|extension)\b/i,
  /^alter\s+table\s+\S+\s+add\s+column\b/i,
  /^alter\s+table\s+\S+\s+add\s+constraint\b/i,
  /^comment\s+on\b/i,
  // Adds an enum value. Found by running --classify-all against the real
  // migrations: 0001 came back UNRECOGNISED, and failing closed on a genuinely
  // additive form would make the gate refuse everything and get switched off.
  /^alter\s+type\s+\S+\s+add\s+value\b/i,
];

/** Named explicitly so the log can say WHICH kind of decision it is. */
const DESTRUCTIVE = [
  [/\bdrop\s+(table|column|index|schema|type|constraint)\b/i, "drops a schema object"],
  [/^update\b/i, "rewrites existing rows"],
  [/^delete\b/i, "deletes rows"],
  [/^truncate\b/i, "empties a table"],
  [/\balter\s+column\s+\S+\s+set\s+not\s+null\b/i, "can fail on existing rows"],
  [/\balter\s+column\s+\S+\s+type\b/i, "rewrites a column's values"],
];

/** @returns {{kind: "additive"|"destructive", why: string}} */
export function classifyStatement(raw) {
  const sql = raw
    .replace(/--[^\n]*/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!sql) return { kind: "additive", why: "empty" };
  for (const [re, why] of DESTRUCTIVE) if (re.test(sql)) return { kind: "destructive", why };
  for (const re of ADDITIVE) if (re.test(sql)) return { kind: "additive", why: "adds only" };
  return { kind: "destructive", why: "UNRECOGNISED — a gate that cannot classify must not guess" };
}

/** @returns {{kind: "additive"|"destructive", why: string}} */
export function classifyMigration(sqlText) {
  const statements = sqlText.split("--> statement-breakpoint");
  for (const s of statements) {
    const c = classifyStatement(s);
    if (c.kind === "destructive") return c;
  }
  return { kind: "additive", why: "adds only" };
}

/**
 * What a migrate would do against a database at `watermark`.
 *
 * `belowWatermark` is the trap #122 cannot see: drizzle reads MAX(created_at)
 * ONCE before its transaction and compares every migration to that same value
 * (pg-core/dialect.cjs:58-68), so an entry whose `when` is below it IS SKIPPED
 * PERMANENTLY. No later migrate recovers it. #122 checks the journal is ordered
 * in a PR; nothing checks it against what PRODUCTION actually has.
 */
export function plan(entries, watermark) {
  const pending = entries.filter((e) => e.when > watermark);
  const belowWatermark = entries.filter((e) => e.when <= watermark && !e.applied);
  return { pending, belowWatermark };
}

const classifyAll = process.argv.includes("--classify-all");
if (classifyAll) {
  const { readFileSync, readdirSync } = await import("node:fs");
  const files = readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let anyDestructive = false;
  for (const f of files) {
    const c = classifyMigration(readFileSync(`drizzle/${f}`, "utf8"));
    if (c.kind === "destructive") anyDestructive = true;
    console.log(`  ${c.kind.padEnd(11)} ${f.padEnd(40)} ${c.why}`);
  }
  console.log(
    anyDestructive ? "RESULT: at least one migration needs a decision" : "RESULT: all additive",
  );
} else if (process.argv.includes("--self-test")) {
  const cases = [
    ['ALTER TABLE "raw_items" ADD COLUMN "x" boolean;', "additive"],
    ['CREATE TABLE "t" (id serial);', "additive"],
    ['CREATE UNIQUE INDEX "i" ON "t" ("c");', "additive"],
    ['ALTER TABLE "user_preferences" DROP COLUMN "email";', "destructive"],
    ['UPDATE "sources" SET "last_error" = NULL;', "destructive"],
    ['DELETE FROM "t";', "destructive"],
    ['ALTER TABLE "t" ALTER COLUMN "c" SET NOT NULL;', "destructive"],
    ["ALTER TYPE \"public\".\"t\" ADD VALUE 'X' BEFORE 'Y';", "additive"],
    ["VACUUM FULL;", "destructive"], // unrecognised must fail closed
  ];
  let bad = 0;
  for (const [sql, want] of cases) {
    const got = classifyStatement(sql).kind;
    if (got !== want) bad++;
    console.log(`  ${got === want ? "ok  " : "FAIL"} ${want.padEnd(11)} ${sql.slice(0, 52)}`);
  }
  // A migration is destructive if ANY statement is — 0004 adds two columns and
  // is additive; 0006 drops three and is not.
  const mixed =
    'ALTER TABLE "t" ADD COLUMN "a" int;--> statement-breakpoint\nALTER TABLE "t" DROP COLUMN "b";';
  if (classifyMigration(mixed).kind !== "destructive") {
    bad++;
    console.log("  FAIL a migration with one destructive statement must be destructive");
  } else console.log("  ok   mixed migration classifies as destructive");

  const entries = [
    { when: 10, applied: true },
    { when: 20, applied: false },
    { when: 5, applied: false },
  ];
  const p = plan(entries, 10);
  if (p.pending.length !== 1 || p.belowWatermark.length !== 1) {
    bad++;
    console.log("  FAIL plan() must find 1 pending and 1 permanently-skipped");
  } else console.log("  ok   plan() finds the below-watermark entry drizzle would skip forever");

  console.log(bad === 0 ? "RESULT: all cases pass" : `RESULT: ${bad} wrong`);
  process.exit(bad === 0 ? 0 : 1);
}
