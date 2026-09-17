import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { SourceKind, SourceTier } from "@/db/schema";
import { sources } from "@/db/schema";
import { classifySourceHealth, type SourceHealth } from "./source-health";

/** The window story counts are taken over. A hint for ordering chips, not a
 *  statistic, and fixed so it costs one cheap grouped count. */
export const COUNT_WINDOW_DAYS = 7;

export interface TopicSummary {
  key: string;
  name: string;
  group: string;
  storyCount: number;
}

export interface SourceSummary {
  key: string;
  name: string;
  kind: SourceKind;
  tier: SourceTier;
  homepage: string | null;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
  storyCount: number;
  /**
   * Whether the source is working, which `lastError` alone cannot say: a
   * single stale error is indistinguishable from a feed that has been refused
   * on every run for a week. UNKNOWN is a real state, not a placeholder.
   */
  health: SourceHealth;
  /** Failures since this source last succeeded. Zero when it is working. */
  consecutiveFailures: number;
}

const since = (now: Date) => new Date(now.getTime() - COUNT_WINDOW_DAYS * 24 * 3_600_000);

export async function listTopics(db: Db, now: Date): Promise<TopicSummary[]> {
  const rows = await db.execute(sql`
    select t.key, t.name, t."group",
           count(distinct s.id) filter (where s.last_activity_at >= ${since(now).toISOString()}::timestamptz)::int as story_count
    from topics t
    left join story_topics st on st.topic_id = t.id
    left join stories s on s.id = st.story_id
    group by t.id, t.key, t.name, t."group"
    order by story_count desc, t.name asc
  `);
  return (
    rows as unknown as { key: string; name: string; group: string; story_count: number }[]
  ).map((r) => ({ key: r.key, name: r.name, group: r.group, storyCount: Number(r.story_count) }));
}

/**
 * The catalogue as a reader sees it.
 *
 * `config` and the feed `url` are deliberately absent: they are operational
 * settings, not display data, and a feed URL is the one field here that could
 * carry a credential in a query string.
 */
export async function listSources(db: Db, now: Date): Promise<SourceSummary[]> {
  const rows = await db.execute(
    sql`
    select s.key, s.name, s.kind, s.tier, s.homepage, s.enabled,
           s.last_fetched_at, s.last_error,
           count(distinct st.id) filter (where st.last_activity_at >= ${since(now).toISOString()}::timestamptz)::int as story_count,
           -- Runs that finished either way. An in-flight run (finished_at null,
           -- no error) is neither a success nor a failure, and counting it as
           -- one would make a source look healthy the moment it started.
           (select count(*) from ingest_runs r
              where r.source_id = s.id
                and (r.error is not null or r.finished_at is not null))::int as completed_runs,
           -- Failures recorded since the last success. A negative-infinity
           -- bound rather than a null-guard, so a source that has never once
           -- succeeded counts all of its failures instead of none of them.
           (select count(*) from ingest_runs f
              where f.source_id = s.id
                and f.error is not null
                and f.started_at > coalesce(
                  (select max(ok.started_at) from ingest_runs ok
                     where ok.source_id = s.id and ok.error is null and ok.finished_at is not null),
                  '-infinity'::timestamptz))::int as consecutive_failures
    from sources s
    left join raw_items ri on ri.source_id = s.id
    left join stories st on st.id = ri.story_id
    group by s.id, s.key, s.name, s.kind, s.tier, s.homepage, s.enabled, s.last_fetched_at, s.last_error
    order by s.tier asc, s.name asc
  `,
  );
  return (
    rows as unknown as {
      key: string;
      name: string;
      kind: SourceKind;
      tier: SourceTier;
      homepage: string | null;
      enabled: boolean;
      last_fetched_at: Date | null;
      last_error: string | null;
      story_count: number;
      completed_runs: number;
      consecutive_failures: number;
    }[]
  ).map((r) => ({
    key: r.key,
    name: r.name,
    kind: r.kind,
    tier: r.tier,
    homepage: r.homepage,
    enabled: r.enabled,
    lastFetchedAt: r.last_fetched_at ? new Date(r.last_fetched_at).toISOString() : null,
    lastError: r.last_error,
    storyCount: Number(r.story_count),
    health: classifySourceHealth({
      completedRuns: Number(r.completed_runs),
      consecutiveFailures: Number(r.consecutive_failures),
    }),
    consecutiveFailures: Number(r.consecutive_failures),
  }));
}

/**
 * Switch one source on or off.
 *
 * The only write any route makes to `sources`, and only to this column. It
 * triggers no fetch: a disabled source is simply skipped by the next worker
 * run, which is what keeps every route free of an external call.
 */
export async function setSourceEnabled(
  db: Db,
  key: string,
  enabled: boolean,
  now: Date,
): Promise<SourceSummary | null> {
  const updated = await db
    .update(sources)
    .set({ enabled })
    .where(eq(sources.key, key))
    .returning({ key: sources.key });
  if (updated.length === 0) return null;
  const all = await listSources(db, now);
  return all.find((s) => s.key === key) ?? null;
}
