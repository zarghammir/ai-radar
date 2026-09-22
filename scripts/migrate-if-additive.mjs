#!/usr/bin/env node
/**
 * Applies pending migrations ONLY if every one of them is additive.
 *
 * Reads production's watermark first, because that is the fact nothing else in
 * this repository checks. #122 verifies the journal is ordered in a PR; nothing
 * verifies it against what production ACTUALLY HAS — and drizzle skips a
 * below-watermark entry permanently (pg-core/dialect.cjs:58-68).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { classifyMigration, plan } from "./migration-gate.mjs";

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));

// The created_at VALUES, not a count. `__drizzle_migrations.created_at` IS the
// journal's `when`: the migrator carries journalEntry.when through as
// folderMillis (migrator.cjs:55) and inserts it as created_at
// (pg-core/dialect.cjs:69). So the ledger says exactly which entries ran.
//
// IT USED TO DERIVE THIS FROM ARRAY INDEX — `applied: i < count` — which is
// correct only if the journal's order matches production's application order.
// THAT IS THE INVARIANT #122 ENFORCES IN A PULL REQUEST, and this check exists
// because PR-time invariants may not hold in production. It derived its key
// input from the one thing it was written not to trust.
//
// The failure was silent and in the dangerous direction: a below-watermark
// UNAPPLIED entry whose index happened to fall under the count was marked
// applied, dropped out of belowWatermark, and THE GATE PASSED — while drizzle
// skipped it permanently. That is the scenario this check was built for.
const rows = await sql`
  select created_at from drizzle.__drizzle_migrations`.catch(() => []);
const appliedWhens = new Set(rows.map((r) => Number(r.created_at)));
const watermark = appliedWhens.size ? Math.max(...appliedWhens) : 0;
console.log(`  production: ${appliedWhens.size} applied, watermark ${watermark}`);

const entries = journal.entries.map((e) => ({ ...e, applied: appliedWhens.has(e.when) }));
const { pending, belowWatermark } = plan(entries, watermark);

if (belowWatermark.length > 0) {
  console.error(
    `::error::${belowWatermark.map((e) => e.tag).join(", ")} sit BELOW production's watermark ` +
      `and drizzle will never apply them. No later migrate recovers this.`,
  );
  await sql.end();
  process.exit(1);
}

console.log(`  ${pending.length} pending: ${pending.map((e) => e.tag).join(", ") || "none"}`);
const blocking = pending
  .map((e) => ({ tag: e.tag, ...classifyMigration(readFileSync(`drizzle/${e.tag}.sql`, "utf8")) }))
  .filter((c) => c.kind === "destructive");

await sql.end();

if (blocking.length > 0) {
  for (const b of blocking)
    console.error(`::error::${b.tag} is a DECISION, not an automatic step — it ${b.why}`);
  console.error(
    "::error::The database is now BEHIND the code. Apply deliberately via 'Set up the database'.",
  );
  process.exit(1);
}

if (pending.length === 0) {
  console.log("RESULT: nothing pending.");
} else {
  console.log(`RESULT: all ${pending.length} pending migration(s) are additive — applying.`);
  execFileSync("npm", ["run", "db:migrate"], { stdio: "inherit" });
}
