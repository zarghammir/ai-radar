#!/usr/bin/env node
/**
 * Every container image this repository pulls names a registry, and the two
 * places that document the same pull agree with each other.
 *
 * WHY. Docker Hub answers an anonymous request with `ratelimit-limit:
 * 100;w=3600` and `docker-ratelimit-source: <the caller's IP>` — a hundred pulls
 * an hour PER SOURCE ADDRESS, not per account and not per repository. GitHub's
 * runners share NAT egress, so a Hub pull in CI competes with every other
 * anonymous puller behind that address and the budget is spent by strangers.
 * One red build a week came from this (#160). Our own pull count was never the
 * cause, so reducing it cannot be the fix.
 *
 * `postgres:17-alpine` is a Docker Hub reference. `mirror.gcr.io/library/
 * postgres:17-alpine` is the same image from Google's pull-through cache, which
 * needs no credentials and advertises no per-IP hourly limit. An unqualified
 * reference is the defect this looks for, because the fix is invisible: both
 * forms work on any developer's machine, and the difference only shows up as a
 * red run on a shared address, weeks later, looking like flakiness.
 *
 * WHY A GREP CANNOT DO THIS. `grep postgres:17-alpine` matches the middle of
 * `mirror.gcr.io/library/postgres:17-alpine`, matches every comment that
 * mentions the old value — including the comments explaining this change — and
 * matches `@postgres:5432/ai_radar`, which is a database host in a connection
 * string and not an image at all. All nine of those were false positives when
 * this was checked by grep. So only real image DECLARATIONS are read: `FROM` in
 * a Dockerfile and an `image:` key in compose or a workflow.
 *
 * AND THE LOCKSTEP. quick-start.yml exists to run the command the README gives a
 * contributor, verbatim — that is its whole purpose, and its own comment says
 * so. If the README names one image and the workflow pulls another, the workflow
 * still passes while testing something nobody was told to run. Nothing else in
 * the repository would notice. So they are compared to each other.
 *
 * EXIT CODES, the three-state contract the other checks use:
 *   0  every declaration names a registry, and the two documents agree
 *   1  an unqualified reference, or the documents disagree
 *   2  the instrument could not run (a file it reads is missing)
 */

import { readFileSync } from "node:fs";

/**
 * Registries we accept. Anything with no host at all is a Docker Hub shorthand.
 * A host is recognised by containing a dot or being "localhost" — the rule Docker
 * itself uses to tell `myimage` from `example.com/myimage`.
 */
const FILES = [
  "Dockerfile",
  "docker-compose.yml",
  ".github/workflows/ci.yml",
  // quick-start.yml pulls inside a `docker run`, not through an `image:` key, so it
  // yields no declarations and that is correct. Its image is floored by the README
  // lockstep instead.
  ".github/workflows/quick-start.yml",
];

/** A line that MEANS to declare an image, whether or not a value could be read. */
const INTENT = /^\s*(FROM\b|image:)/;

/** @returns {Array<{file: string, line: number, ref: string}>} */
export function declarations(sources) {
  const found = [];
  for (const [file, text] of Object.entries(sources)) {
    text.split("\n").forEach((raw, i) => {
      const line = raw.replace(/#.*$/, ""); // a comment is not a declaration
      let m = line.match(/^\s*FROM\s+(\S+)/);
      if (!m) m = line.match(/^\s*image:\s*["']?([^"'\s]+)/);
      if (!m) return;
      const ref = m[1];
      // An interpolated value is not ours to judge — but it is still RECORDED, so the
      // floor above can tell "this line was deliberately skipped" from "this line was
      // not read at all". Dropping it here made the floor report a false breach.
      found.push({ file, line: i + 1, ref, interpolated: ref.startsWith("$") });
    });
  }
  return found;
}

/**
 * THE FLOOR, and why this check needs one at all.
 *
 * declarations() finds images by pattern: `FROM <ref>`, and `image:` followed by a
 * value on the SAME line. Both are conventions, not grammar. A perfectly valid YAML
 * reformat that moves the value to the next line, a rename, a `FROM` behind a
 * platform flag — any of these makes the pattern match nothing. The loop over the
 * results then never runs, nothing increments the error count, and the script prints
 * "every image names a registry" and exits 0.
 *
 * THAT IS A VACUOUS PASS IN THE GUARD WHOSE ONE JOB IS TO NOTICE AN IMAGE REFERENCE
 * NOBODY MEANT TO LEAVE. It is the same shape as a registry test that walks a
 * registry: it can only be wrong about what it found, never about what it missed.
 *
 * So the floor compares INTENT against PARSE, per file: every line that means to
 * declare an image — `FROM`, or an `image:` key — must have produced a reference.
 *
 * TWO WEAKER FLOORS WERE TRIED AND BOTH WERE BLIND. A total COUNT goes stale the
 * first time someone adds a service, and the next person raises the constant rather
 * than asking why it moved. "At least one declaration per file" is no better, and it
 * failed its own control: docker-compose.yml declares `ai-radar:local` twice, so
 * moving the POSTGRES value to the next line left the file still yielding
 * declarations and the floor still green — a length floor, blind to losing one line
 * among several, which is the only way this ever actually breaks.
 *
 * Intent-versus-parse needs no constant, survives a new service, and names both the
 * file and the arithmetic: "3 lines declare an image, 2 were read".
 *
 * It exits 2, not 1. "An image is wrong" and "this check could not read the file it
 * is about" are different states and the exit contract already has a code for the
 * second.
 *
 * @returns {string[]} files that were expected to yield a declaration and did not
 */
export function floorBreaches(sources, found) {
  const breaches = [];
  for (const [file, text] of Object.entries(sources)) {
    const intents = text
      .split("\n")
      .map((l) => l.replace(/#.*$/, ""))
      .filter((l) => INTENT.test(l)).length;
    const read = found.filter((d) => d.file === file).length;
    if (intents !== read) breaches.push({ file, intents, read });
  }
  return breaches;
}

/** True when the reference carries an explicit registry host. */
export function hasRegistry(ref) {
  const first = ref.split("/")[0];
  if (ref.split("/").length < 2) return false;
  return first.includes(".") || first === "localhost" || first.includes(":");
}

/**
 * The image in a `docker run` block: its LAST argument, after joining the
 * backslash continuations the README and the workflow both use.
 *
 * Scanning backwards for "a token containing a colon" does NOT work and the
 * self-test holds the proof: `-p 5432:5432` puts `5432:5432` in its own token,
 * which has a colon, does not begin with a dash and contains no equals sign. It
 * was picked as the image. An image reference has to contain a letter, and the
 * image is the final argument, so both conditions are required.
 */
export function dockerRunImage(text) {
  // Skip an occurrence inside a YAML `name:` — a step called "docker run ..." is
  // prose, not a command. This was a real false positive: the step name here ends
  // in the word "names", which was read as the image.
  const all = text.split("\n");
  let start = -1;
  for (let i = 0; i < all.length; i++) {
    // The command must BEGIN the line. Prose that merely mentions it — a step name,
    // or a trailing `# was a docker run` — is not the command, and reading one as the
    // command made a broken README look like a DISAGREEMENT rather than an unreadable
    // file, which are different states with different exit codes.
    if (!/^\s*docker run\b/.test(all[i])) continue;
    if (/^\s*-?\s*name:/.test(all[i])) continue;
    start = all.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
    break;
  }
  if (start < 0) return null;
  const lines = text.slice(start).split("\n");
  const collected = [];
  for (const line of lines) {
    collected.push(line.replace(/\\\s*$/, ""));
    if (!/\\\s*$/.test(line)) break; // no continuation: the command ends here
  }
  const parts = collected.join(" ").split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || !/[a-zA-Z]/.test(last) || last.startsWith("-") || last.includes("=")) return null;
  return last;
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ["postgres:17-alpine", false],
    ["node:22-alpine", false],
    ["mirror.gcr.io/library/postgres:17-alpine", true],
    ["mirror.gcr.io/library/postgres@sha256:abc", true],
    ["public.ecr.aws/docker/library/postgres:17", true],
    ["localhost:5000/mine:1", true],
    ["ai-radar:local", false],
  ];
  let bad = 0;
  for (const [ref, want] of cases) {
    const got = hasRegistry(ref);
    if (got !== want) bad++;
    console.log(`  ${got === want ? "ok  " : "FAIL"} ${String(want).padEnd(5)} ${ref}`);
  }
  // A comment mentioning the old value must NOT be read as a declaration, and a
  // connection-string host must not be read as an image. Both were real false
  // positives when a grep was tried.
  const tricky = {
    "f.yml": [
      "# NOT postgres:17-alpine from Docker Hub",
      "    image: mirror.gcr.io/library/postgres:17-alpine",
      "      DATABASE_URL: postgres://u:p@postgres:5432/db",
      "FROM mirror.gcr.io/library/node:22-alpine AS builder",
    ].join("\n"),
  };
  const got = declarations(tricky);
  const wantRefs = [
    "mirror.gcr.io/library/postgres:17-alpine",
    "mirror.gcr.io/library/node:22-alpine",
  ];
  const okTricky = got.length === 2 && wantRefs.every((r) => got.some((g) => g.ref === r));
  if (!okTricky) {
    bad++;
    console.log(`  FAIL  comments and connection strings must not parse as images`);
    got.forEach((g) => console.log(`        read: ${g.ref}`));
  } else console.log("  ok   comments and connection strings are not declarations");

  const run = dockerRunImage(
    "docker run --name db -d -p 5432:5432 \\\n  -e POSTGRES_USER=u \\\n  mirror.gcr.io/library/postgres:17-alpine\n",
  );
  if (run !== "mirror.gcr.io/library/postgres:17-alpine") {
    bad++;
    console.log(`  FAIL  docker run image parsed as ${run}`);
  } else console.log("  ok   docker run image is read past its flags");

  // A STEP NAMED AFTER THE COMMAND IS NOT THE COMMAND. The real quick-start step
  // is called "docker run ... the Postgres image the README names", and its last
  // word parsed as the image until this was handled.
  const named = dockerRunImage(
    [
      "      - name: docker run ... the Postgres image the README names",
      "        run: |",
      "          docker run --name db -d \\",
      "            mirror.gcr.io/library/postgres:17-alpine",
    ].join("\n"),
  );
  if (named !== "mirror.gcr.io/library/postgres:17-alpine") {
    bad++;
    console.log(`  FAIL  a step NAMED "docker run ..." was read as the command: ${named}`);
  } else console.log("  ok   a step named after the command is not read as the command");

  // THE FLOOR'S OWN CASES. A YAML reformat that moves the value to the next line is
  // the exact shape that made this half pass over nothing.
  const floorCases = [
    [
      "a reformatted image: is a breach",
      { "a.yml": ["services:", "  db:", "    image:", "      postgres:17-alpine"].join("\n") },
      1,
    ],
    [
      "a file with no image lines at all is not a breach",
      { "quick.yml": ["steps:", "  - run: docker run --name db x.io/y:1"].join("\n") },
      0,
    ],
    [
      "a readable declaration is not a breach",
      { "b.yml": "    image: mirror.gcr.io/library/x:1" },
      0,
    ],
    [
      "an interpolated value is recorded, not a breach",
      { "c.yml": "    image: ${POSTGRES_IMAGE}" },
      0,
    ],
    // THE CASE THE PREVIOUS FLOOR MISSED, and the reason this one exists. Three image
    // lines, two readable: "at least one declaration per file" is satisfied and stays
    // green while the reformatted line goes unchecked. That is docker-compose.yml
    // exactly — it declares ai-radar:local twice beside postgres.
    [
      "one reformatted line among several readable ones is still a breach",
      {
        "d.yml": [
          "    image: ai-radar:local",
          "    image:",
          "      postgres:17-alpine",
          "    image: ai-radar:local",
        ].join("\n"),
      },
      1,
    ],
  ];
  for (const [name, sources, wantBreaches] of floorCases) {
    const got = floorBreaches(sources, declarations(sources));
    const ok = got.length === wantBreaches;
    if (!ok) bad++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
    if (!ok) console.log(`        got ${JSON.stringify(got)}, wanted ${wantBreaches} breach(es)`);
  }

  // Prose that merely mentions the command is not the command.
  const mentioned = dockerRunImage("  docker compose up -d # was a docker run\n");
  if (mentioned !== null) {
    bad++;
    console.log(`  FAIL  a trailing "# was a docker run" was read as the command: ${mentioned}`);
  } else {
    console.log("  ok   prose mentioning docker run is not read as the command");
  }

  console.log(bad === 0 ? "RESULT: all cases pass" : `RESULT: ${bad} wrong`);
  process.exit(bad === 0 ? 0 : 1);
}

let sources, readme, quickStart;
try {
  sources = Object.fromEntries(FILES.map((f) => [f, readFileSync(f, "utf8")]));
  readme = readFileSync("README.md", "utf8");
  quickStart = sources[".github/workflows/quick-start.yml"];
} catch (err) {
  console.error(`Could not read a file this check needs: ${err.message}`);
  console.error("This is not a pass. Exiting 2.");
  process.exit(2);
}

const found = declarations(sources);

// BEFORE ANY VERDICT. If a file that must yield a declaration yielded none, the
// half of this check that reads declarations did not run, and its silence is not a
// pass. See floorBreaches.
const breaches = floorBreaches(sources, found);
if (breaches.length > 0) {
  for (const b of breaches) {
    console.error(
      `  UNREAD    ${b.file}: ${b.intents} line(s) declare an image, ${b.read} were read.`,
    );
  }
  console.error(
    "A line that declares an image was not read, so it was not checked and could be\n" +
      "any registry at all. A valid reformat putting an `image:` value on the next\n" +
      "line is enough to cause this. Not a pass. Exiting 2.",
  );
  process.exit(2);
}

let bad = 0;
for (const d of found) {
  if (d.interpolated) {
    console.log(`  ok        ${d.file}:${d.line} ${d.ref} (interpolated, not ours to judge)`);
    continue;
  }
  // ai-radar:local is built here, never pulled, so it has no registry to name.
  if (d.ref.startsWith("ai-radar:")) {
    console.log(`  ok        ${d.file}:${d.line} ${d.ref} (built locally, not pulled)`);
    continue;
  }
  if (hasRegistry(d.ref)) {
    console.log(`  ok        ${d.file}:${d.line} ${d.ref}`);
  } else {
    bad++;
    console.log(`  UNPINNED  ${d.file}:${d.line} ${d.ref}`);
    console.log(`            No registry named, so this pulls from Docker Hub, which`);
    console.log(`            rate-limits anonymously at 100/hour PER SOURCE IP.`);
    console.log(`            Use mirror.gcr.io/library/${d.ref} instead.`);
  }
}

const readmeImage = dockerRunImage(readme);
const workflowImage = dockerRunImage(quickStart);
if (!readmeImage || !workflowImage) {
  // Cannot READ them is not the same as they DISAGREE. The first is this check
  // failing, the second is the repository failing, and they get different codes.
  console.error(`  UNREAD    could not find a docker run image in README (${readmeImage}) or`);
  console.error(`            quick-start.yml (${workflowImage}). One of them changed shape,`);
  console.error(`            so the two documents were never compared. Exiting 2.`);
  process.exit(2);
} else if (readmeImage !== workflowImage) {
  bad++;
  console.log(`  DIVERGED  README says ${readmeImage}`);
  console.log(`            quick-start.yml pulls ${workflowImage}`);
  console.log(`            quick-start exists to run the README's command verbatim. While`);
  console.log(`            these differ it passes while testing something nobody was told`);
  console.log(`            to run, and nothing else here would notice.`);
} else {
  console.log(`  ok        README and quick-start.yml agree on ${readmeImage}`);
}

console.log(
  bad === 0
    ? "RESULT: every image names a registry, and the two documents agree"
    : `RESULT: ${bad} problem(s) — an image would be pulled from Docker Hub`,
);
process.exit(bad === 0 ? 0 : 1);
