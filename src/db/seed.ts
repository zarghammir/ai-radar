/**
 * Seeds the shipped catalogue of sources and topics.
 *
 * Idempotent: keyed upsert, safe to run any number of times. Two rules make
 * that true in practice rather than only on a clean database.
 *
 *  - Operational state is never overwritten. `enabled`, `lastFetchedAt` and
 *    `lastError` belong to the operator and the worker, so re-seeding does not
 *    re-enable a source somebody switched off.
 *  - Nothing is ever deleted. A source row in the database that is no longer in
 *    the catalogue is reported, not removed: raw_items references sources with
 *    ON DELETE CASCADE, so deleting one would take its stored items with it.
 *
 * Those two rules are also what makes seed-on-merge.yml safe to run unattended.
 *
 * WHAT THE SUMMARY USED TO SAY, AND WHY IT WAS CHANGED. It printed
 * `SOURCE_SEEDS.length` — the catalogue's own count — and derived "created"
 * from a read taken BEFORE the insert. Both numbers describe the code's
 * intention, not the database's state, so a run could print "Sources: 25" while
 * the database held 18 and no line in the output would differ. It did: seven
 * sources were merged on 2026-09-22 and were still absent from production on
 * 2026-09-29, and every seed run in between would have printed the same 25.
 * The count below is now read back AFTER the write, and a catalogue entry that
 * is not in the database when this finishes fails the run.
 *
 *   npm run db:seed
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { describeDbError, getDb } from "./client";
import { sources, topics } from "./schema";
import { SOURCE_SEEDS, TOPIC_SEEDS } from "./seed-data";

type SeedResult = {
  /** Catalogue keys the database holds once the write has finished. */
  present: number;
  /** Catalogue size, for the "N of M" the summary prints. */
  expected: number;
  created: number;
  /** Catalogue entries still absent after the upsert. Non-empty fails the run. */
  missing: string[];
  orphans: string[];
};

/** Reads the key column back out of the database. */
async function keysIn(
  db: ReturnType<typeof getDb>,
  table: typeof sources | typeof topics,
): Promise<Set<string>> {
  return new Set((await db.select({ key: table.key }).from(table)).map((r) => r.key));
}

/**
 * Compares the catalogue against a read of the database taken after the write.
 * Both `present` and `missing` come from `after`, never from the catalogue, so
 * an entry the upsert did not land shows up here rather than in the next
 * person's bug report.
 */
function reconcile(catalogue: string[], before: Set<string>, after: Set<string>): SeedResult {
  const inCatalogue = new Set(catalogue);
  return {
    present: catalogue.filter((k) => after.has(k)).length,
    expected: catalogue.length,
    // Also read back: a key counts as created only if the database has it now.
    // Counting "not previously there" from the catalogue alone is the same
    // mistake as the summary line, and made the failure path print "-1
    // already present" when an entry did not land.
    created: catalogue.filter((k) => !before.has(k) && after.has(k)).length,
    missing: catalogue.filter((k) => !after.has(k)),
    orphans: [...after].filter((k) => !inCatalogue.has(k)),
  };
}

async function seedSources(db: ReturnType<typeof getDb>): Promise<SeedResult> {
  const before = await keysIn(db, sources);

  await db
    .insert(sources)
    .values(
      SOURCE_SEEDS.map((s) => ({
        key: s.key,
        name: s.name,
        kind: s.kind,
        tier: s.tier,
        url: s.url,
        homepage: s.homepage,
        config: s.config ?? {},
        defaultContentType: s.defaultContentType,
        enabled: s.enabled ?? true,
      })),
    )
    .onConflictDoUpdate({
      target: sources.key,
      // Catalogue fields only. `enabled` is deliberately absent.
      set: {
        name: sql`excluded.name`,
        kind: sql`excluded.kind`,
        tier: sql`excluded.tier`,
        url: sql`excluded.url`,
        homepage: sql`excluded.homepage`,
        config: sql`excluded.config`,
        defaultContentType: sql`excluded.default_content_type`,
      },
    });

  return reconcile(
    SOURCE_SEEDS.map((s) => s.key),
    before,
    await keysIn(db, sources),
  );
}

async function seedTopics(db: ReturnType<typeof getDb>): Promise<SeedResult> {
  const before = await keysIn(db, topics);

  await db
    .insert(topics)
    .values(
      TOPIC_SEEDS.map((t) => ({ key: t.key, name: t.name, group: t.group, keywords: t.keywords })),
    )
    .onConflictDoUpdate({
      target: topics.key,
      set: {
        name: sql`excluded.name`,
        group: sql`excluded."group"`,
        keywords: sql`excluded.keywords`,
      },
    });

  return reconcile(
    TOPIC_SEEDS.map((t) => t.key),
    before,
    await keysIn(db, topics),
  );
}

function report(label: string, r: SeedResult, breakdown: Record<string, number>) {
  console.log(
    `${label.padEnd(8)} ${r.present} of ${r.expected} in the database ` +
      `(${r.created} created, ${r.present - r.created} already present)`,
  );
  for (const [k, n] of Object.entries(breakdown).sort()) console.log(`  ${k.padEnd(24)} ${n}`);
}

async function main() {
  const db = getDb();
  const s = await seedSources(db);
  const t = await seedTopics(db);

  const byTier = SOURCE_SEEDS.reduce<Record<string, number>>((a, x) => {
    a[x.tier] = (a[x.tier] ?? 0) + 1;
    return a;
  }, {});
  const byGroup = TOPIC_SEEDS.reduce<Record<string, number>>((a, x) => {
    a[x.group] = (a[x.group] ?? 0) + 1;
    return a;
  }, {});

  report("Sources:", s, byTier);
  report("Topics:", t, byGroup);

  for (const k of s.orphans)
    console.log(`  note: source "${k}" is in the database but not the catalogue; left alone`);
  for (const k of t.orphans)
    console.log(`  note: topic "${k}" is in the database but not the catalogue; left alone`);

  // The catalogue is the source of truth for what SHOULD exist, and the only
  // way to see an entry that never landed is to ask the database for it by
  // name. Counting rows cannot: an orphan makes up for a missing entry exactly.
  const missing = [
    ...s.missing.map((k) => `source "${k}"`),
    ...t.missing.map((k) => `topic "${k}"`),
  ];
  if (missing.length > 0) {
    throw new Error(
      `Seeding finished but the database is still missing ${missing.length} catalogue ` +
        `${missing.length === 1 ? "entry" : "entries"}: ${missing.join(", ")}. ` +
        `The upsert reported no error, so this is a schema or permissions problem, ` +
        `not a duplicate key.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(describeDbError(err));
    process.exit(1);
  });
