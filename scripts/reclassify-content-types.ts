import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { getDb, getSql } from "@/db/client";
import { rawItems, sources, stories, type ContentType } from "@/db/schema";
import { classifyContentType } from "@/pipeline/normalize/content-type";
import { rankAllStories } from "@/pipeline/ranking/rank-all";
import { refreshStory } from "@/pipeline/run";

/**
 * One-off re-classification of stored items against the content-type
 * classifier (#41).
 *
 * Deliberately a command someone runs, not a step that fires on deploy. It
 * rewrites a column on every stored item and re-scores the corpus, which is a
 * thing to do on purpose while watching it, not a side effect of shipping.
 *
 * Dry run unless --apply is passed, because the useful output is the report
 * rather than the write.
 *
 *   npm run backfill:content-types           # report only
 *   npm run backfill:content-types -- --apply
 */

const APPLY = process.argv.includes("--apply");

/**
 * Whether a stored type came from an adapter rather than from the source
 * default, without re-fetching the feed.
 *
 * Before this change, normalizeItem wrote `item.contentType ?? defaultContentType`
 * and nothing else, so a stored type that differs from its source's default can
 * only have been declared by the adapter. That is how Hacker News's DISCUSSION
 * survives this pass: its source defaults to NEWS, so DISCUSSION differs and is
 * left alone, while its link posts sit at the NEWS default and are classified.
 */
function wasAdapterDeclared(stored: ContentType, sourceDefault: ContentType): boolean {
  return stored !== sourceDefault;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main(): Promise<void> {
  const db = getDb();
  const started = Date.now();

  const items = await db
    .select({
      id: rawItems.id,
      title: rawItems.title,
      stored: rawItems.contentType,
      storyId: rawItems.storyId,
      sourceKey: sources.key,
      sourceDefault: sources.defaultContentType,
    })
    .from(rawItems)
    .innerJoin(sources, eq(sources.id, rawItems.sourceId));

  const readMs = Date.now() - started;
  if (items.length === 0) {
    console.log("No stored items. Nothing to reclassify.");
    await getSql().end();
    return;
  }

  const changes: Array<{ id: number; from: ContentType; to: ContentType; storyId: number | null }> =
    [];
  let skippedAdapter = 0;
  const transitions = new Map<string, number>();
  const bySource = new Map<string, number>();

  for (const item of items) {
    if (wasAdapterDeclared(item.stored, item.sourceDefault)) {
      skippedAdapter++;
      continue;
    }
    const next = classifyContentType(item.title, item.sourceDefault);
    if (next === item.stored) continue;
    changes.push({ id: item.id, from: item.stored, to: next, storyId: item.storyId });
    const key = `${item.stored} -> ${next}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
    bySource.set(item.sourceKey, (bySource.get(item.sourceKey) ?? 0) + 1);
  }

  console.log(`items:              ${items.length} (read in ${readMs}ms)`);
  console.log(`adapter-declared:   ${skippedAdapter} left untouched`);
  console.log(
    `reclassified:       ${changes.length} (${((changes.length / items.length) * 100).toFixed(1)}%)`,
  );

  console.log("\nby transition");
  for (const [key, n] of [...transitions].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(key, 24)} ${n}`);
  }
  console.log("\nby source");
  for (const [key, n] of [...bySource].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(key, 24)} ${n}`);
  }

  const storyIds = [
    ...new Set(changes.map((c) => c.storyId).filter((id): id is number => id != null)),
  ];
  console.log(`\nstories touched:    ${storyIds.length}`);

  if (!APPLY) {
    console.log("\nDry run. Nothing written. Re-run with --apply to write.");
    await getSql().end();
    return;
  }

  const writeStarted = Date.now();
  await db.transaction(async (tx) => {
    for (const c of changes) {
      await tx.update(rawItems).set({ contentType: c.to }).where(eq(rawItems.id, c.id));
    }
    // Story type is recomputed by refreshStory from the primary item rather
    // than written here, so the backfill cannot disagree with the pipeline
    // about how a story gets its type. It also recomputes verification,
    // topics and counts, which is idempotent and correct to redo.
    for (const storyId of storyIds) await refreshStory(tx, storyId);
  });
  const writeMs = Date.now() - writeStarted;

  // Content type is a ranking component, so leaving scores alone would change
  // every badge and no ordering — a half-applied migration.
  const rankStarted = Date.now();
  const ranked = await rankAllStories(db);
  const rankMs = Date.now() - rankStarted;

  const after = await db
    .select({ id: stories.id, contentType: stories.contentType })
    .from(stories)
    .where(inArray(stories.id, storyIds.length ? storyIds : [-1]));
  const storyTypes = new Map<string, number>();
  for (const s of after) storyTypes.set(s.contentType, (storyTypes.get(s.contentType) ?? 0) + 1);

  console.log(`\napplied.`);
  console.log(`  items + stories:  ${writeMs}ms`);
  console.log(`  re-ranked:        ${ranked.ranked} stories in ${rankMs}ms`);
  console.log(`  total:            ${Date.now() - started}ms`);
  console.log("\ntouched stories now typed");
  for (const [type, n] of [...storyTypes].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(type, 24)} ${n}`);
  }
  await getSql().end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
