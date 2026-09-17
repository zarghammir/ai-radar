import { and, desc, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { redactConnectionParts } from "@/db/redact";
import type { ContentType, ItemRole, Source, SourceTier } from "@/db/schema";
import { ingestRuns, rawItems, sources, stories, storyTopics, topics } from "@/db/schema";
import { getAdapter } from "@/sources/registry";
import { createFetchContext, type FetchContextOptions } from "./context";
import { isSameStory, titleSimilarity } from "./clustering/similarity";
import { deriveVerification } from "./clustering/verification";
import { normalizeItem } from "./normalize";
import { contentFamily } from "./normalize/content-type";
import { matchesAnyKeyword } from "./normalize/keywords";
import { slugify } from "./normalize/text";

/** A transaction handle, taken from the db type so it cannot drift from it. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** How long a story stays open to absorb later reports of the same thing. */
export const STORY_WINDOW_HOURS = 72;
/** Most recently active stories considered as cluster candidates for one item. */
export const CANDIDATE_LIMIT = 300;

/**
 * One source, de-duplicated, in the single shape both consumers accept.
 *
 * deriveVerification and rankStory must never be handed two separately built
 * lists: that is exactly where the corroboration defect lived, one module
 * counting items where the other counted outlets. Everything downstream takes
 * this array, unchanged.
 */
export interface StorySource {
  sourceKey: string;
  sourceName: string;
  tier: SourceTier;
}

export interface SourceRunResult {
  sourceKey: string;
  fetched: number;
  inserted: number;
  error: string | null;
}

export interface IngestResult {
  bySource: SourceRunResult[];
  itemsInserted: number;
  storiesCreated: number;
}

export interface RunIngestOptions extends FetchContextOptions {
  /** Injected so tests can pin the clustering window and story timestamps. */
  now?: Date;
}

/**
 * The stored reason for a failure, cause chain included, with every fragment
 * of the database credential removed.
 *
 * A driver wraps a database error in one whose message is the SQL it was
 * running, and puts the database's own words on `cause`. Reading `.message`
 * alone leaves an operator with the statement that failed and no idea why:
 * a constraint, a bad cast and a full disk all look identical.
 *
 * WHY THE REDACTION IS HERE AND NOT AT THE THREE PLACES THIS GETS PRINTED
 * (#99). What this returns is not only logged — it is WRITTEN to
 * `sources.lastError` and `ingestRuns.error` a few lines below, and
 * `GET /api/sources` serves `lastError` to anyone, with no authentication. So
 * a database failure mid-pass put the database's hostname on the public web
 * and left it there until that source next succeeded. Hardening the log sites
 * would have left the API serving the same fragment: this is the one point
 * both the log and the stored value pass through.
 *
 * THE DIAGNOSTIC COST IS ZERO, which is why this is not a trade. The host,
 * the user and the password are not information to the person who owns the
 * database — they already know where their database is. They are information
 * only to a stranger. What an operator actually needs is the failing
 * statement, the error code and the source key, and all three survive; the
 * tests assert that positively, so a function that returned "" could not pass.
 */
export function describeError(error: unknown): string {
  const seen: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    const text = current instanceof Error ? current.message : String(current);
    if (text && !seen.includes(text)) seen.push(text);
    if (!(current instanceof Error)) break;
    current = current.cause;
  }
  return redactConnectionParts(seen.join("\n") || String(error));
}

/** Primary for a first-party source, discussion for a forum, report otherwise. */
export function roleFor(source: Pick<Source, "kind" | "tier">): ItemRole {
  if (source.tier === "PRIMARY") return "primary";
  if (source.kind === "hackernews") return "discussion";
  return "report";
}

async function uniqueSlug(tx: Tx, title: string): Promise<string> {
  const base = slugify(title);
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const [clash] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.slug, candidate))
      .limit(1);
    if (!clash) return candidate;
  }
  // Fifty identical titles is not a case worth a nicer answer, but a collision
  // here would abort the item's transaction, so it still needs one.
  return `${base}-${Date.now()}`;
}

/** Every distinct source behind a story, in the one shape both consumers take. */
export async function storySources(tx: Tx, storyId: number): Promise<StorySource[]> {
  const rows = await tx
    .select({ sourceKey: sources.key, sourceName: sources.name, tier: sources.tier })
    .from(rawItems)
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(eq(rawItems.storyId, storyId));
  const byKey = new Map<string, StorySource>();
  for (const r of rows) byKey.set(r.sourceKey, r);
  return [...byKey.values()];
}

/**
 * Decide which story an item belongs to.
 *
 *  1. Another source already filed the same canonical URL: same thing, join it.
 *     This is what makes a blog post and its forum thread one story.
 *  2. Otherwise the best title match among stories still open, within the same
 *     content family, so a paper never absorbs a news report.
 *  3. Otherwise a new story.
 */
export async function assignStory(
  tx: Tx,
  item: {
    id: number;
    title: string;
    canonicalUrl: string;
    contentType: ContentType;
    publishedAt: Date;
  },
  now: Date,
): Promise<{ storyId: number; created: boolean }> {
  const [urlMatch] = await tx
    .select({ storyId: rawItems.storyId })
    .from(rawItems)
    .where(
      and(
        eq(rawItems.canonicalUrl, item.canonicalUrl),
        isNotNull(rawItems.storyId),
        ne(rawItems.id, item.id),
      ),
    )
    .limit(1);
  if (urlMatch?.storyId != null) return { storyId: urlMatch.storyId, created: false };

  const cutoff = new Date(now.getTime() - STORY_WINDOW_HOURS * 3_600_000);
  const candidates = await tx
    .select({ id: stories.id, title: stories.title, contentType: stories.contentType })
    .from(stories)
    .where(gte(stories.lastActivityAt, cutoff))
    // Without this the cap takes an arbitrary rows-as-found slice, and a story
    // that is open, in the window and a perfect match is simply missed once the
    // open-story count passes the cap.
    .orderBy(desc(stories.lastActivityAt))
    .limit(CANDIDATE_LIMIT);

  let best: { id: number; score: number } | null = null;
  for (const c of candidates) {
    if (contentFamily(c.contentType) !== contentFamily(item.contentType)) continue;
    if (!isSameStory(item.title, c.title)) continue;
    const score = titleSimilarity(item.title, c.title).score;
    if (!best || score > best.score) best = { id: c.id, score };
  }
  if (best) return { storyId: best.id, created: false };

  const [row] = await tx
    .insert(stories)
    .values({
      slug: await uniqueSlug(tx, item.title),
      title: item.title,
      contentType: item.contentType,
      firstSeenAt: item.publishedAt,
      lastActivityAt: item.publishedAt,
      sourceCount: 1,
    })
    .returning({ id: stories.id });
  return { storyId: row.id, created: true };
}

/** Recompute everything about a story that depends on the items attached to it. */
export async function refreshStory(tx: Tx, storyId: number): Promise<void> {
  const items = await tx
    .select({
      id: rawItems.id,
      title: rawItems.title,
      excerpt: rawItems.excerpt,
      publishedAt: rawItems.publishedAt,
      contentType: rawItems.contentType,
      tier: sources.tier,
      sourceConfig: sources.config,
    })
    .from(rawItems)
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(eq(rawItems.storyId, storyId));
  if (items.length === 0) return;

  // Primary item: a first-party source if there is one, earliest otherwise.
  const byAge = [...items].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
  const primaryItem = byAge.find((i) => i.tier === "PRIMARY") ?? byAge[0];

  const attached = await storySources(tx, storyId);
  const verification = deriveVerification(attached);
  const lastActivityAt = byAge[byAge.length - 1].publishedAt;

  await tx
    .update(stories)
    .set({
      primaryItemId: primaryItem.id,
      // Everything that describes the story is derived from its primary item,
      // so all of it has to move when the primary item does. A thread that
      // beat the announcement to the feed must not leave the story wearing a
      // forum headline, carrying the forum item's content type — which the
      // family check then reads — or dated from when the forum saw it.
      title: primaryItem.title,
      contentType: primaryItem.contentType,
      firstSeenAt: byAge[0].publishedAt,
      sourceCount: attached.length,
      lastActivityAt,
      verification: verification.level,
      verificationNote: verification.note,
      updatedAt: new Date(),
    })
    // The slug is the permalink and deliberately does not move with the title.
    .where(eq(stories.id, storyId));

  // Topics every story from this source belongs to whatever its headline says.
  // Taken from the primary item's source, so a forum thread joining the story
  // cannot bring its own.
  const configured = primaryItem.sourceConfig?.topicKeys;
  const defaultTopicKeys = Array.isArray(configured) ? (configured as string[]) : [];
  await tagTopics(
    tx,
    storyId,
    `${primaryItem.title} ${primaryItem.excerpt ?? ""}`,
    defaultTopicKeys,
  );
}

/**
 * Tag a story from the text of its primary item, unioned with that source's
 * default topics. Recomputed rather than only added to, so a tag cannot
 * survive the text that justified it.
 *
 * The union is what covers a first-party post whose headline names nothing —
 * "Introducing our new model" matches no keyword, and the source is the only
 * thing that knows whose model it is.
 */
export async function tagTopics(
  tx: Tx,
  storyId: number,
  text: string,
  defaultTopicKeys: string[] = [],
): Promise<number[]> {
  const all = await tx
    .select({ id: topics.id, key: topics.key, keywords: topics.keywords })
    .from(topics);
  const byDefault = new Set(defaultTopicKeys);
  const wanted = all
    .filter((t) => byDefault.has(t.key) || matchesAnyKeyword(text, t.keywords))
    .map((t) => t.id);

  const current = (
    await tx
      .select({ topicId: storyTopics.topicId })
      .from(storyTopics)
      .where(eq(storyTopics.storyId, storyId))
  ).map((r) => r.topicId);

  const stale = current.filter((id) => !wanted.includes(id));
  if (stale.length) {
    await tx
      .delete(storyTopics)
      .where(and(eq(storyTopics.storyId, storyId), inArray(storyTopics.topicId, stale)));
  }
  const missing = wanted.filter((id) => !current.includes(id));
  if (missing.length) {
    await tx
      .insert(storyTopics)
      .values(missing.map((topicId) => ({ storyId, topicId })))
      .onConflictDoNothing();
  }
  return wanted;
}

/**
 * Fetch every enabled source, store what is new, and fold it into stories.
 *
 * One transaction per item: an item and the story it belongs to are written
 * together or not at all, so a failure halfway cannot leave an item stored
 * with no story or a story whose counts do not match its items.
 */
export async function runIngest(
  db: Db,
  sourceIds?: number[],
  options: RunIngestOptions = {},
): Promise<IngestResult> {
  const now = options.now ?? new Date();
  const enabled = await db
    .select()
    .from(sources)
    .where(
      sourceIds?.length
        ? and(eq(sources.enabled, true), inArray(sources.id, sourceIds))
        : eq(sources.enabled, true),
    );

  const result: IngestResult = { bySource: [], itemsInserted: 0, storiesCreated: 0 };

  for (const source of enabled) {
    const [run] = await db
      .insert(ingestRuns)
      .values({ sourceId: source.id, startedAt: now })
      .returning({ id: ingestRuns.id });

    const { ctx, lines } = createFetchContext(source, { ...options, now });
    let fetched = 0;
    let inserted = 0;
    let error: string | null = null;

    try {
      const adapter = getAdapter(source.kind);
      if (!adapter) throw new Error(`no adapter registered for kind "${source.kind}"`);
      const items = await adapter.fetch(source, ctx);
      fetched = items.length;

      for (const fetchedItem of items) {
        const row = normalizeItem(fetchedItem, source, now);
        if (!row) continue;
        const created = await db.transaction(async (tx) => {
          const [stored] = await tx.insert(rawItems).values(row).onConflictDoNothing().returning();
          // No row back means we already had this item; nothing to cluster.
          if (!stored) return false;
          const assigned = await assignStory(tx, stored, now);
          await tx
            .update(rawItems)
            .set({ storyId: assigned.storyId, role: roleFor(source) })
            .where(eq(rawItems.id, stored.id));
          await refreshStory(tx, assigned.storyId);
          inserted++;
          return assigned.created;
        });
        if (created) result.storiesCreated++;
      }
    } catch (e) {
      error = describeError(e);
    }

    // Lines are diagnostic context for a failure, so they are stored with it.
    // On a healthy run they have already gone to the sink.
    //
    // Redacted again here, deliberately, even though `error` already is. This
    // is the point at which a string becomes a stored, served value, and
    // `lines` arrives from createFetchContext rather than from describeError —
    // so asserting the property at the WRITE rather than at its likeliest
    // source is what makes it hold for a contributor who later logs something
    // new into the context. Redaction is idempotent: the labels it leaves
    // behind contain no fragment for a second pass to match.
    const storedError = error ? redactConnectionParts([error, ...lines].join("\n")) : null;
    await db
      .update(ingestRuns)
      .set({
        finishedAt: new Date(),
        itemsFetched: fetched,
        itemsNew: inserted,
        error: storedError,
      })
      .where(eq(ingestRuns.id, run.id));
    await db
      .update(sources)
      .set({ lastFetchedAt: new Date(), lastError: error })
      .where(eq(sources.id, source.id));

    result.itemsInserted += inserted;
    result.bySource.push({ sourceKey: source.key, fetched, inserted, error });
  }

  return result;
}
