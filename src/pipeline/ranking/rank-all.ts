import { eq, gte } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { ScoreComponents } from "@/db/schema";
import { rawItems, stories, storyTopics, topics } from "@/db/schema";
import { storySources } from "../run";
import { rankStory } from "./score";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** How far back a story is still worth scoring. */
export { RANKING_WINDOW_HOURS } from "../story-window";
import { RANKING_WINDOW_HOURS } from "../story-window";

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
      // Age is scored from the story's EARLIEST PUBLICATION since the decay
      // change — the column is called firstSeenAt and does not measure sighting;
      // see the note on RankInput.firstSeenAt for the proxy and where it breaks.
      // lastActivityAt is still selected because the window query below bounds on
      // it: what the pipeline keeps up to date and what the reader experiences as
      // newness are different clocks, which src/api/brief.ts calls the trap.
      firstSeenAt: stories.firstSeenAt,
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
      firstSeenAt: story.firstSeenAt,
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
  /**
   * NO TOPICS ARE READ HERE ANY MORE — #203.
   *
   * This used to select `user_preferences.topic_keys` and hand it to every
   * story's score, so the ONE stored score carried ONE person's taste and
   * every reader of the public copy was ranked by it. On 2026-10-05 the owner
   * watched visitor A pick a topic on the welcome screen and visitor B's
   * Settings show it chosen. The row was never personal; it was a thermostat
   * for the building.
   *
   * The stored score is now topic-free, and a reader's topics are applied
   * when the brief is read, by `readerTopicBonus` in src/api/brief.ts, with
   * the reader's own keys from their own device. The column still exists; it
   * is written by nothing the app offers and read by nothing — dropping it is
   * a destructive migration and waits with #190.
   */
  const userTopicKeys: string[] = [];

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
