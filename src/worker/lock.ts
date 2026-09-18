import type postgres from "postgres";
import { describeError } from "@/pipeline/describe-error";

/**
 * The advisory-lock key every AI Radar ingest competes for.
 *
 * 0x41524449 ("ARDI"). It is below 2^31 on purpose: Postgres then reports the
 * lock as classid 0 / objid <key>, which is what src/worker/lock.test.ts reads
 * out of pg_locks to prove the lock is really held and really released.
 */
export const INGEST_LOCK_KEY = 0x41524449;

/**
 * A discriminated union rather than an optional result, so "declined" and
 * "ran but produced nothing" cannot be confused by a caller. Narrowing on
 * `ran` is enough; there is no second condition to get wrong, and no way to
 * report "another ingest is already running" for any other reason.
 */
export type LockOutcome<T> = { ran: true; result: T } | { ran: false };

/**
 * Runs `work` only if no other ingest is running, anywhere.
 *
 * Story slugs are made unique by a single writer: two concurrent ingests can
 * pick the same slug and collide on the unique index (carried over from the
 * PR #30 review). The lock is tried, never waited on — a tick that arrives
 * while the previous one is still going should be skipped, not queued behind
 * it, or a slow run leaves a pile of ticks to stampede afterwards.
 *
 * The connection is reserved for the whole run because an advisory lock
 * belongs to the session that took it: taken on one pooled connection and
 * released on another, it is never released at all and every later tick is
 * declined until the process restarts.
 */
export async function withIngestLock<T>(
  sql: postgres.Sql,
  work: () => Promise<T>,
): Promise<LockOutcome<T>> {
  const reserved = await sql.reserve();
  try {
    const [{ locked }] = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${INGEST_LOCK_KEY}) as locked
    `;
    if (!locked) return { ran: false };

    try {
      return { ran: true, result: await work() };
    } finally {
      // finally, not after the return: a run that throws must not leave the
      // lock held, or the failure wedges every tick that follows it.
      await releaseLock(reserved);
    }
  } finally {
    reserved.release();
  }
}

/**
 * Releases the lock, and never throws.
 *
 * This runs in a `finally`. A throw here would replace whatever brought us out
 * of the run — including the failure an operator is reading the log to find —
 * so the unlock's own failure is reported and the original is left to
 * propagate. The lock is released regardless once the session ends, so a
 * completed run is still a completed run.
 */
async function releaseLock(reserved: postgres.ReservedSql): Promise<void> {
  try {
    await reserved`select pg_advisory_unlock(${INGEST_LOCK_KEY})`;
  } catch (error) {
    console.error(`[lock] releasing the ingest lock failed: ${describeError(error)}`);
  }
}
