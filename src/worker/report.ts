import type { IngestResult, SourceRunResult } from "@/pipeline/run";
import { describeError } from "@/pipeline/describe-error";
import type { SecretEnv } from "./secret";

/** Matches INGEST_INTERVAL_MINUTES in .env.example; report.test.ts pins the two together. */
export const DEFAULT_INTERVAL_MINUTES = 30;

/**
 * The fastest schedule this worker will accept.
 *
 * Every pass fetches every enabled source, so the interval is a request rate
 * against other people's servers, not just a local loop. A fat-fingered 0.01
 * is a pass every 0.6 seconds across the whole catalogue — the sort of thing
 * that gets a self-hoster blocked rather than rate-limited.
 */
export const MINIMUM_INTERVAL_MINUTES = 1;

/** The first line of a stored error: the rest is the source's log tail. */
function firstLine(error: string): string {
  return error.split("\n")[0].trim();
}

/**
 * One source, one line.
 *
 * Counts are printed for a failing source too: "fetched 40, stored 0" and
 * "fetched 0" are different failures, and the summary is where an operator
 * looks first.
 */
export function formatSourceLine(run: SourceRunResult): string {
  const counts = `${run.fetched} fetched, ${run.inserted} new`;
  if (run.error) {
    return `  ${run.sourceKey}: FAILED — ${firstLine(run.error)} (${counts})`;
  }
  return `  ${run.sourceKey}: ${counts}`;
}

/**
 * The run in one line.
 *
 * The failure count is part of it because runIngest deliberately survives a
 * failing source: without it, a run where every source failed prints the same
 * shape as a run where none did.
 */
export function formatTotalLine(result: IngestResult, elapsedMs: number): string {
  const fetched = result.bySource.reduce((sum, r) => sum + r.fetched, 0);
  const failures = result.bySource.filter((r) => r.error).length;
  const seconds = (elapsedMs / 1000).toFixed(1);
  const parts = [
    `${result.bySource.length} sources`,
    `${fetched} fetched`,
    `${result.itemsInserted} new`,
    `${result.storiesCreated} stories`,
  ];
  if (failures > 0) parts.push(`${failures} failed`);
  return `total: ${parts.join(", ")} in ${seconds}s`;
}

/**
 * What a finished run is worth to a caller that only reads exit codes.
 *
 * A single dead feed is normal and must not turn the scheduled run red, or the
 * notification gets muted and a real outage goes unnoticed with it. Every
 * source failing is not a feed problem — it is the worker, the network or the
 * database — and that is worth failing for.
 *
 * THE SENTENCE THAT USED TO BE HERE said "no sources at all is a seeding
 * question, not a failed run". The rule was right and the CENSUS WAS WRONG
 * (#104): an empty `bySource` has THREE unrelated causes, and naming one of
 * them was what let the other through.
 *
 *   nothing seeded yet ............... green. Nothing is broken
 *   a filter matched no sources ...... green. The caller asked for a subset
 *   EVERY SOURCE SWITCHED OFF ........ RED. Somebody turned the product off
 *
 * The third is why this matters. Until #110 it did not even need an operator —
 * PUT /api/sources/[key] was unauthenticated and the keys are in seed-data.ts,
 * in a public repository. With every source disabled the worker still runs
 * every thirty minutes, still finishes, still exits 0, and the brief quietly
 * stops growing. #86's health reports per-source failures, and a source that
 * is disabled does not FAIL — it is never run at all — so nothing else covers
 * this.
 *
 * WHY THE EMPTY-RESULT GUARD IS STILL HERE AND MUST STAY. `[].every()` is
 * true, so without it an empty result exits 1 — on a fresh database before
 * seeding, and on any filtered run matching nothing. Somebody hit that
 * vacuous-truth trap and fixed it correctly, and that correct fix is what made
 * this silent. The function was MISSING A FACT, not carrying a mistake: it
 * knew how many sources RAN and not how many EXIST. Do not choose between the
 * two wrong defaults; that is what the counts are for.
 */
export function exitCodeFor(result: IngestResult): number {
  if (result.bySource.length === 0) {
    // Configured but none enabled: the catalogue exists and someone has
    // switched all of it off. Distinguished from "nothing seeded" by a count
    // the pass itself cannot infer from its own results.
    if (result.sourcesConfigured > 0 && result.sourcesEnabled === 0) return 1;
    return 0;
  }
  return result.bySource.every((r) => r.error) ? 1 : 0;
}

/**
 * The worker's last line before it exits non-zero.
 *
 * A FUNCTION rather than a template in main.ts, because main.ts calls `main()`
 * at module level and cannot be imported by a test. Inlined there, "does the
 * worker redact its fatal error" would be assertable only by grepping the
 * source for a shape — which is the import-versus-call gap #103 documented,
 * one layer down. Here it is behaviour a test can drive.
 *
 * MEASURED BEFORE THE FIX (#92): this line printed `error.message`, and
 * `npm run worker:once` against an unreachable host put
 * `getaddrinfo ENOTFOUND <host>` in the clear. ingest.yml runs it on a
 * schedule with the real DATABASE_URL, and this repository's Actions logs are
 * public.
 */
export function formatWorkerFailure(error: unknown): string {
  return `[worker] ${describeError(error)}`;
}

/**
 * Why a pass collected nothing, in words, because an exit code cannot carry
 * it. "0 of 17 sources are enabled" and "no sources are seeded" are different
 * operator actions and the scheduled job's log is where somebody looks first.
 */
export function describeEmptyPass(result: IngestResult): string | null {
  if (result.bySource.length > 0) return null;
  if (result.sourcesConfigured === 0) {
    return "no sources are seeded yet, so there was nothing to collect. Run `npm run db:seed`.";
  }
  if (result.sourcesEnabled === 0) {
    return `every source is switched off — 0 of ${result.sourcesConfigured} are enabled, so this pass collected nothing and the brief will stop growing.`;
  }
  return `no source matched this pass, though ${result.sourcesEnabled} of ${result.sourcesConfigured} are enabled.`;
}

/**
 * How long the loop waits between runs.
 *
 * A value that cannot be read is refused rather than replaced by the default:
 * a typo that silently becomes 30 minutes is a worker running on a schedule
 * nobody chose.
 */
export function readIntervalMinutes(env: SecretEnv = process.env): number {
  const raw = (env.INGEST_INTERVAL_MINUTES ?? "").trim();
  if (!raw) return DEFAULT_INTERVAL_MINUTES;

  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`INGEST_INTERVAL_MINUTES must be a positive number of minutes, got "${raw}".`);
  }
  if (minutes < MINIMUM_INTERVAL_MINUTES) {
    throw new Error(
      `INGEST_INTERVAL_MINUTES must be at least ${MINIMUM_INTERVAL_MINUTES} minute(s), got "${raw}". ` +
        `Every pass fetches every source, so a shorter interval is a request rate against other people's servers.`,
    );
  }
  return minutes;
}
