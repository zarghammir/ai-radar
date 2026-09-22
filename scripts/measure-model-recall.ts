import "dotenv/config";
import { desc } from "drizzle-orm";
import { getDb, getSql } from "@/db/client";
import { redactConnectionParts } from "@/db/redact";
import { rawItems } from "@/db/schema";
import { classifyContentType } from "@/pipeline/normalize/content-type";
import { matchesAnyPhrase } from "@/pipeline/normalize/keywords";

/**
 * Does a candidate MODEL rule raise recall WITHOUT spending precision? (#76)
 *
 * READ-ONLY. It issues one SELECT and writes nothing. Re-running it changes
 * no row and no badge; the reclassify script is the one that writes.
 *
 * ── Why this shape ───────────────────────────────────────────────────────
 * #57 measured precision by reviewing every item the classifier MOVED. That
 * works because the moved set is small. Recall cannot be measured that way:
 * the misses are inside the set it left alone, which is most of the corpus.
 * So this prints two populations and they are judged differently:
 *
 *   PRECISION SET  every item a candidate newly types MODEL. Judged in full,
 *                  because a false positive is the expensive error here —
 *                  #57 measured a MODEL badge as worth ~70 places of rank.
 *
 *   RECALL SET     a deterministic sample of items NOTHING types, so the
 *                  denominator is stated rather than implied. Judged by hand
 *                  for "should this have been MODEL".
 *
 * The sample is every Nth unclassified item by descending id, which is a rule
 * a re-run reproduces exactly. Taking "the first 60" would sample one day's
 * news; taking a random 60 would make two runs disagree with no way to tell a
 * real change from the draw.
 *
 *   npx tsx scripts/measure-model-recall.ts
 */

/** How many unclassified items to print for recall judging. */
const RECALL_SAMPLE_SIZE = 60;

/**
 * A capitalised name immediately followed by a version, at the very start.
 *
 * THE POSITION IS THE DEFENCE, and it is the same one the live family rule
 * already uses (`family.index === 0`). A version anywhere in a title is the
 * shape that was measured and REVERTED on this ticket: it found 15 items and
 * got 8 wrong, because dates, newsletter numbering and software versions all
 * wear it. Anchoring to index 0 removes the dates and the incidental figures;
 * requiring a model noun as well is what removes the software.
 */
const LEADING_VERSIONED_NAME = /^[A-Z][A-Za-z0-9]*[-\s]\d+(?:\.\d+)*\b/;

/** The same, but only when the version is followed by a colon. */
const LEADING_VERSIONED_NAME_COLON = /^[A-Z][A-Za-z0-9]*[-\s]\d+(?:\.\d+)*\s*:/;

/** Copied from content-type.ts, which does not export it. See SELF_CHECKS. */
const MODEL_NOUNS = [
  "model",
  "llm",
  "vlm",
  "foundation model",
  "language model",
  "reasoning model",
  "frontier model",
  "checkpoint",
  "weights",
];

type Candidate = { name: string; adds: (title: string) => boolean };

/**
 * The two candidates differ only in whether the colon is required.
 *
 * A1 is the looser one. A2 keys on "Name Version: description", which is the
 * conventional shape of a release headline — tighter, and expected to cost
 * recall. Which one ships is decided by the numbers below, not here.
 */
const CANDIDATES: Candidate[] = [
  {
    name: "A1  leading Name+Version  AND  a model noun",
    adds: (t) => LEADING_VERSIONED_NAME.test(t) && matchesAnyPhrase(t, MODEL_NOUNS),
  },
  {
    name: "A2  leading Name+Version+COLON  AND  a model noun",
    adds: (t) => LEADING_VERSIONED_NAME_COLON.test(t) && matchesAnyPhrase(t, MODEL_NOUNS),
  },
];

/**
 * Run before anything is printed, because an embedded copy of another
 * module's vocabulary is an untested claim sitting inside the instrument.
 *
 * The titles are REAL — every one is recorded in #76 or in content-type.ts as
 * a measured miss or a measured false positive of the reverted rule. None is
 * invented for this script.
 */
const SELF_CHECKS: { title: string; a1: boolean; a2: boolean; why: string }[] = [
  // The misses this ticket exists to close.
  {
    title: "TimesFM-3: A zero-shot foundation model",
    a1: true,
    a2: true,
    why: "#76's recorded miss: leading versioned name, model noun, colon",
  },
  {
    title: "Aurora 1.5: Extending open foundation models",
    a1: true,
    a2: true,
    why: "#76's recorded miss: plural noun must match",
  },
  {
    title: "We're launching Lyria 3.5",
    a1: false,
    a2: false,
    why: "#76's third miss, NOT closed by either candidate: no model noun, name not leading",
  },
  // The reverted rule's measured false positives. None may return.
  {
    title: "State of Open Models: Summer 2026",
    a1: false,
    a2: false,
    why: "a date; no leading name+version",
  },
  { title: "Import AI 454", a1: false, a2: false, why: "newsletter numbering; no model noun" },
  { title: "Apple releases iOS 27", a1: false, a2: false, why: "software; name is not leading" },
  { title: "Datasette 1.0a39", a1: false, a2: false, why: "software; no model noun" },
  {
    title: "Training Text-to-Image Models 3.6x Faster",
    a1: false,
    a2: false,
    why: "incidental figure; no leading name+version",
  },
];

function runSelfChecks(): void {
  const failures: string[] = [];
  for (const check of SELF_CHECKS) {
    const got = [CANDIDATES[0].adds(check.title), CANDIDATES[1].adds(check.title)];
    const want = [check.a1, check.a2];
    for (let i = 0; i < 2; i++) {
      if (got[i] !== want[i]) {
        failures.push(
          `  ${CANDIDATES[i].name}\n    "${check.title}"\n    expected ${want[i]}, got ${got[i]} — ${check.why}`,
        );
      }
    }
  }
  if (failures.length > 0) {
    console.error(
      `SELF-CHECK FAILED (${failures.length}). The instrument disagrees with the measurements already recorded in #76, so nothing below would be trustworthy.\n${failures.join("\n")}`,
    );
    process.exit(1);
  }
  console.log(`self-checks: ${SELF_CHECKS.length} recorded titles behave as #76 recorded.\n`);
}

async function main(): Promise<void> {
  runSelfChecks();

  const rows = await getDb()
    // TITLE AND ID ONLY. The stored content_type is deliberately not read:
    // the baseline here is what the LIVE CLASSIFIER DOES, recomputed from the
    // title, not what happens to be on the row. A stored type can predate the
    // current rules, and comparing a candidate against yesterday's output
    // would measure the backfill rather than the change.
    //
    // It also keeps this query independent of columns a local database may
    // not have migrated yet — which is how the first run of this script
    // failed, on content_type_source.
    .select({
      id: rawItems.id,
      title: rawItems.title,
      publishedAt: rawItems.publishedAt,
    })
    .from(rawItems)
    .orderBy(desc(rawItems.id));

  // A corpus cannot be called current without saying when it ends. If the
  // newest item is a week old, every figure below describes a week-old
  // classifier against week-old news.
  const dates = rows.map((r) => r.publishedAt.getTime()).filter((n) => Number.isFinite(n));
  const span =
    dates.length > 0
      ? `${new Date(Math.min(...dates)).toISOString().slice(0, 10)} → ${new Date(Math.max(...dates)).toISOString().slice(0, 10)}`
      : "(no dates)";
  console.log(`corpus: ${rows.length} stored items, every one examined. published ${span}\n`);

  // The baseline is the LIVE classifier, called the way the pipeline calls it,
  // rather than a reading of what it should do.
  const baseline = rows.map((row) => ({
    ...row,
    // NEWS is the neutral default every adapter falls back to, so passing it
    // asks the classifier the same question the pipeline asks.
    classified: classifyContentType(row.title, "NEWS"),
  }));

  const baselineModel = baseline.filter((r) => r.classified === "MODEL");
  const untouched = baseline.filter((r) => r.classified === "NEWS");

  console.log(`baseline: ${baselineModel.length} items typed MODEL by the live classifier.`);
  console.log(`baseline: ${untouched.length} items the live classifier left as NEWS.\n`);

  for (const candidate of CANDIDATES) {
    const added = untouched.filter((r) => candidate.adds(r.title));
    console.log("─".repeat(78));
    console.log(`${candidate.name}`);
    console.log(
      `ADDS ${added.length} items to MODEL (baseline ${baselineModel.length} → ${baselineModel.length + added.length}).`,
    );
    console.log(
      `  denominator: ${added.length} newly-typed items, drawn from the ${untouched.length} the live classifier left as NEWS, out of ${rows.length} stored.`,
    );
    console.log(
      `  selection:   none — EVERY newly-typed item is printed. Precision is judged in full, not sampled.`,
    );
    console.log(
      `  Judge every line: a MODEL badge is worth about seventy places of rank, so a wrong one is the expensive error.\n`,
    );
    for (const row of added) console.log(`  [${row.id}] ${row.title}`);
    console.log("");
  }

  // ── The recall population ────────────────────────────────────────────────
  // Sampled from what BOTH the baseline and every candidate leave alone, so
  // the judging is about what is still missed after the change rather than
  // before it.
  const stillUntouched = untouched.filter((r) => !CANDIDATES.some((c) => c.adds(r.title)));
  const step = Math.max(1, Math.floor(stillUntouched.length / RECALL_SAMPLE_SIZE));
  const sample = stillUntouched.filter((_, i) => i % step === 0).slice(0, RECALL_SAMPLE_SIZE);

  console.log("─".repeat(78));
  console.log(`RECALL SAMPLE`);
  console.log(
    `  denominator: ${sample.length} shown, sampled from the ${stillUntouched.length} items that BOTH the live classifier and every candidate leave untyped, out of ${rows.length} stored.`,
  );
  console.log(
    `  selection:   every ${step}th item by DESCENDING id. Statable and repeatable — a re-run draws the same items, so a changed figure is a changed corpus and never the draw.`,
  );
  console.log(
    `  Count how many of these should have been MODEL. That count over ${sample.length} is the miss rate that SURVIVES the change.\n`,
  );
  for (const row of sample) console.log(`  [${row.id}] ${row.title}`);
}

main()
  .catch((error: unknown) => {
    // The CAUSE, not just the wrapper. A driver error's message is "Failed
    // query: select ..." and the reason it failed — a missing column, a
    // missing database — lives one level down. Printing only the wrapper is
    // how a schema problem reads as an unexplained failure, which is the
    // shape that made the September collector outage take three days.
    //
    // Redacted on the way out, per #92/#99: a driver message can carry the
    // host, the port and the user.
    const parts: string[] = [];
    let current: unknown = error;
    for (let depth = 0; current instanceof Error && depth < 5; depth++) {
      parts.push(current.message);
      current = (current as { cause?: unknown }).cause;
    }
    if (parts.length === 0) parts.push(String(error));
    console.error(redactConnectionParts(parts.join("\n  caused by: ")));
    process.exitCode = 1;
  })
  .finally(async () => {
    await getSql()
      .end({ timeout: 5 })
      .catch(() => {});
  });
