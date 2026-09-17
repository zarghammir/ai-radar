/**
 * What does a change to the keyword matcher do at the Hacker News gate?
 *
 * Hacker News is the ONLY consumer that rejects an item on a keyword miss
 * (`src/sources/hackernews/adapter.ts` — no RSS source filters this way, and
 * `pipeline/run.ts` only labels). So this population is the whole of the loss
 * a matcher change can cause, not a sample of it.
 *
 * Written for #73 and kept for #97, which is the same measurement over the
 * other branch of the same function. Rebuilding it there would mean fetching
 * one corpus twice to answer two questions about it.
 *
 * ── Configuring it for a different change ────────────────────────────────
 * Set BASELINE and CANDIDATE, and give SELF_CHECKS a case where they must
 * DIFFER and one where they must AGREE. Nothing else changes.
 *
 * NOTE FOR #97, because the arrangement is mirrored rather than identical:
 * here the baseline is the retired pre-#73 implementation, embedded, and the
 * candidate is the live one, imported. For #97 the baseline is the LIVE
 * implementation and the candidate is the proposed one, so the embedded copy
 * moves to the other slot. Same shape, opposite sides.
 *
 *   npx tsx scripts/measure-keyword-gate.ts
 */
import { matchesAnyKeyword } from "../src/pipeline/normalize/keywords";
import { DEFAULT_AI_KEYWORDS } from "../src/sources/hackernews/adapter";

type Matcher = (title: string) => boolean;

/**
 * The pre-#73 implementation, copied verbatim from the commit before the fix.
 *
 * A COPY LIKE THIS IS AN UNTESTED CLAIM SITTING IN THE MIDDLE OF THE
 * INSTRUMENT: mistype it and the diff below looks exactly like a real finding.
 * SELF_CHECKS is what stops that, and it runs before anything is printed.
 */
function preHyphenFixKeyword(text: string, keyword: string): boolean {
  const kw = keyword.toLowerCase().trim();
  if (!kw) return false;
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9.+\- ]/g, " ")} `;
  return kw.length <= 4
    ? haystack.includes(` ${kw} `) || haystack.includes(` ${kw}s `)
    : haystack.includes(kw);
}

const BASELINE: Matcher = (t) => DEFAULT_AI_KEYWORDS.some((k) => preHyphenFixKeyword(t, k));
const CANDIDATE: Matcher = (t) => matchesAnyKeyword(t, DEFAULT_AI_KEYWORDS);

/** Must differ on the first, agree on the second, or the instrument is broken. */
const SELF_CHECKS = {
  mustDiffer: "An AI-powered CLI for your terminal",
  mustAgree: "A new AI model from a lab",
};

/** The adapter's own non-keyword filters, so the population is what it sees. */
const LISTS = [
  { list: "top", minPoints: 20 },
  { list: "show", minPoints: 3 },
];

interface Item {
  title: string;
  score: number;
  list: string;
}

async function fetchList(list: string, minPoints: number): Promise<Item[]> {
  const get = (u: string) => fetch(u).then((r) => r.json());
  const ids = (await get(`https://hacker-news.firebaseio.com/v0/${list}stories.json`)) as number[];
  const raw = await Promise.all(
    ids
      .slice(0, 120)
      .map((id) => get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)),
  );
  return (raw as (Record<string, unknown> | null)[])
    .filter(
      (i): i is Record<string, unknown> =>
        !!i && !i.deleted && !i.dead && i.type === "story" && typeof i.title === "string",
    )
    .map((i) => ({ title: i.title as string, score: Number(i.score ?? 0), list }))
    .filter((i) => i.score >= minPoints);
}

async function main(): Promise<void> {
  if (BASELINE(SELF_CHECKS.mustDiffer) === CANDIDATE(SELF_CHECKS.mustDiffer)) {
    throw new Error(`instrument invalid: the two matchers agree on "${SELF_CHECKS.mustDiffer}"`);
  }
  if (!BASELINE(SELF_CHECKS.mustAgree) || !CANDIDATE(SELF_CHECKS.mustAgree)) {
    throw new Error(`instrument invalid: the two matchers differ on "${SELF_CHECKS.mustAgree}"`);
  }

  const items = (await Promise.all(LISTS.map((l) => fetchList(l.list, l.minPoints)))).flat();
  if (items.length === 0) throw new Error("no items reached the gate; refusing to report");

  const recovered = items.filter((i) => !BASELINE(i.title) && CANDIDATE(i.title));
  const lost = items.filter((i) => BASELINE(i.title) && !CANDIDATE(i.title));
  const keptBefore = items.filter((i) => BASELINE(i.title)).length;

  console.log(`items reaching the gate: ${items.length}`);
  console.log(`  kept by the baseline:  ${keptBefore}`);
  console.log(`  kept by the candidate: ${items.filter((i) => CANDIDATE(i.title)).length}`);
  console.log(`\nRECOVERED — rejected before, kept now: ${recovered.length}`);
  for (const i of recovered) console.log(`  [${i.list} ${i.score}] ${i.title.slice(0, 72)}`);
  console.log(`\nLOST — kept before, rejected now: ${lost.length}   (must be 0)`);
  for (const i of lost) console.log(`  [${i.list} ${i.score}] ${i.title.slice(0, 72)}`);
  if (lost.length === 0 && keptBefore > 0) {
    // Zero events in N trials: the rule of three bounds the true rate.
    console.log(
      `  0 of ${items.length} — 95% upper bound on the loss rate ≈ ${(300 / items.length).toFixed(1)}%`,
    );
  }
  if (lost.length > 0) {
    console.error("\nTHE CANDIDATE LOSES ITEMS. Do not ship on this result.");
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
