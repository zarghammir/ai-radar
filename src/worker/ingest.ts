import type postgres from "postgres";
import type { Db } from "@/db/client";
import { runIngest, type IngestResult } from "@/pipeline/run";
import { withIngestLock, type LockOutcome } from "./lock";

/**
 * One ingest, guarded by the single-writer lock.
 *
 * Both callers — the worker loop and the internal HTTP trigger — go through
 * here so there is exactly one ingest path. A second loop next to runIngest is
 * how two writers end up colliding on a story slug.
 */
export async function ingestOnce(db: Db, sql: postgres.Sql): Promise<LockOutcome<IngestResult>> {
  return withIngestLock(sql, () => runIngest(db));
}
