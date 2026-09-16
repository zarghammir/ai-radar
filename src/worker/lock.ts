import type postgres from "postgres";

/**
 * The advisory-lock key every AI Radar ingest competes for.
 *
 * 0x41524449 ("ARDI"). It is below 2^31 on purpose: Postgres then reports the
 * lock as classid 0 / objid <key>, which is what src/worker/lock.test.ts reads
 * out of pg_locks to prove the lock is really held and really released.
 */
export const INGEST_LOCK_KEY = 0x41524449;

export interface LockOutcome<T> {
  /** False means another ingest already held the lock; the work did not run. */
  ran: boolean;
  result?: T;
}

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
      await reserved`select pg_advisory_unlock(${INGEST_LOCK_KEY})`;
    }
  } finally {
    reserved.release();
  }
}
