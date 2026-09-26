/**
 * Can the worker actually SEE the variables it reads? (#138, #146)
 *
 * THE DEFECT THIS EXISTS FOR. The summariser and push delivery are both
 * optional by design: no key, feature off, app keeps running. Three secrets
 * were added to this repository to switch summaries on and NOTHING HAPPENED,
 * because `ingest.yml` never forwarded them to the process that reads them.
 * Ten of the fourteen variables the worker reads were unreachable in
 * production, and had been since each feature merged.
 *
 * AN OPTIONAL VARIABLE THE WORKFLOW NEVER PASSES IS NOT OPTIONAL. It is absent
 * always, and the feature behind it is unreachable rather than unconfigured.
 * Every test of it passes, because every test exercises the off state — which
 * is the only state that was ever reachable.
 *
 * So this is not a check that the secrets are SET. Whether the owner has put a
 * key in is their business and an empty value is a legitimate answer. It is a
 * check that the WIRING EXISTS: that a variable the code reads is one the
 * workflow hands over, so the operator's decision reaches the code at all.
 *
 * Derived from a walk of the import graph rather than from a list, for the same
 * reason check-route-cost.ts is: a list is a thing someone must remember to
 * update, and this defect IS a list nobody updated.
 *
 *   npx tsx scripts/check-worker-env.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const WORKER_ENTRY = "src/worker/main.ts";
const WORKFLOW = ".github/workflows/ingest.yml";

/**
 * Variables the worker reads that the hosted workflow deliberately does NOT
 * pass, each with the reason.
 *
 * THIS IS A DECLARATION OF INTENT, NOT AN EXCEPTIONS LIST. Every entry has to
 * say why absence is correct, and an entry that turns out to be provided after
 * all is also a failure below — a stale declaration is how a real gap hides
 * behind a comment that used to be true.
 */
const DELIBERATELY_ABSENT: Record<string, string> = {
  NODE_ENV: "set by the Node runtime and by next build; never ours to pass",
  INGEST_INTERVAL_MINUTES:
    "the hosted schedule IS the cron in this workflow. `worker:once` runs a single pass and never sleeps, so an interval here would be a second, contradictory statement of the same thing",
};

/** A walk that reaches almost nothing reports almost no problems. */
const MINIMUM_MODULES = 20;
const MINIMUM_READS = 8;

/**
 * Value imports only. `import type` is erased by the compiler, so such an edge
 * cannot read an environment variable at runtime.
 */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8").replace(/^import type .*$/gm, "");
  const specs = [
    ...[...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]),
    ...[...source.matchAll(/^\s*import\s+"([^"]+)"/gm)].map((m) => m[1]),
  ];
  const out: string[] = [];
  for (const spec of specs) {
    const base = spec.startsWith("@/")
      ? join("src", spec.slice(2))
      : spec.startsWith(".")
        ? normalize(join(dirname(file), spec))
        : null;
    if (base === null) continue;
    for (const suffix of [".ts", ".tsx", "/index.ts"]) {
      if (existsSync(base + suffix)) {
        out.push(base + suffix);
        break;
      }
    }
  }
  return out;
}

/** Every environment variable read anywhere the worker can reach. */
function readsReachableFrom(entry: string): { reads: Map<string, string>; modules: number } {
  const seen = new Set<string>();
  const reads = new Map<string, string>();
  const stack = [entry];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current) || !existsSync(current)) continue;
    seen.add(current);
    const source = readFileSync(current, "utf8");
    // Both forms this codebase uses: `process.env.X` and a narrowed `env.X`
    // parameter, which is how every optional feature reads its own settings.
    for (const match of source.matchAll(/(?:process\.)?env\.([A-Z][A-Z0-9_]*)/g)) {
      if (!reads.has(match[1])) reads.set(match[1], current);
    }
    for (const next of importsOf(current)) stack.push(next);
  }
  return { reads, modules: seen.size };
}

/**
 * The keys the workflow hands to the job that runs the worker.
 *
 * Only the JOB-level block, at four spaces of indent. The step-level `env:`
 * further down belongs to the alarm step and is not in scope for the worker —
 * reading both would let a variable passed only to the alarm look as though the
 * worker could see it, which is this defect with extra steps.
 */
function providedByWorkflow(path: string): Set<string> {
  const provided = new Set<string>();
  let inside = false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (/^ {4}env:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (inside) {
      const entry = /^ {6}([A-Z][A-Z0-9_]*):/.exec(line);
      if (entry) {
        provided.add(entry[1]);
        continue;
      }
      // A comment or a blank line inside the block is still the block.
      if (/^\s*(#.*)?$/.test(line)) continue;
      inside = false;
    }
  }
  return provided;
}

function main(): void {
  const { reads, modules } = readsReachableFrom(WORKER_ENTRY);
  const provided = providedByWorkflow(WORKFLOW);
  const problems: string[] = [];

  // Floors first. A parser that matched nothing, or a graph walk that resolved
  // nothing, would otherwise print a clean bill of health — which is the exact
  // shape of instrument this repository keeps deleting.
  if (modules < MINIMUM_MODULES) {
    problems.push(
      `the import walk reached only ${modules} modules from ${WORKER_ENTRY} (expected at least ${MINIMUM_MODULES}). The graph is broken, so no absence below can be trusted.`,
    );
  }
  if (reads.size < MINIMUM_READS) {
    problems.push(
      `found only ${reads.size} environment reads (expected at least ${MINIMUM_READS}). The matcher is broken, not the wiring.`,
    );
  }
  if (!provided.has("DATABASE_URL")) {
    problems.push(
      `parsed ${provided.size} keys from ${WORKFLOW} and DATABASE_URL was not among them. The worker cannot run without it, so this is the parser failing, not the workflow.`,
    );
  }

  for (const [name, file] of [...reads].sort()) {
    const absentOnPurpose = name in DELIBERATELY_ABSENT;
    if (provided.has(name)) {
      if (absentOnPurpose) {
        problems.push(
          `${name} is declared deliberately absent ("${DELIBERATELY_ABSENT[name]}") but ${WORKFLOW} passes it. One of the two is wrong and a stale declaration is how a real gap hides.`,
        );
      }
      continue;
    }
    if (absentOnPurpose) continue;
    problems.push(
      `${name} is read by ${file} and ${WORKFLOW} does not pass it, so the worker can never see it. Either forward it in the job's env block, or declare it in DELIBERATELY_ABSENT with the reason. An optional variable the workflow never passes is not optional — it is absent always.`,
    );
  }

  if (problems.length > 0) {
    console.error(`FAIL: ${problems.length} problem(s).\n`);
    for (const problem of problems) console.error(`  - ${problem}\n`);
    process.exit(1);
  }

  const declared = Object.keys(DELIBERATELY_ABSENT).length;
  console.log(
    `OK ${reads.size} environment reads across ${modules} modules reachable from ${WORKER_ENTRY}; ` +
      `${reads.size - declared} forwarded by ${WORKFLOW}, ${declared} declared deliberately absent.`,
  );
}

main();
