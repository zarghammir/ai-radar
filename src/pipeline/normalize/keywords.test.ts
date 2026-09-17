import { describe, expect, it } from "vitest";
import { DEFAULT_AI_KEYWORDS } from "@/sources/hackernews/adapter";
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
