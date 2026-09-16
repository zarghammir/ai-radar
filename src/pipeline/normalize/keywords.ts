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
