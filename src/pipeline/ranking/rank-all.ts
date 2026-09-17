import { eq, gte } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { ScoreComponents } from "@/db/schema";
import { rawItems, stories, storyTopics, topics, userPreferences } from "@/db/schema";
import { storySources } from "../run";
import { rankStory } from "./score";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** How far back a story is still worth scoring. */
export const RANKING_WINDOW_HOURS = 7 * 24;

export interface RankAllResult {
  /** Stories inside the window that were scored. */
  ranked: number;
}

/** The strongest community signal on a story, or nothing if none was recorded. */
function bestEngagement(
  rows: { id: number; metadata: Record<string, unknown> }[],
): { points: number; comments: number } | null {
  let best: { points: number; comments: number } | null = null;
  // Ordered before comparing, because a strict > lets the FIRST row win a tie
  // and "first" is otherwise physical row order. Two submissions of one link
  // with equal points would score differently after a dump and restore, a
  // replica, or a VACUUM FULL — identical data, different answer.
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const points = Number(row.metadata?.points ?? NaN);
    if (!Number.isFinite(points)) continue;
    const comments = Number(row.metadata?.comments ?? 0);
    // Points and comments are taken from the SAME item: they describe one
    // conversation, and a maximum of each across different items would
    // describe a story that never happened.
    if (!best || points > best.points) {
      best = { points, comments: Number.isFinite(comments) ? comments : 0 };
    }
  }
  return best;
}

/**
 * Score one story inside a transaction the caller already owns.
 *
 * Exported for the content-type backfill, which must retype, refresh and
 * re-score a story in a single atomic step: committing the new badge and
 * re-scoring afterwards leaves a window where a story wears a type its score
 * was not computed from.
 */
export async function rankOneInTransaction(
  tx: Tx,
  storyId: number,
  userTopicKeys: string[],
  now: Date,
): Promise<boolean> {
  const [story] = await tx
    .select({
      id: stories.id,
      contentType: stories.contentType,
      verification: stories.verification,
      lastActivityAt: stories.lastActivityAt,
    })
    .from(stories)
    .where(eq(stories.id, storyId));
  // Gone between the window query and this transaction: nothing to score, and
  // nothing to count.
  if (!story) return false;

  // The same de-duplicated array deriveVerification takes, handed straight to
  // rankStory. This pass-through is load-bearing, not incidental: building a
  // second list here is exactly how one module came to count items while the
  // other counted outlets, and a story the product calls EMERGING outscored one
  // it calls CORROBORATED.
  const sources = await storySources(tx, storyId);

  const topicRows = await tx
    .select({ key: topics.key })
    .from(storyTopics)
    .innerJoin(topics, eq(storyTopics.topicId, topics.id))
    .where(eq(storyTopics.storyId, storyId));

  const itemRows = await tx
    .select({ id: rawItems.id, metadata: rawItems.metadata })
    .from(rawItems)
    .where(eq(rawItems.storyId, storyId));
  const engagement = bestEngagement(itemRows);

  const { score, components } = rankStory(
    {
      lastActivityAt: story.lastActivityAt,
      contentType: story.contentType,
      verification: story.verification,
      sources,
      topicKeys: topicRows.map((t) => t.key),
      userTopicKeys,
      engagementPoints: engagement?.points,
      engagementComments: engagement?.comments,
    },
    now,
  );

  // updatedAt is deliberately untouched. It records when the story's content
  // last changed, and re-scoring changes no content; bumping it would make
  // every ranking run look like an edit, and would make this run
  // non-deterministic for a fixed `now`.
  await tx
    .update(stories)
    .set({ score, scoreComponents: components })
    .where(eq(stories.id, storyId));
  return true;
}

/**
 * Score every story still inside the window.
 *
 * Deterministic for a fixed `now`: the same database ranked twice produces
 * byte-identical rows. One transaction per story, so a story is scored against
 * a consistent view of its own items rather than a moving one.
 */
export async function rankAllStories(db: Db, now: Date = new Date()): Promise<RankAllResult> {
  const [prefs] = await db
    .select({ topicKeys: userPreferences.topicKeys })
    .from(userPreferences)
    .where(eq(userPreferences.id, 1));
  const userTopicKeys = prefs?.topicKeys ?? [];

  const cutoff = new Date(now.getTime() - RANKING_WINDOW_HOURS * 3_600_000);
  const due = await db
    .select({ id: stories.id })
    .from(stories)
    .where(gte(stories.lastActivityAt, cutoff));

  let ranked = 0;
  for (const { id } of due) {
    // due.length would report a story that vanished before its transaction as
    // scored. This number is a report of work done, and #5 will report it.
    if (await db.transaction((tx) => rankOneInTransaction(tx, id, userTopicKeys, now))) ranked++;
  }
  return { ranked };
}
