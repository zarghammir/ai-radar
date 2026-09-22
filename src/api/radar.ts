import { and, desc, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sources, stories, topics } from "@/db/schema";
import { buildCards, type StoryCard } from "./stories";
import { encodeCursor, type Cursor, type RadarFilters, type Sort } from "./params";

/** How far back "trending" counts a source as newly attached. */
export const TRENDING_WINDOW_HOURS = 24;

export interface RadarPage {
  stories: StoryCard[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * How many distinct sources attached to a story inside the trending window.
 *
 * Counted from each item's fetched_at, because nothing stores a rate of
 * change. Declared once and used in both ORDER BY and the cursor comparison:
 * an alias cannot be referenced from WHERE, and two copies of this expression
 * would be two definitions of trending waiting to disagree.
 */
function trendExpr(windowStart: Date): SQL<number> {
  return sql<number>`(
    select count(distinct ri.source_id)::int
    from raw_items ri
    where ri.story_id = ${stories.id} and ri.fetched_at >= ${windowStart.toISOString()}::timestamptz
  )`;
}

/**
 * Hidden stories leave every list. Hiding is not deleting: the story stays
 * reachable by direct link, which is what the contract promises.
 */
export function notHidden(): SQL {
  return sql`not exists (
    select 1 from read_state rs where rs.story_id = ${stories.id} and rs.hidden = true
  )`;
}

/**
 * Adjacent tech is kept and not shown by default (#71). Expressed once, beside
 * notHidden(), because the brief and Radar must not drift about what the front
 * door contains.
 *
 * This is a FILTER and never a ranking input. Inside the default view every
 * story is AI, so a score boost would be constant across the whole set — a
 * no-op with maintenance cost. In the widened view it would systematically
 * bury the adjacent tech the widening exists to surface.
 */
export function notAdjacentTech(): SQL {
  return sql`${stories.adjacentTech} = false`;
}

function filterConditions(filters: RadarFilters): SQL[] {
  const conditions: SQL[] = [gte(stories.lastActivityAt, filters.since)];

  if (filters.type.length) conditions.push(inArray(stories.contentType, filters.type));
  if (filters.verification.length)
    conditions.push(inArray(stories.verification, filters.verification));

  // A story matches if it carries ANY of the topics asked for.
  if (filters.topic.length) {
    conditions.push(sql`exists (
      select 1 from story_topics st join topics t on t.id = st.topic_id
      where st.story_id = ${stories.id} and t.key in ${filters.topic}
    )`);
  }
  if (filters.source.length) {
    conditions.push(sql`exists (
      select 1 from raw_items ri join sources s on s.id = ri.source_id
      where ri.story_id = ${stories.id} and s.key in ${filters.source}
    )`);
  }

  conditions.push(notHidden());
  if (!filters.includeAdjacent) conditions.push(notAdjacentTech());

  return conditions;
}

/** Keyset pagination: an offset would skip or repeat rows when the worker
 *  inserts between two page loads. */
function cursorCondition(sort: Sort, cursor: Cursor, windowStart: Date): SQL {
  if (sort === "newest") {
    return sql`(${stories.lastActivityAt}, ${stories.id}) < (${String(cursor.k)}::timestamptz, ${cursor.i})`;
  }
  if (sort === "importance") {
    return sql`(${stories.score}, ${stories.id}) < (${Number(cursor.k)}, ${cursor.i})`;
  }
  return sql`(${trendExpr(windowStart)}, ${stories.id}) < (${Number(cursor.k)}, ${cursor.i})`;
}

export async function radarPage(
  db: Db,
  filters: RadarFilters,
  sort: Sort,
  limit: number,
  cursor: Cursor | null,
  now: Date,
): Promise<RadarPage> {
  const windowStart = new Date(now.getTime() - TRENDING_WINDOW_HOURS * 3_600_000);
  const trend = trendExpr(windowStart);

  const conditions = filterConditions(filters);
  if (cursor) conditions.push(cursorCondition(sort, cursor, windowStart));

  const order =
    sort === "newest"
      ? [desc(stories.lastActivityAt), desc(stories.id)]
      : sort === "importance"
        ? [desc(stories.score), desc(stories.id)]
        : [desc(trend), desc(stories.id)];

  // One more than asked for, so "is there another page" is answered by the
  // rows themselves rather than by a second count query.
  const rows = await db
    .select({ story: stories, trend })
    .from(stories)
    .where(and(...conditions))
    .orderBy(...order)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const cards = await buildCards(
    db,
    page.map((r) => r.story),
  );

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          k:
            sort === "newest"
              ? last.story.lastActivityAt.toISOString()
              : sort === "importance"
                ? last.story.score
                : Number(last.trend),
          i: last.story.id,
        })
      : null;

  return { stories: cards, nextCursor, hasMore };
}

export interface HistogramBucket {
  hour: string;
  count: number;
}

/** Longest histogram the API will draw, in hourly buckets. */
export const MAX_BUCKETS = 168;

/**
 * Arrivals by hour over the same filters as the list.
 *
 * Every hour in the window is present, including empty ones. Omitting them
 * would leave the chart with silent gaps exactly where it should show a quiet
 * period, which reads as missing data rather than as nothing happening.
 */
export async function radarHistogram(
  db: Db,
  filters: RadarFilters,
  now: Date,
): Promise<{ from: string; to: string; buckets: HistogramBucket[] }> {
  const conditions = filterConditions(filters);
  const bucket = sql<Date>`date_trunc('hour', ${stories.lastActivityAt})`;

  const rows = await db
    .select({ hour: bucket, count: sql<number>`count(*)::int` })
    .from(stories)
    .where(and(...conditions))
    .groupBy(bucket);

  const counts = new Map(rows.map((r) => [new Date(r.hour).toISOString(), Number(r.count)]));

  const from = new Date(filters.since);
  from.setUTCMinutes(0, 0, 0);
  const to = new Date(now);
  to.setUTCMinutes(0, 0, 0);

  const buckets: HistogramBucket[] = [];
  for (
    let at = new Date(from);
    at <= to && buckets.length < MAX_BUCKETS;
    at = new Date(at.getTime() + 3_600_000)
  ) {
    const key = at.toISOString();
    buckets.push({ hour: key, count: counts.get(key) ?? 0 });
  }

  return { from: from.toISOString(), to: to.toISOString(), buckets };
}

/**
 * Filter keys that name nothing.
 *
 * A filter naming a topic or source that does not exist must be rejected, not
 * quietly applied: an empty page is indistinguishable from "no news today",
 * and the reader would believe it.
 */
export async function unknownKeys(
  db: Db,
  kind: "topic" | "source",
  keys: string[],
): Promise<string[]> {
  if (keys.length === 0) return [];

  // THROUGH THE QUERY BUILDER, NOT A RAW TEMPLATE. This was
  // sql`select key from topics where key in ${keys}` — a JS ARRAY
  // interpolated into a raw template, which is the same shape as the Date that
  // would have made every brief request a 500 (#148). A raw `sql` fragment
  // hands its values straight to the driver; only a column reference is safe
  // there without thinking about it.
  //
  // `inArray` builds the placeholder list and the binding, so the expansion is
  // the library's problem rather than a string's. It is also typed against the
  // column, so a rename cannot leave this reading a field that no longer
  // exists.
  const rows =
    kind === "topic"
      ? await db.select({ key: topics.key }).from(topics).where(inArray(topics.key, keys))
      : await db.select({ key: sources.key }).from(sources).where(inArray(sources.key, keys));
  const found = new Set(rows.map((r) => r.key));
  return keys.filter((k) => !found.has(k));
}
