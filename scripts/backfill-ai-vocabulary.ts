import "dotenv/config";
import { eq, isNull } from "drizzle-orm";
import { getDb, getSql } from "@/db/client";
import { rawItems, sources } from "@/db/schema";
import { matchedAiVocabulary } from "@/pipeline/normalize/ai-vocabulary";
import { refreshStory } from "@/pipeline/run";

/**
 * Fill in `matched_ai_vocabulary` for items stored before #71, and recompute
 * the stories above them.
 *
 * A command someone runs, not a step that fires on deploy. Dry run unless
 * --apply is passed.
 *
 *   npm run backfill:ai-vocabulary
 *   npm run backfill:ai-vocabulary -- --apply
 */

const APPLY = process.argv.includes("--apply");

async function run(): Promise<void> {
  const db = getDb();
  const started = Date.now();

  const rows = await db
    .select({
      id: rawItems.id,
      title: rawItems.title,
      storyId: rawItems.storyId,
      sourceKey: sources.key,
      config: sources.config,
    })
    .from(rawItems)
    .innerJoin(sources, eq(sources.id, rawItems.sourceId))
    .where(isNull(rawItems.matchedAiVocabulary));

  if (rows.length === 0) {
    console.log("No unevaluated items. Nothing to do.");
    return;
  }

  const decided = rows.map((r) => {
    // The source's own vocabulary when it has one, so the backfill answers the
    // same question the gate asked rather than a more convenient one.
    const configured = (r.config as Record<string, unknown> | null)?.keywords;
    const keywords = Array.isArray(configured) ? (configured as string[]) : undefined;
    return { ...r, matched: matchedAiVocabulary(r.title, keywords) };
  });

  const matched = decided.filter((d) => d.matched).length;
  const storyIds = [
    ...new Set(decided.map((d) => d.storyId).filter((id): id is number => id != null)),
  ];

  console.log(`unevaluated items: ${rows.length}`);
  console.log(`  would record matched:     ${matched}`);
  console.log(`  would record NOT matched: ${rows.length - matched}`);
  console.log(`stories to recompute:       ${storyIds.length}`);

  if (!APPLY) {
    console.log("\nDry run. Nothing written. Re-run with --apply to write.");
    return;
  }

  await db.transaction(async (tx) => {
    for (const d of decided) {
      await tx
        .update(rawItems)
        .set({ matchedAiVocabulary: d.matched })
        .where(eq(rawItems.id, d.id));
    }
    // adjacent_tech is recomputed by refreshStory rather than written here, so
    // the backfill cannot disagree with the pipeline about what makes a story
    // adjacent. Same reason the content-type backfill defers to it.
    for (const storyId of storyIds) await refreshStory(tx, storyId);
  });

  console.log(`\napplied in ${Date.now() - started}ms.`);
}

/** Closed in a finally: an open handle keeps node alive and a failed backfill
 *  would print a stack trace and then hang instead of exiting. */
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
