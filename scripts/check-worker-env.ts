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
/** The step that identifies the job whose env block is in scope. See scopedEnv. */
const WORKER_COMMAND = "worker:once";

/**
 * Ways of reading the environment this checker CANNOT follow, and therefore
 * refuses outright.
 *
 * `process.env["LLM_PROVIDER"]` and `const { LLM_PROVIDER } = process.env` are
 * both legitimate TypeScript and both invisible to the matcher below, so either
 * would be a variable the worker reads and this check reports as absent —
 * FAILING OPEN, which is the one direction a guard must never fail.
 *
 * Refused rather than matched because the count is currently ZERO: banning a
 * form nobody uses costs nothing today and is impossible once somebody writes
 * one and the ban starts breaking their build. If you need one of these, the
 * honest move is to teach the matcher, not to add an exception.
 */
const FORBIDDEN_ENV_ACCESS: { pattern: RegExp; what: string }[] = [
  {
    // `(?:process\.)?` because the read matcher accepts BOTH forms and the ban
    // must not be narrower than the matcher in the direction that matters:
    // `env["LLM_PROVIDER"]` against a narrowed parameter is invisible to the
    // matcher AND was permitted by the old pattern — and it is the MORE likely
    // form, because the narrowed `env` parameter is what every optional feature
    // here already uses. Zero instances at this head, which is when a ban is
    // free.
    //
    // It also matches an unrelated `config.env[...]`, which is a false positive
    // that FAILS CLOSED: someone is told to rename a variable rather than being
    // told their environment read is verified when it is not.
    pattern: /(?:process\.)?env\s*\[/g,
    what: 'env["X"] or process.env["X"] — computed access',
  },
  {
    pattern: /(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:process\.)?env\b/g,
    what: "destructuring out of process.env",
  },
];

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
  GITHUB_STEP_SUMMARY:
    "the Actions runner sets this to a per-step file path. Forwarding our own value would override the runner's and write the report somewhere nothing collects it",
};

/**
 * Keys the workflow passes that the worker does NOT read, each with the reason.
 *
 * The mirror of DELIBERATELY_ABSENT, and it exists because of an asymmetry the
 * first version of this file had: it looped over what the walk FOUND, and A
 * LOOP OVER WHAT YOU FOUND CANNOT SEE WHAT YOU STOPPED FINDING. A degraded
 * walk — an import pattern that stops resolving, a renamed module — would drop
 * the seven summariser reads out of `reads`, sail through every floor below,
 * and print OK while verifying nothing about the wiring it exists to verify.
 *
 * Asserting from this end closes it: the workflow still forwards those keys, so
 * a key that is forwarded and no longer read means either the code stopped
 * reading it or THE WALK STOPPED SEEING IT, and both are worth failing for.
 */
const INFRASTRUCTURE: Record<string, string> = {
  NEXT_TELEMETRY_DISABLED: "read by the Next.js CLI, not by our code",
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
function readsReachableFrom(entry: string): {
  reads: Map<string, string>;
  files: string[];
} {
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
  return { reads, files: [...seen] };
}

/**
 * The keys in scope for the job that actually runs the worker.
 *
 * SCOPED TO THAT ONE JOB, not to every four-space `env:` in the file. The first
 * version unioned them all, which is fine while there is one job and wrong the
 * moment there are two: a variable forwarded only to a SECOND job would read as
 * visible to the worker. That is the same mistake as reading the alarm step's
 * env block, one level up — and the alarm step is why the step-level blocks are
 * still excluded.
 *
 * Workflow-level `env:` (column zero) IS in scope, because GitHub applies it to
 * every job. There is none today; supporting it is cheaper than discovering the
 * omission from a wrong answer.
 */
/**
 * Does this job body actually RUN the worker?
 *
 * Read from `run:` rather than from anywhere in the job, because the previous
 * version matched the string anywhere — so a future COMMENT mentioning
 * `worker:once` in a second job would have tripped the ambiguity refusal. That
 * fails closed, so the risk was a false alarm rather than a missed gap; the
 * reason to fix it anyway is that a checker which cries wolf is a checker
 * somebody eventually loosens, and loosening this one removes a real guard.
 *
 * Handles both shapes this repository uses: `run: npm run worker:once` on one
 * line, and a `run: |` block with the command on a following line.
 */
function runsWorker(body: string[]): boolean {
  let blockIndent: number | null = null;
  for (const line of body) {
    // A full-line comment is never a command.
    if (/^\s*#/.test(line)) continue;

    if (blockIndent !== null) {
      const indent = line.search(/\S/);
      if (indent === -1) continue;
      if (indent > blockIndent) {
        if (line.includes(WORKER_COMMAND)) return true;
        continue;
      }
      blockIndent = null;
    }

    const block = /^(\s*)(?:- )?run:\s*[|>]/.exec(line);
    if (block) {
      blockIndent = block[1].length;
      continue;
    }
    if (/(?:^|\s)run:/.test(line) && line.includes(WORKER_COMMAND)) return true;
  }
  return false;
}

function scopedEnv(path: string): {
  provided: Set<string>;
  job: string | null;
  ambiguous?: string[];
} {
  const lines = readFileSync(path, "utf8").split("\n");
  const provided = new Set<string>();

  // Workflow-level env, before `jobs:`.
  let inTopEnv = false;
  for (const line of lines) {
    if (/^jobs:/.test(line)) break;
    if (/^env:\s*$/.test(line)) {
      inTopEnv = true;
      continue;
    }
    if (inTopEnv) {
      const entry = /^ {2}([A-Z][A-Z0-9_]*):/.exec(line);
      if (entry) {
        provided.add(entry[1]);
        continue;
      }
      if (/^\s*(#.*)?$/.test(line)) continue;
      inTopEnv = false;
    }
  }

  // Split into jobs by their two-space keys, then pick the one that runs the
  // worker. A job is identified by what it DOES, not by being named "ingest":
  // renaming the job must not silently move this check to a different one.
  const jobStarts: { name: string; at: number }[] = [];
  let inJobs = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^jobs:\s*$/.test(lines[i])) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    const head = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
    if (head) jobStarts.push({ name: head[1], at: i });
  }

  // EVERY job that runs the worker, not the first. Taking the first would
  // examine one job's wiring and silently ignore the other's — which is this
  // checker's own defect, committed by the checker. Found by a control that was
  // aimed wrong and revealed something anyway.
  const runners = jobStarts.filter((start, j) => {
    const to = j + 1 < jobStarts.length ? jobStarts[j + 1].at : lines.length;
    return runsWorker(lines.slice(start.at, to));
  });

  if (runners.length > 1) {
    // Refused rather than unioned. A union has exactly the flaw this scoping
    // exists to remove: a variable forwarded to only one of them would read as
    // visible to both.
    return { provided, job: null, ambiguous: runners.map((r) => r.name) };
  }

  for (let j = 0; j < jobStarts.length; j++) {
    const from = jobStarts[j].at;
    const to = j + 1 < jobStarts.length ? jobStarts[j + 1].at : lines.length;
    const body = lines.slice(from, to);
    if (!runsWorker(body)) continue;

    let inJobEnv = false;
    for (const line of body) {
      if (/^ {4}env:\s*$/.test(line)) {
        inJobEnv = true;
        continue;
      }
      if (inJobEnv) {
        const entry = /^ {6}([A-Z][A-Z0-9_]*):/.exec(line);
        if (entry) {
          provided.add(entry[1]);
          continue;
        }
        if (/^\s*(#.*)?$/.test(line)) continue;
        inJobEnv = false;
      }
    }
    return { provided, job: jobStarts[j].name };
  }

  return { provided, job: null };
}

function main(): void {
  const { reads, files } = readsReachableFrom(WORKER_ENTRY);
  const { provided, job, ambiguous } = scopedEnv(WORKFLOW);
  const modules = files.length;
  const problems: string[] = [];

  // Floors first. A parser that matched nothing, or a graph walk that resolved
  // nothing, would otherwise print a clean bill of health — the exact shape of
  // instrument this repository keeps deleting.
  // ── When the scope cannot be determined, SAY SO AND STOP ────────────────
  //
  // This is an early exit rather than another problem in the list, and the
  // reason is the family this whole file was written to catch. With the scope
  // undetermined, `provided` is empty — not because the workflow forwards
  // nothing, but BECAUSE NOTHING WAS PARSED. Falling through to the loops below
  // then reported twelve variables as "not passed" and one as "no longer
  // forwarded": fourteen problems of which ONE was true, and thirteen were
  // absence asserted where the honest answer is "I did not look".
  //
  // It printed exactly that during this checker's own ambiguity control, and
  // the control was recorded as a pass because the output was read through
  // `head -6` and the ambiguity refusal was the first line.
  const undetermined = ambiguous
    ? `${ambiguous.length} jobs in ${WORKFLOW} run \`${WORKER_COMMAND}\` (${ambiguous.join(", ")}). This checker compares against ONE env block and cannot tell you which is authoritative, and unioning them would reintroduce the very confusion the scoping removes — a variable forwarded to only one would read as visible to both. Split them, or teach this script which one is the scheduled pass.`
    : job === null
      ? `no job in ${WORKFLOW} runs \`${WORKER_COMMAND}\`, so there is no env block to compare against. Either the workflow changed or this checker is pointed at the wrong file.`
      : null;

  if (undetermined !== null) {
    console.error(
      `FAIL: the scope could not be determined, so nothing below was checked.\n\n  - ${undetermined}\n\n` +
        `  Reporting which variables are unforwarded would be reporting an absence this run did not establish.\n`,
    );
    process.exit(1);
  }

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

  // Forms this checker cannot follow. Refused, because a read it cannot see is
  // a read it reports as absent — failing OPEN.
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const { pattern, what } of FORBIDDEN_ENV_ACCESS) {
      pattern.lastIndex = 0;
      if (pattern.test(source)) {
        problems.push(
          `${file} reads the environment via ${what}, which this checker cannot follow and therefore cannot verify. Use \`env.NAME\` or \`process.env.NAME\`, or teach the matcher — do not leave a read it will silently report as wired.`,
        );
      }
    }
  }

  // ── Direction one: everything the worker READS is forwarded or declared ──
  for (const [name, file] of [...reads].sort()) {
    const absentOnPurpose = name in DELIBERATELY_ABSENT;
    if (provided.has(name)) {
      if (absentOnPurpose) {
        problems.push(
          `${name} is declared deliberately absent ("${DELIBERATELY_ABSENT[name]}") but ${WORKFLOW} passes it. One of the two is wrong and a stale declaration is how a real gap hides.`,
        );
      }
      if (name in INFRASTRUCTURE) {
        problems.push(
          `${name} is listed as infrastructure ("${INFRASTRUCTURE[name]}") but ${file} reads it. The label is now wrong, and a wrong label is what excuses it from the check above.`,
        );
      }
      continue;
    }
    if (absentOnPurpose) continue;
    problems.push(
      `${name} is read by ${file} and ${WORKFLOW} does not pass it, so the worker can never see it. Either forward it in the job's env block, or declare it in DELIBERATELY_ABSENT with the reason. An optional variable the workflow never passes is not optional — it is absent always.`,
    );
  }

  // ── Direction two: everything FORWARDED is read, or declared infrastructure ──
  //
  // THIS IS THE HALF THAT SURVIVES A DEGRADED WALK. The floors catch a walk
  // that collapses; they do not catch one that quietly loses a subtree, because
  // a loop over what was found cannot see what stopped being found. The
  // workflow still forwards those keys, so this end notices.
  for (const name of [...provided].sort()) {
    if (reads.has(name)) continue;
    if (name in INFRASTRUCTURE) continue;
    problems.push(
      `${WORKFLOW} forwards ${name} and nothing the worker can reach reads it. Either the code stopped reading it — in which case drop it from the workflow — or THE IMPORT WALK STOPPED SEEING THE MODULE THAT DOES, which would silently retire this check for that feature. Add it to INFRASTRUCTURE only if it is genuinely read by tooling rather than by us.`,
    );
  }

  // ── And every declaration is still live ─────────────────────────────────
  for (const [name, why] of Object.entries(DELIBERATELY_ABSENT)) {
    if (!reads.has(name)) {
      problems.push(
        `${name} is declared deliberately absent ("${why}") but nothing the worker reaches reads it any more. Drop the declaration: an entry nobody needs is an exception waiting to excuse a real gap.`,
      );
    }
  }
  for (const [name, why] of Object.entries(INFRASTRUCTURE)) {
    if (!provided.has(name)) {
      problems.push(
        `${name} is listed as infrastructure ("${why}") but ${WORKFLOW} no longer forwards it. Drop the entry.`,
      );
    }
  }

  if (problems.length > 0) {
    console.error(`FAIL: ${problems.length} problem(s).\n`);
    for (const problem of problems) console.error(`  - ${problem}\n`);
    process.exit(1);
  }

  // THE LINE PUBLISHES ITS OWN SUBJECT, and that is deliberate: a one-time
  // control expires on the next edit, a printed quantity does not. If the walk
  // starts reaching 12 modules instead of 43, this line says so on every run
  // and nobody has to remember that a control was ever run.
  const wired = [...reads].filter(([name]) => provided.has(name)).length;
  console.log(
    `OK job "${job}" runs ${WORKER_COMMAND}: ${reads.size} environment reads across ${modules} modules reachable from ${WORKER_ENTRY}; ` +
      `${wired} forwarded and read, ${Object.keys(DELIBERATELY_ABSENT).length} declared deliberately absent, ` +
      `${provided.size} keys in scope of which ${Object.keys(INFRASTRUCTURE).length} are infrastructure.`,
  );
}

main();
