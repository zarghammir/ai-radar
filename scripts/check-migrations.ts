import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Does the migration journal agree with the directory, and will every new
 * migration actually run?
 *
 * Three branches each created a `0003` in one evening (#109). The journal
 * conflict is the only thing that makes a collision visible at all, and every
 * wrong resolution of it is silent at the moment it is made.
 *
 * WHAT THE MIGRATOR ACTUALLY READS, measured rather than assumed
 * (node_modules/drizzle-orm/migrator.js and pg-core/dialect.js):
 *
 *   - `idx` is read NOWHERE. Zero occurrences in either build. It is
 *     decorative, which is why the numbering three of us carefully agreed one
 *     evening reserved nothing at all — the timestamp did that work.
 *   - `tag` names the file: it reads `${tag}.sql`, and a missing file THROWS.
 *   - `when` becomes `folderMillis`, and is the whole of the gate:
 *         !lastDbMigration || Number(lastDbMigration.created_at) < folderMillis
 *     Strictly greater, and `lastDbMigration` is read ONCE before the loop.
 *
 * So the failure modes have very different volumes, and the quiet ones are the
 * reason this exists:
 *
 *   entry without a file      LOUD   — the migrator throws at migrate time
 *   file without an entry     SILENT — never read, never runs, ever
 *   `when` below the applied  SILENT — skipped, and PERMANENTLY: the recorded
 *     maximum                          created_at only moves forward, so the
 *                                      entry can never become eligible again
 *   duplicated `idx`          NOTHING — unread
 *
 *   npm run migrations:check
 *   npm run migrations:check -- origin/main     (also checks against a base)
 */

const DIR = "drizzle";

interface Entry {
  idx: number;
  when: number;
  tag: string;
}

function readJournal(text: string, where: string): Entry[] {
  const parsed = JSON.parse(text) as { entries?: Entry[] };
  if (!Array.isArray(parsed.entries)) throw new Error(`${where}: no entries array`);
  return parsed.entries;
}

const failures: string[] = [];
const fail = (m: string) => failures.push(m);

const entries = readJournal(readFileSync(`${DIR}/meta/_journal.json`, "utf8"), "_journal.json");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.slice(0, -4))
  .sort();

// ── A floor on the INPUTS, before any comparison ──────────────────────────
// Two empty sets agree with each other exactly as loudly as two real ones.
// This failed in three separate instruments in one evening, once inside a
// check written to catch vacuous instruments.
if (entries.length === 0) fail("the journal lists no migrations at all");
if (files.length === 0) fail(`no .sql files found in ${DIR}/ — the glob matched nothing`);

// ── 1. The same set, both directions ──────────────────────────────────────
const tags = entries.map((e) => e.tag);
for (const tag of tags) {
  if (!files.includes(tag)) fail(`journal names "${tag}" but ${DIR}/${tag}.sql does not exist`);
}
for (const file of files) {
  // The silent one: a .sql nobody lists is never read and never runs.
  if (!tags.includes(file)) fail(`${DIR}/${file}.sql has no journal entry, so it will never run`);
}

// ── 2. Indices unique and contiguous from zero ────────────────────────────
// `idx` changes nothing at migrate time. It is checked because a duplicate or
// a gap is the fingerprint of a badly resolved collision, and that collision
// is usually accompanied by something that DOES matter.
//
// THE FAILURE TEXT MATTERS MORE THAN THE CHECK HERE. The cheapest way to make
// an idx red go away is to renumber — and renumbering is the operation that
// touches `when`, which is the one field whose mistake is unrecoverable. A red
// whose obvious remedy is the fatal action is worse than no red, so the remedy
// is forbidden by name in the OUTPUT, where someone in a hurry will read it. A
// docblock is read by whoever is investigating; the failure message is read by
// whoever is trying to get on with something.
const IDX_NOTE =
  "\n      DO NOT renumber to silence this. A gap or a duplicate means a merge " +
  "order slipped — report it rather than tidying it away.\n      `idx` is INERT: " +
  "drizzle reads only `tag` and `when`, so renumbering changes nothing the " +
  "migrator sees, and it edits `when`, where a mistake can never be recovered " +
  "by a later migrate. This check is telling you about OUR process, not about " +
  "drizzle.";

const idxs = entries.map((e) => e.idx);
for (const [i, idx] of idxs.entries()) {
  if (idx !== i) fail(`entry ${i} ("${entries[i].tag}") has idx ${idx}; expected ${i}${IDX_NOTE}`);
}
// NO SEPARATE DUPLICATE CHECK. `idx[i] === i` for every i already implies all
// of them are distinct, so a `new Set(idxs).size !== idxs.length` test could
// never be the reason for a failure. It was here, it read as belt and braces,
// and running the controls showed a duplicated idx reddening the CONTIGUITY
// line instead — an instrument that cannot fail, inside the check written to
// find instruments that cannot fail. Deleted rather than kept.

// ── 3. `when` strictly ascending, in array order ──────────────────────────
// The migrator iterates the array, so array order is execution order, while
// `when` decides eligibility. If the two disagree, a later migration can run
// before an earlier one, or be skipped while its neighbours apply.
for (let i = 1; i < entries.length; i++) {
  if (entries[i].when <= entries[i - 1].when) {
    fail(
      `"${entries[i].tag}" has when=${entries[i].when}, not greater than ` +
        `"${entries[i - 1].tag}" at ${entries[i - 1].when}`,
    );
  }
}

// ── 4. Against the base branch: will the new entries actually run? ────────
// The assertion the static checks cannot make. A journal can be contiguous,
// one-to-one with its files and ascending, and still contain an entry that
// never executes — because the gate compares against what a DATABASE has
// applied, not against the file's neighbours. Neither branch in a collision
// can see the other's timestamp; the merge result can see both.
const baseRef = process.argv[2] ?? process.env.MIGRATIONS_BASE_REF ?? "";
if (baseRef) {
  let baseText: string;
  try {
    baseText = execFileSync("git", ["show", `${baseRef}:${DIR}/meta/_journal.json`], {
      encoding: "utf8",
    });
  } catch {
    fail(`could not read the journal at ${baseRef} — is the base branch fetched?`);
    baseText = "";
  }
  if (baseText) {
    const base = readJournal(baseText, baseRef);
    const baseByTag = new Map(base.map((e) => [e.tag, e]));
    const baseMaxWhen = Math.max(...base.map((e) => e.when));

    // A migration that exists on the base and NOT here is the "take ours"
    // resolution: the base's entry vanishes, an applied migration looks
    // unapplied, and a later migrate re-runs it. #100's is not idempotent —
    // it writes a placeholder over NULL — so that re-run is not a no-op.
    //
    // Found by reading a control's own baseline output: the check reported
    // "base: 5 migrations" against a branch with 4 and said nothing.
    const branchTags = new Set(entries.map((e) => e.tag));
    for (const b of base) {
      if (!branchTags.has(b.tag)) {
        fail(
          `"${b.tag}" exists on ${baseRef} and is missing here. An applied migration ` +
            `would look unapplied and be re-run, which is not always a no-op.`,
        );
      }
    }

    for (const e of entries) {
      const already = baseByTag.get(e.tag);
      if (already) {
        // Rewriting an applied migration's timestamp changes what every
        // database believes it has run.
        if (already.when !== e.when) {
          fail(
            `"${e.tag}" already exists on ${baseRef} with when=${already.when}, changed to ${e.when}`,
          );
        }
      } else if (e.when <= baseMaxWhen) {
        fail(
          `"${e.tag}" is new but when=${e.when} is not above ${baseRef}'s maximum ${baseMaxWhen}. ` +
            `A database already at ${baseRef} would SKIP it, permanently.`,
        );
      }
    }
    console.log(`base ${baseRef}: ${base.length} migrations, max when ${baseMaxWhen}`);
  }
} else if (process.env.GITHUB_EVENT_NAME === "pull_request") {
  // A pull request is the only place the cross-branch check can run, so
  // skipping it there is a failure rather than a default.
  fail("no base ref given on a pull_request — the cross-branch check cannot be skipped here");
} else {
  console.log("base comparison SKIPPED: no base ref given");
}

if (failures.length) {
  console.error(`\nFAIL — ${failures.length} problem(s) in ${DIR}/\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exitCode = 1;
} else {
  console.log(`OK ${entries.length} migrations, journal and files agree, every when ascends`);
}
