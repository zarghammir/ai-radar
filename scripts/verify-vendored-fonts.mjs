#!/usr/bin/env node
/**
 * Checks the vendored font files are still the bytes PROVENANCE.md says they are.
 *
 * WHY THIS EXISTS. #160 moved the three brand faces from next/font/google, which
 * fetched them from fonts.gstatic.com on every build, to next/font/local with the
 * files committed. The whole claim of that change is that the committed bytes are
 * IDENTICAL to what was being downloaded before, so no glyph any reader sees
 * changes. That claim is written down in src/app/fonts/PROVENANCE.md as twelve
 * sha256 values — and a hash written in a document beside a binary is exactly the
 * kind of evidence that rots without anyone noticing. This turns it into a check.
 *
 * IT FAILS IN THREE DIRECTIONS, not one:
 *
 *   CHANGED   a file's bytes no longer match its recorded sha256
 *   MISSING   the manifest lists a file that is not on disk
 *   UNLISTED  a .woff2 is on disk that the manifest does not mention
 *
 * The third is the one a manifest-walking loop cannot see. Iterating the manifest
 * and hashing each entry proves every LISTED file is right and says nothing about
 * a file someone dropped in beside them — the loop just never visits it. So the
 * file set is compared in BOTH directions, from the manifest and from the disk.
 *
 * EXIT CODES, the same three-state contract the browser checks use:
 *   0  every file present and unchanged
 *   1  a check failed — something here is not what PROVENANCE.md claims
 *   2  the instrument could not run (no manifest, unreadable directory)
 *
 * 2 is not 0. A checker that cannot find its own inputs has not passed.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(here, "..", "src", "app", "fonts");
const MANIFEST = join(FONT_DIR, "manifest.json");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * @returns {{ok: boolean, lines: string[]}}
 * Pure so the self-test can drive it with fabricated inputs rather than by
 * writing to the real directory and putting it back afterwards.
 */
export function compare(manifest, onDisk, read) {
  const lines = [];
  let bad = 0;

  const listed = new Set(manifest.map((e) => e.file));
  for (const entry of manifest) {
    if (!onDisk.includes(entry.file)) {
      lines.push(`  MISSING   ${entry.file}`);
      bad++;
      continue;
    }
    const got = sha256(read(entry.file));
    if (got !== entry.sha256) {
      lines.push(`  CHANGED   ${entry.file}`);
      lines.push(`            recorded ${entry.sha256}`);
      lines.push(`            actual   ${got}`);
      bad++;
    } else {
      lines.push(`  ok        ${entry.file}  ${entry.bytes} B  ${entry.subset}`);
    }
  }

  // FROM THE OTHER END. Without this, adding a thirteenth file is invisible.
  for (const file of onDisk) {
    if (!listed.has(file)) {
      lines.push(`  UNLISTED  ${file} — on disk, absent from PROVENANCE.md`);
      bad++;
    }
  }

  return { ok: bad === 0, lines };
}

if (process.argv.includes("--self-test")) {
  // A checker nobody has watched fail is a checker that might pass over anything.
  // Each case below must be caught, and the clean case must NOT be flagged.
  const one = Buffer.from("pretend this is a font");
  const manifest = [{ file: "a.woff2", bytes: one.length, sha256: sha256(one), subset: "latin" }];
  const cases = [
    ["clean set passes", manifest, ["a.woff2"], () => one, true],
    ["changed bytes caught", manifest, ["a.woff2"], () => Buffer.from("different"), false],
    ["missing file caught", manifest, [], () => one, false],
    ["unlisted file caught", manifest, ["a.woff2", "sneaked-in.woff2"], () => one, false],
  ];
  let wrong = 0;
  for (const [name, m, disk, read, wantOk] of cases) {
    const got = compare(m, disk, read).ok;
    if (got !== wantOk) wrong++;
    console.log(`  ${got === wantOk ? "ok  " : "FAIL"} ${name}`);
  }
  console.log(wrong === 0 ? "RESULT: all cases pass" : `RESULT: ${wrong} wrong`);
  process.exit(wrong === 0 ? 0 : 1);
}

let manifest, onDisk;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  onDisk = readdirSync(FONT_DIR).filter((f) => f.endsWith(".woff2"));
} catch (err) {
  console.error(`Could not read the vendored fonts or their manifest: ${err.message}`);
  console.error("This is not a pass. Exiting 2.");
  process.exit(2);
}

const { ok, lines } = compare(manifest, onDisk, (f) => readFileSync(join(FONT_DIR, f)));
for (const line of lines) console.log(line);
console.log(
  ok
    ? `RESULT: ${manifest.length} vendored fonts match PROVENANCE.md`
    : "RESULT: the vendored fonts are NOT what PROVENANCE.md claims",
);
process.exit(ok ? 0 : 1);
