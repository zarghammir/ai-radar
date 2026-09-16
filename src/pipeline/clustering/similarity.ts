const STOPWORDS = new Set(
  `a an the and or but of to in on at for with by from as is are was were be been being it its this that these those
   into over under about after before between through during without within via vs versus new says said say will can
   how why what when where who which than then there here also just more most very up out off so not no yes his her
   their our your my we you they he she i me us them one two three first now today announces announced announcement
   introduces introducing introduce launch launches launched launching release releases released releasing unveils
   unveiled update updates official officially report reports reported reportedly`
    .split(/\s+/)
    .filter(Boolean),
);

/** Lower-case content tokens with stopwords removed. Keeps hyphenated model names. */
export function tokenize(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9.+\-\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[.\-]+|[.\-]+$/g, ""))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Crude entity extraction: capitalised words (not sentence-initial-only),
 * tokens with digits (GPT-5, o3, 2.5) and ALLCAPS acronyms.
 */
export function entities(title: string): Set<string> {
  const out = new Set<string>();
  const words = title.replace(/[“”"()[\]:,]/g, " ").split(/\s+/).filter(Boolean);
  words.forEach((w, i) => {
    const clean = w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (!clean) return;
    const lower = clean.toLowerCase();
    if (STOPWORDS.has(lower)) return;
    const hasDigit = /\d/.test(clean);
    const capital = /^[A-Z]/.test(clean) && i > 0;
    const acronym = /^[A-Z][A-Z0-9.\-]{1,}$/.test(clean);
    if (hasDigit || capital || acronym) out.add(lower);
  });
  return out;
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export interface SimilarityResult {
  score: number;
  sharedEntities: number;
  tokenJaccard: number;
}

/**
 * Title similarity in [0,1]. Combines token overlap with shared named
 * entities so "OpenAI launches GPT-6" and "GPT-6 is here: OpenAI's new model"
 * match while "OpenAI hires CFO" does not.
 */
export function titleSimilarity(a: string, b: string): SimilarityResult {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const tokenJaccard = jaccard(ta, tb);
  const ea = entities(a);
  const eb = entities(b);
  let shared = 0;
  for (const e of ea) if (eb.has(e)) shared++;
  const entityBoost = Math.min(shared, 3) * 0.12;
  return { score: Math.min(1, tokenJaccard + entityBoost), sharedEntities: shared, tokenJaccard };
}

/** Default decision rule used by the clusterer. */
export function isSameStory(a: string, b: string): boolean {
  const s = titleSimilarity(a, b);
  if (s.tokenJaccard >= 0.5) return true;
  if (s.sharedEntities >= 2 && s.tokenJaccard >= 0.25) return true;
  if (s.sharedEntities >= 3 && s.tokenJaccard >= 0.15) return true;
  return false;
}
