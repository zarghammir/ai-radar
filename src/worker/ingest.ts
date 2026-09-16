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
  // CONTROL, THROWAWAY BRANCH, NEVER MERGE. Returns "declined" without doing
  // anything, so the worker starts cleanly, prints the skip line and exits 0
  // without ever printing a total. That is precisely the state the compose
  // smoke's assertion must reject. The voids keep every import used so lint
  // and tsc still pass and the red can only come from the assertion.
  void db;
  void sql;
  void withIngestLock;
  void runIngest;
  return { ran: false };
}
