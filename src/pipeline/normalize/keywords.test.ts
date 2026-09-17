import { describe, expect, it } from "vitest";
import { DEFAULT_AI_KEYWORDS } from "@/sources/hackernews/adapter";
import { TOPIC_SEEDS } from "@/db/seed-data";
import { matchesKeyword, matchesPhrase } from "./keywords";

/**
 * This file exists because the two matchers in keywords.ts LOOK like one
 * function that was copied, and they are not. They have three callers between
 * them with three incompatible requirements:
 *
 *   topic tagging          needs substrings — "machine learning" must match
 *                          inside a sentence
 *   content classification needs boundaries — "stake" must not match inside
 *                          "Mistake", "valuation" not inside "evaluations"
 *   the Hacker News AI gate needs the punctuation kept — "a.i." is a keyword
 *
 * Nothing in the first two requirements explains the third, which is how a
 * reviewer's correct observation ("keeping '.', '+' and '-' can only cost
 * recall") is correct for one matcher and silently destructive for the other.
 * Applied to matchesKeyword it would make "a.i." unmatchable forever, and no
 * existing test would have failed.
 *
 * So these tests pin the divergence in BOTH directions. Unifying the two
 * functions, in either direction, reddens this file.
 */
describe("the two keyword matchers diverge on purpose", () => {
  it("matchesKeyword keeps punctuation, so a dotted keyword still matches", () => {
    expect(matchesKeyword("Show HN: an A.I. assistant for triage", "a.i.")).toBe(true);
  });

  it("matchesPhrase strips it, which is why it is a separate function", () => {
    // Not a bug being documented: the classifier has no dotted vocabulary, and
    // stripping is what lets it find "regulation" inside "AI-regulation".
    expect(matchesPhrase("Show HN: an A.I. assistant for triage", "a.i.")).toBe(false);
    expect(matchesPhrase("Brussels revives its AI-regulation push", "regulation")).toBe(true);
  });

  it("matchesKeyword matches inside a word, which topic tagging depends on", () => {
    expect(matchesKeyword("Why this is a Mistake", "stake")).toBe(true);
    expect(matchesKeyword("a post about machine learning today", "machine learning")).toBe(true);
  });

  it("matchesPhrase does not, which content classification depends on", () => {
    expect(matchesPhrase("Why this is a Mistake", "stake")).toBe(false);
    expect(matchesPhrase("double-blind AI evaluations", "valuation")).toBe(false);
    expect(matchesPhrase("a post about machine learning today", "machine learning")).toBe(true);
  });
});

describe("the AI vocabulary and the matcher that reads it", () => {
  /**
   * The property that would have caught the near-miss: every keyword in the
   * gate's vocabulary must be findable by the gate's matcher. It stays
   * meaningful as the list changes, and it is not vacuous — removing the dots
   * from matchesKeyword fails it on "a.i." alone.
   */
  it("finds every keyword in a title that contains it", () => {
    expect(DEFAULT_AI_KEYWORDS.length).toBeGreaterThanOrEqual(10);
    const unmatched = DEFAULT_AI_KEYWORDS.filter(
      (kw) => !matchesKeyword(`Show HN: a ${kw} project I built`, kw),
    );
    expect(unmatched).toEqual([]);
  });

  it("carries at least one keyword that punctuation-stripping would destroy", () => {
    // A floor on the test above: if the only punctuated keyword is ever
    // removed, this says so rather than letting the guard quietly weaken.
    const punctuated = DEFAULT_AI_KEYWORDS.filter((kw) => /[.+\-]/.test(kw));
    expect(punctuated.length).toBeGreaterThanOrEqual(1);
    for (const kw of punctuated) expect(matchesPhrase(`a ${kw} project`, kw)).toBe(false);
  });
});

describe("a hyphen is a word boundary for short tokens", () => {
  /**
   * #73. The haystack kept hyphens as ordinary characters, so the whole-word
   * branch could not see "ai" inside "AI-powered". Hacker News is the only
   * consumer that GATES on this matcher — adapter.ts rejects an item outright
   * when nothing matches — so these titles were not merely mislabelled, they
   * never reached a reader at all.
   */
  const nowMatch: Array<[string, string]> = [
    ["Show HN: An AI-powered CLI for your terminal", "ai"],
    ["GPT-5 is available today", "gpt"],
    ["An LLM-based agent that files your email", "llm"],
    ["Show HN: AI-assisted code review", "ai"],
  ];

  for (const [title, kw] of nowMatch) {
    it(`finds "${kw}" in "${title.slice(0, 34)}…"`, () => {
      expect(matchesKeyword(title, kw)).toBe(true);
    });
  }

  it("still refuses a short token inside a word", () => {
    // The reason the whole-word branch exists. Splitting on hyphens must not
    // become splitting on nothing.
    expect(matchesKeyword("Blockchain, said the detail", "ai")).toBe(false);
    // And a hyphen that does not create the word either: "Thai-food" becomes
    // "thai food", where "ai" is still inside a word rather than beside one.
    expect(matchesKeyword("Thai-food delivery, automated", "ai")).toBe(false);
  });
});

describe("the negative half: nothing that matched before may stop matching", () => {
  /**
   * The half that breaks if a fix reaches for the obvious repair. Stripping
   * punctuation outright would have destroyed "a.i.", "text-to-video" and
   * "text-to-image" — and the last two are exactly the material the product is
   * being pointed at.
   *
   * Data-driven rather than a handful of examples, because a spot check cannot
   * notice the keyword nobody thought of. 220 keywords across both
   * vocabularies, each required to be findable in a title containing it.
   */
  const ALL: Array<[string, string]> = [
    ...DEFAULT_AI_KEYWORDS.map((k) => ["the AI gate", k] as [string, string]),
    ...TOPIC_SEEDS.flatMap((t) => t.keywords.map((k) => ["topic tagging", k] as [string, string])),
  ];

  it("keeps every keyword in both vocabularies matchable", () => {
    expect(ALL.length).toBeGreaterThanOrEqual(200);
    const lost = ALL.filter(([, kw]) => !matchesKeyword(`Show HN: a ${kw} project I built`, kw));
    expect(lost).toEqual([]);
  });

  it("keeps the punctuated keywords specifically, which are the ones at risk", () => {
    // Named as well as swept: these three are why the fix is scoped to the
    // short branch, and a future simplification will meet them here.
    expect(matchesKeyword("Show HN: an A.I. assistant for triage", "a.i.")).toBe(true);
    expect(matchesKeyword("A new text-to-video model", "text-to-video")).toBe(true);
    expect(matchesKeyword("Fast text-to-image on a laptop", "text-to-image")).toBe(true);
    expect(matchesKeyword("Released under Apache 2.0 today", "apache 2.0")).toBe(true);
    expect(matchesKeyword("GPT-5 benchmarks", "gpt-5")).toBe(true);
  });
});
