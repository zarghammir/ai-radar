/**
 * Keyword matching, defined once.
 *
 * Two consumers need it: the Hacker News adapter deciding whether a front-page
 * story is about AI at all, and topic tagging deciding which topics a story
 * belongs to. A second copy would drift, and a story would be let in by one
 * rule and tagged by another.
 */

/**
 * Short tokens must match as whole words. "ai" as a substring hits "chain",
 * "said" and "detail"; "rag" hits "storage". Longer phrases are safe as
 * substrings, which is what lets "machine learning" match inside a sentence.
 */
export function matchesKeyword(text: string, keyword: string): boolean {
  const kw = keyword.toLowerCase().trim();
  if (!kw) return false;
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9.+\- ]/g, " ")} `;
  return kw.length <= 4
    ? haystack.includes(` ${kw} `) || haystack.includes(` ${kw}s `)
    : haystack.includes(kw);
}

export function matchesAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((k) => matchesKeyword(text, k));
}

/**
 * Whole-word / whole-phrase matching: the boundary rule `matchesKeyword`
 * already applies to short tokens, applied at every length.
 *
 * Content-type classification needs it where topic tagging does not. Its
 * vocabulary collides with ordinary AI prose as substrings, and every one of
 * these was measured against the live corpus rather than imagined:
 * "valuation" inside "evaluations", "stake" inside "Mistake", "court" inside
 * "courtesy". Topic tagging keeps the substring behaviour deliberately,
 * because "machine learning" has to match inside a sentence.
 */
export function matchesPhrase(text: string, phrase: string): boolean {
  const kw = phrase.toLowerCase().trim();
  if (!kw) return false;
  // Every character that is not a letter or a digit becomes a space, full
  // stops and hyphens included. Keeping them could only ever cost a match,
  // because none of the classifier vocabularies contain one: "regulation"
  // would not be found inside "AI-regulation", and a phrase at the end of a
  // title that ends in a full stop would never match at all. Several real feed
  // titles end in one.
  const haystack = ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")} `;
  return haystack.includes(` ${kw} `) || haystack.includes(` ${kw}s `);
}

export function matchesAnyPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((p) => matchesPhrase(text, p));
}
