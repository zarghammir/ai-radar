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
 *   npm run db:seed
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "./client";
import { sources, topics } from "./schema";
import { SOURCE_SEEDS, TOPIC_SEEDS } from "./seed-data";

async function seedSources(db: ReturnType<typeof getDb>) {
  const existing = new Set((await db.select({ key: sources.key }).from(sources)).map((r) => r.key));

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

  const catalogue = new Set(SOURCE_SEEDS.map((s) => s.key));
  return {
    total: SOURCE_SEEDS.length,
    created: SOURCE_SEEDS.filter((s) => !existing.has(s.key)).length,
    orphans: [...existing].filter((k) => !catalogue.has(k)),
  };
}

async function seedTopics(db: ReturnType<typeof getDb>) {
  const existing = new Set((await db.select({ key: topics.key }).from(topics)).map((r) => r.key));

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

  const catalogue = new Set(TOPIC_SEEDS.map((t) => t.key));
  return {
    total: TOPIC_SEEDS.length,
    created: TOPIC_SEEDS.filter((t) => !existing.has(t.key)).length,
    orphans: [...existing].filter((k) => !catalogue.has(k)),
  };
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

  console.log(`Sources: ${s.total} (${s.created} created, ${s.total - s.created} already present)`);
  for (const [tier, n] of Object.entries(byTier).sort()) console.log(`  ${tier.padEnd(24)} ${n}`);
  console.log(`Topics:  ${t.total} (${t.created} created, ${t.total - t.created} already present)`);
  for (const [group, n] of Object.entries(byGroup).sort())
    console.log(`  ${group.padEnd(24)} ${n}`);

  for (const k of s.orphans)
    console.log(`  note: source "${k}" is in the database but not the catalogue; left alone`);
  for (const k of t.orphans)
    console.log(`  note: topic "${k}" is in the database but not the catalogue; left alone`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
