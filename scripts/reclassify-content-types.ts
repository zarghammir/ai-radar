import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { getDb, getSql } from "@/db/client";
import { rawItems, sources, stories, userPreferences, type ContentType } from "@/db/schema";
import { decideContentType } from "@/pipeline/normalize/content-type";
import { rankOneInTransaction } from "@/pipeline/ranking/rank-all";
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

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function run(): Promise<void> {
  const db = getDb();
  const now = new Date();
  const started = Date.now();

  const items = await db
    .select({
      id: rawItems.id,
      title: rawItems.title,
      stored: rawItems.contentType,
      storedSource: rawItems.contentTypeSource,
      storyId: rawItems.storyId,
      sourceKey: sources.key,
      sourceDefault: sources.defaultContentType,
    })
    .from(rawItems)
    .innerJoin(sources, eq(sources.id, rawItems.sourceId));

  const readMs = Date.now() - started;
  if (items.length === 0) {
    console.log("No stored items. Nothing to reclassify.");
    return;
  }

  const changes: Array<{ id: number; from: ContentType; to: ContentType; storyId: number | null }> =
    [];
  let skippedAdapter = 0;
  const transitions = new Map<string, number>();
  const bySource = new Map<string, number>();

  for (const item of items) {
    // Provenance is read, never inferred. `stored !== sourceDefault` used to
    // mean "an adapter set this", and stopped meaning it the moment the
    // classifier could move a type: a second run would file this script's own
    // output as an adapter's declaration and refuse to re-apply a changed rule
    // to it. Editing a source's default in the catalogue broke it the same way.
    if (item.storedSource === "adapter") {
      skippedAdapter++;
      continue;
    }
    const next = decideContentType(undefined, item.title, item.sourceDefault).type;
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
    return;
  }

  const [prefs] = await db
    .select({ topicKeys: userPreferences.topicKeys })
    .from(userPreferences)
    .where(eq(userPreferences.id, 1));
  const userTopicKeys = prefs?.topicKeys ?? [];

  const writeStarted = Date.now();
  let ranked = 0;
  // Retype, refresh and re-score in ONE transaction. Content type is a ranking
  // component, so a commit here and a re-rank afterwards leaves a window in
  // which a story wears the new badge and carries a score computed without it
  // — the half-applied migration this script exists to avoid. Only the touched
  // stories are re-scored, because a story's score does not depend on any
  // other story's type.
  await db.transaction(async (tx) => {
    for (const c of changes) {
      await tx
        .update(rawItems)
        .set({ contentType: c.to, contentTypeSource: "classifier" })
        .where(eq(rawItems.id, c.id));
    }
    // Story type is recomputed by refreshStory from the primary item rather
    // than written here, so the backfill cannot disagree with the pipeline
    // about how a story gets its type. It also recomputes verification,
    // topics and counts, which is idempotent and correct to redo.
    for (const storyId of storyIds) {
      await refreshStory(tx, storyId);
      if (await rankOneInTransaction(tx, storyId, userTopicKeys, now)) ranked++;
    }
  });
  const writeMs = Date.now() - writeStarted;

  const after = await db
    .select({ id: stories.id, contentType: stories.contentType })
    .from(stories)
    .where(inArray(stories.id, storyIds.length ? storyIds : [-1]));
  const storyTypes = new Map<string, number>();
  for (const s of after) storyTypes.set(s.contentType, (storyTypes.get(s.contentType) ?? 0) + 1);

  console.log(`\napplied.`);
  console.log(`  retype + refresh + re-score: ${writeMs}ms in one transaction`);
  console.log(`  re-scored:        ${ranked} of ${storyIds.length} touched stories`);
  console.log(`  total:            ${Date.now() - started}ms`);
  console.log("\ntouched stories now typed");
  for (const [type, n] of [...storyTypes].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(type, 24)} ${n}`);
  }
}

/**
 * The connection is closed in a `finally`, not on the success path. An open
 * postgres handle keeps node alive, so a backfill that threw used to print a
 * stack trace and then hang forever instead of exiting — the operator sees a
 * command that never returns, which is worse than the failure it is reporting.
 */
async function main(): Promise<void> {
  try {
    await run();
  } finally {
    await getSql().end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
