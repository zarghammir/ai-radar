import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { ContentType, SourceTier, VerificationLevel } from "@/db/schema";
import {
  rawItems,
  readState,
  savedItems,
  sources,
  stories,
  storyTopics,
  topics,
} from "@/db/schema";
import { readingMinutes } from "@/pipeline/normalize/text";

export interface SourceRef {
  key: string;
  name: string;
  tier: SourceTier;
  homepage: string | null;
}

export interface TopicRef {
  key: string;
  name: string;
  group: string;
}

export interface StoryCard {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  excerpt: string | null;
  url: string | null;
  contentType: ContentType;
  verification: VerificationLevel;
  verificationNote: string | null;
  sourceCount: number;
  sources: SourceRef[];
  primarySource: SourceRef | null;
  topics: TopicRef[];
  publishedAt: string | null;
  firstSeenAt: string;
  lastActivityAt: string;
  readingMinutes: number;
  score: number;
  saved: boolean;
  read: boolean;
}

export interface StoryItem {
  id: number;
  title: string;
  url: string;
  excerpt: string | null;
  author: string | null;
  publishedAt: string;
  fetchedAt: string;
  role: string | null;
  source: SourceRef & { kind: string };
  engagement: { points: number; comments: number } | null;
}

export interface StoryDetail extends StoryCard {
  whyItMatters: string | null;
  keyPoints: string[];
  items: StoryItem[];
  timeline: {
    at: string;
    sourceKey: string;
    sourceName: string;
    role: string | null;
    title: string;
    url: string;
  }[];
  scoreComponents: { key: string; label: string; value: number }[];
}

type StoryRow = typeof stories.$inferSelect;

const iso = (d: Date) => d.toISOString();

/** Engagement is absent, not zero, when the source never recorded any. */
function engagementOf(
  metadata: Record<string, unknown>,
): { points: number; comments: number } | null {
  const points = Number(metadata?.points ?? NaN);
  if (!Number.isFinite(points)) return null;
  const comments = Number(metadata?.comments ?? 0);
  return { points, comments: Number.isFinite(comments) ? comments : 0 };
}

/**
 * Build cards for a page of stories.
 *
 * Batched deliberately: one query per relation for the whole page rather than
 * a handful per story. A thirty-row page would otherwise be well over a
 * hundred round trips, and the cost would only show up under real data.
 */
export async function buildCards(db: Db, storyRows: StoryRow[]): Promise<StoryCard[]> {
  if (storyRows.length === 0) return [];
  const ids = storyRows.map((s) => s.id);

  const sourceRows = await db
    .select({
      storyId: rawItems.storyId,
      key: sources.key,
      name: sources.name,
      tier: sources.tier,
      homepage: sources.homepage,
    })
    .from(rawItems)
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(inArray(rawItems.storyId, ids));

  const topicRows = await db
    .select({
      storyId: storyTopics.storyId,
      key: topics.key,
      name: topics.name,
      group: topics.group,
    })
    .from(storyTopics)
    .innerJoin(topics, eq(storyTopics.topicId, topics.id))
    .where(inArray(storyTopics.storyId, ids));

  const primaryIds = storyRows.map((s) => s.primaryItemId).filter((v): v is number => v !== null);
  const primaryRows = primaryIds.length
    ? await db
        .select({
          id: rawItems.id,
          storyId: rawItems.storyId,
          url: rawItems.url,
          excerpt: rawItems.excerpt,
          publishedAt: rawItems.publishedAt,
          key: sources.key,
          name: sources.name,
          tier: sources.tier,
          homepage: sources.homepage,
        })
        .from(rawItems)
        .innerJoin(sources, eq(rawItems.sourceId, sources.id))
        .where(inArray(rawItems.id, primaryIds))
    : [];

  const savedIds = new Set(
    (
      await db
        .select({ storyId: savedItems.storyId })
        .from(savedItems)
        .where(inArray(savedItems.storyId, ids))
    ).map((r) => r.storyId),
  );
  const readIds = new Set(
    (
      await db
        .select({ storyId: readState.storyId })
        .from(readState)
        .where(and(inArray(readState.storyId, ids), isNotNull(readState.readAt)))
    ).map((r) => r.storyId),
  );

  // One entry per source however many items it filed: the same de-duplicated
  // list the verification level is derived from, so a card can explain its own
  // badge without a second request.
  const sourcesByStory = new Map<number, Map<string, SourceRef>>();
  for (const r of sourceRows) {
    if (r.storyId === null) continue;
    const bucket = sourcesByStory.get(r.storyId) ?? new Map<string, SourceRef>();
    bucket.set(r.key, { key: r.key, name: r.name, tier: r.tier, homepage: r.homepage });
    sourcesByStory.set(r.storyId, bucket);
  }

  const topicsByStory = new Map<number, TopicRef[]>();
  for (const r of topicRows) {
    const bucket = topicsByStory.get(r.storyId) ?? [];
    bucket.push({ key: r.key, name: r.name, group: r.group });
    topicsByStory.set(r.storyId, bucket);
  }

  const primaryByStory = new Map(primaryRows.map((r) => [r.storyId!, r]));

  return storyRows.map((s) => {
    const primary = primaryByStory.get(s.id);
    const excerpt = primary?.excerpt ?? null;
    return {
      id: s.id,
      slug: s.slug,
      title: s.title,
      summary: s.summary,
      excerpt,
      url: primary?.url ?? null,
      contentType: s.contentType,
      verification: s.verification,
      verificationNote: s.verificationNote,
      sourceCount: s.sourceCount,
      sources: [...(sourcesByStory.get(s.id)?.values() ?? [])],
      primarySource: primary
        ? { key: primary.key, name: primary.name, tier: primary.tier, homepage: primary.homepage }
        : null,
      topics: topicsByStory.get(s.id) ?? [],
      publishedAt: primary ? iso(primary.publishedAt) : null,
      firstSeenAt: iso(s.firstSeenAt),
      lastActivityAt: iso(s.lastActivityAt),
      readingMinutes: readingMinutes([s.summary ?? excerpt ?? ""]),
      score: s.score,
      saved: savedIds.has(s.id),
      read: readIds.has(s.id),
    };
  });
}

/** One story in full, or null when there is no such slug. */
export async function buildDetail(db: Db, slug: string): Promise<StoryDetail | null> {
  const [story] = await db.select().from(stories).where(eq(stories.slug, slug));
  if (!story) return null;

  const [card] = await buildCards(db, [story]);

  const itemRows = await db
    .select({
      id: rawItems.id,
      title: rawItems.title,
      url: rawItems.url,
      excerpt: rawItems.excerpt,
      author: rawItems.author,
      publishedAt: rawItems.publishedAt,
      fetchedAt: rawItems.fetchedAt,
      role: rawItems.role,
      metadata: rawItems.metadata,
      key: sources.key,
      name: sources.name,
      tier: sources.tier,
      homepage: sources.homepage,
      kind: sources.kind,
    })
    .from(rawItems)
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(eq(rawItems.storyId, story.id));

  // Ordered here rather than in SQL so the timeline and the item list cannot
  // disagree about the order they were published in.
  const ordered = [...itemRows].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());

  const items: StoryItem[] = ordered.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    excerpt: r.excerpt,
    author: r.author,
    publishedAt: iso(r.publishedAt),
    fetchedAt: iso(r.fetchedAt),
    role: r.role,
    source: { key: r.key, name: r.name, tier: r.tier, homepage: r.homepage, kind: r.kind },
    engagement: engagementOf(r.metadata),
  }));

  return {
    ...card,
    whyItMatters: story.whyItMatters,
    keyPoints: story.keyPoints,
    items,
    timeline: ordered.map((r) => ({
      at: iso(r.publishedAt),
      sourceKey: r.key,
      sourceName: r.name,
      role: r.role,
      title: r.title,
      url: r.url,
    })),
    // Filled when #36 merges, which is what writes stories.score_components.
    // Empty rather than absent so a client can map over it from day one.
    scoreComponents: [],
  };
}
