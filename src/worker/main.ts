import "dotenv/config";
import { getDb, getSql } from "@/db/client";
import { ingestOnce } from "./ingest";
import {
  describeEmptyPass,
  exitCodeFor,
  formatSourceLine,
  formatTotalLine,
  formatWorkerFailure,
  readIntervalMinutes,
} from "./report";
import { readInternalSecret } from "./secret";

/**
 * The ingestion worker: one pass with --once, otherwise a pass every
 * INGEST_INTERVAL_MINUTES.
 *
 * Deliberately thin. Every decision it makes lives in a tested module — the
 * secret guard in secret.ts, the interval and the summary in report.ts, the
 * single-writer lock in lock.ts, the ingest itself in pipeline/run.ts — so
 * this file is wiring and signal handling and nothing else.
 */

const ONCE = process.argv.includes("--once");

let stopping = false;
let wake: (() => void) | null = null;

function stop(signal: string): void {
  console.log(`[worker] ${signal} received; finishing the current pass and stopping.`);
  stopping = true;
  wake?.();
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

/** Sleeps, but wakes early on a signal so a container stop is not a 30-minute wait. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = null;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
  });
}

async function runPass(): Promise<number> {
  const started = Date.now();
  const outcome = await ingestOnce(getDb(), getSql());

  if (!outcome.ran) {
    // Skipped, not failed: another worker or the HTTP trigger holds the lock.
    console.log("[worker] another ingest is already running; skipping this pass.");
    return 0;
  }

  const { ingest, ranked } = outcome.result;
  for (const source of ingest.bySource) console.log(formatSourceLine(source));
  console.log(formatTotalLine(ingest, Date.now() - started));
  // A pass that collected nothing says WHY. The exit code can only carry
  // "wrong" or "fine"; "0 of 17 are enabled" and "nothing is seeded" are
  // different operator actions, and this log is where somebody looks first.
  const why = describeEmptyPass(ingest);
  if (why) console.log(`[worker] ${why}`);
  // Said out loud because ingesting without scoring fills the database and
  // leaves the screen empty, and the two are indistinguishable from the counts
  // above.
  console.log(`[worker] scored ${ranked.ranked} stor${ranked.ranked === 1 ? "y" : "ies"}.`);
  return exitCodeFor(ingest);
}

async function main(): Promise<void> {
  // Refuses to start on a placeholder or missing secret. The worker does not
  // serve HTTP itself, but it shares .env with the web service, so a
  // placeholder here means the internal trigger over there is wide open — and
  // this is the process where saying so is impossible to miss.
  readInternalSecret();
  const minutes = readIntervalMinutes();

  if (ONCE) {
    process.exitCode = await runPass();
    return;
  }

  console.log(`[worker] started: one pass now, then every ${minutes} minute(s).`);
  while (!stopping) {
    // Passes are sequential by construction, so a pass that overruns the
    // interval delays the next one instead of overlapping it. Between
    // processes the advisory lock in ingestOnce enforces the same rule.
    await runPass();
    if (stopping) break;
    await sleep(minutes * 60_000);
  }
}

main()
  .catch((error: unknown) => {
    // Redacted, and via a named function so a test can assert it (#92). This
    // line printed `.message` until then, publishing the database's hostname
    // on every failed pass of a schedule that runs against the real
    // DATABASE_URL in a public repository.
    console.error(formatWorkerFailure(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await getSql()
      .end({ timeout: 5 })
      .catch(() => {});
  });
