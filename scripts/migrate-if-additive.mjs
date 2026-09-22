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

const rows = await sql`
  select coalesce(max(created_at), 0)::bigint as w,
         count(*)::int as n
  from drizzle.__drizzle_migrations`.catch(() => [{ w: 0n, n: 0 }]);
const watermark = Number(rows[0].w);
console.log(`  production: ${rows[0].n} applied, watermark ${watermark}`);

const entries = journal.entries.map((e, i) => ({ ...e, applied: i < rows[0].n }));
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
