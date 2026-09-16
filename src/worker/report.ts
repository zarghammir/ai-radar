import type { IngestResult, SourceRunResult } from "@/pipeline/run";
import type { SecretEnv } from "./secret";

/** Matches INGEST_INTERVAL_MINUTES in .env.example; report.test.ts pins the two together. */
export const DEFAULT_INTERVAL_MINUTES = 30;

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
 * database — and that is worth failing for. No sources at all is a seeding
 * question, not a failed run.
 */
export function exitCodeFor(result: IngestResult): number {
  if (result.bySource.length === 0) return 0;
  return result.bySource.every((r) => r.error) ? 1 : 0;
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
  return minutes;
}
