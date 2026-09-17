import type postgres from "postgres";
import type { Db } from "@/db/client";
import { rankAllStories, type RankAllResult } from "@/pipeline/ranking/rank-all";
import { runIngest, type IngestResult, type RunIngestOptions } from "@/pipeline/run";
import { withIngestLock, type LockOutcome } from "./lock";

export interface IngestPassResult {
  ingest: IngestResult;
  /** Scored in the same pass: see the note in ingestOnce. */
  ranked: RankAllResult;
}

/**
 * One pass — fetch, store, cluster, then score — guarded by the single-writer
 * lock.
 *
 * Both callers, the worker loop and the internal HTTP trigger, go through here,
 * so there is exactly one ingest path. A second loop next to runIngest is how
 * two writers end up colliding on a story slug.
 *
 * Ranking belongs in the pass rather than in a job of its own. A story nobody
 * scored cannot appear on Today, so an ingest that stopped after storing would
 * fill the database and leave the screen empty — with both halves passing their
 * own tests while it happened.
 *
 * `options` exists for tests: it carries the injected fetch and the pinned
 * clock that make a pass deterministic and offline. **Production must not pass
 * it** — both real call sites (src/worker/main.ts and the route) call this with
 * two arguments, and a fake reaching production through here would be worse
 * than the vacuous test it exists to prevent.
 */
export async function ingestOnce(
  db: Db,
  sql: postgres.Sql,
  options: RunIngestOptions = {},
): Promise<LockOutcome<IngestPassResult>> {
  return withIngestLock(sql, async () => {
    const ingest = await runIngest(db, undefined, options);
    const ranked = await rankAllStories(db, options.now);
    return { ingest, ranked };
  });
}
