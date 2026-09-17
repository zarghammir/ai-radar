import type { ContentType, ContentTypeSource } from "@/db/schema";
import { matchesAnyPhrase } from "./keywords";

/**
 * The content types the classifier is allowed to infer from an item's own text.
 *
 * Deliberately a strict subset of ContentType, and PAPER is not in it. That
 * exclusion is load-bearing rather than tidiness: assignStory groups items by
 * `contentFamily`, which is binary — PAPER against everything else — and it
 * reads the *story's* recomputed type. A classifier able to emit PAPER, or to
 * overrule a PAPER default, would silently change which items cluster
 * together: a clustering change wearing a labelling change's clothes. Keeping
 * every classifiable type inside the general family makes that impossible by
 * construction rather than by care.
 *
 * The test "never crosses a content family" is the guard, and it has a control
 * that adds PAPER here and confirms the test reddens. This comment is not the
 * guard.
 *
 * TREND is absent on purpose: see NOT_CLASSIFIABLE below.
 */
export const CLASSIFIABLE = ["MODEL", "REGULATION", "BUSINESS", "TOOL"] as const;
export type ClassifiedContentType = (typeof CLASSIFIABLE)[number];

/**
 * Types that stay source-declared, with the reason, so the next reader does not
 * re-litigate it from scratch.
 *
 * TREND was attempted against 516 live items and abandoned. Trend pieces share
 * no vocabulary with each other: "The AI data center boom is colliding with
 * cities scarred by big industry" and "The AI graveyard: a running list of
 * projects and startups that didn't make it" are both trend pieces and have no
 * word in common that a non-trend headline lacks. Every candidate rule either
 * matched almost nothing or matched most of the news corpus. A rule that fires
 * on noise is worse than a category nobody emits, because the badge would then
 * be wrong rather than merely absent.
 */
export const NOT_CLASSIFIABLE = ["TREND"] as const;

/**
 * Words removed after measuring them against the live corpus, with the title
 * that convicted each one. Kept as code so the list survives, and so the next
 * person to reach for one of these finds the reason before re-adding it.
 */
export const REJECTED_KEYWORDS: ReadonlyArray<{ word: string; because: string }> = [
  {
    word: "merge",
    because:
      "'Anthropic merges Claude chat and Cowork in one interface' is a product story, not an acquisition",
  },
  {
    word: "stake",
    because: "'What's at stake in AI's trillion-dollar gamble' — the idiom, not an equity stake",
  },
  {
    word: "enterprise",
    because:
      "'Enterprise Java Framework Migration', 'Gemini Enterprise Agent Platform' — a product category, not a deal",
  },
  {
    word: "partner (bare)",
    because:
      "'Co-Scientist: A multi-agent AI partner' — the companion sense; 'partnership' and 'partners with' are kept",
  },
  {
    word: "funding (bare)",
    because:
      "'Funding grants for new research into AI and teen development' is philanthropy; 'funding round' is kept",
  },
  {
    word: "policy (bare)",
    because:
      "'Conformal Policy Learning with Distribution-Free Safety Guarantees' is reinforcement learning, not governance",
  },
  {
    word: "deal",
    because: "no true positive in 516 items and collides with 'a big deal' / 'deal with'",
  },
  {
    word: "contract",
    because: "unproven in the corpus and collides with 'contract window' / 'contrastive'",
  },
  { word: "customers", because: "every vendor blog post mentions customers" },
];

/**
 * Named model families, used only next to a version number.
 *
 * The family name alone is never enough: "Anthropic merges Claude chat and
 * Cowork in one interface" is a product story and "Speaking of Voxtral" is a
 * retrospective. The version token is what separates a launch from a mention.
 *
 * `o1`/`o3` are spelled out rather than added to the alternation as a bare "o",
 * which matched "Google Research at I/O 2026".
 */
const MODEL_FAMILY =
  /\b(?:(?:gpt|gemini|gemma|claude|llama|mixtral|qwen|deepseek|grok|phi|nemotron|falcon|kimi|granite|olmo|smollm|mistral|magistral|devstral|codestral|pixtral|voxtral|sora|veo|imagen|flux|command r|stable diffusion)[-\s]?\d[\d.]*|o[1-9]\b)/i;

/** "a 4B model", "8x7b". Never sufficient alone — "$1B" and "€3B" are money. */
const PARAMETER_COUNT = /\b\d+(?:\.\d+)?b\b|\b\d+x\d+b\b/i;

const LAUNCH_VERBS = [
  "introducing",
  "announcing",
  "announces",
  "unveils",
  "unveiling",
  "releases",
  "releasing",
  "launches",
  "launching",
  "now available",
  "generally available",
  "available now",
];

/**
 * MEASURED AND REJECTED: a generic "capitalised name + version number" rule,
 * meant to free MODEL recall from the hand-maintained family list above.
 *
 * Against the 516-item corpus it found 15 more items and got 8 of them wrong,
 * taking MODEL precision from 90% to 71%. The shape is simply too common:
 * dates ("State of Open Models: Summer 2026"), newsletter numbering ("Import
 * AI 454"), software versions ("Apple releases iOS 27", "Datasette 1.0a39")
 * and incidental figures ("Training Text-to-Image Models 3.6x Faster") all
 * wear it. Constraining it to the start of the title or to the position after
 * a launch verb removed the dates and kept the rest.
 *
 * The cost of keeping the family list is that a new lab's first model is
 * unclassified until someone adds the name. That is the cheaper mistake, and
 * the ranking says by how much: MODEL carries the joint-heaviest weight, and
 * reconstructing the corpus ranking without the classifier put one retyped
 * story at rank 104 where it now sits at rank 14. A single badge is worth
 * about ninety places.
 *
 * So precision here is worth roughly an order of magnitude more than recall.
 * A missed model launch is one story lower down a list; a false MODEL is a
 * newsletter in the reader's top ten. Weigh any change to these rules that
 * way, and measure it against stored titles before believing it.
 *
 * What would actually raise recall is a maintained model-name list or a
 * summariser that reads the item, not a cleverer regex. That was tried.
 */

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

const REGULATION_WORDS = [
  "regulation",
  "regulator",
  "regulatory",
  "regulate",
  "regulating",
  "legislation",
  "lawmaker",
  "ai act",
  "ai policy",
  "tech policy",
  "public policy",
  "policy plan",
  "policy window",
  "policymaker",
  "antitrust",
  "lawsuit",
  "sues",
  "sued",
  "suing",
  "court",
  "judge",
  "ruling",
  "subpoena",
  "copyright",
  "ftc",
  "doj",
  "congress",
  "senate",
  "parliament",
  "white house",
  "executive order",
  "ban",
  "banned",
  "banning",
  "export controls",
  "sanctions",
  "moratorium",
  "injunction",
];

const BUSINESS_WORDS = [
  "funding round",
  "raises",
  "raised",
  "raising",
  "valuation",
  "valued at",
  "series a",
  "series b",
  "series c",
  "seed round",
  "ipo",
  "acquires",
  "acquired",
  "acquisition",
  "acquire",
  "buyout",
  "takeover",
  "investors",
  "investment",
  "invests",
  "layoffs",
  "job cuts",
  "revenue",
  "profits",
  "earnings",
  "bankrupt",
  "partnership",
  "partners with",
];

const TOOL_WORDS = [
  "sdk",
  "cli",
  "api",
  "plugin",
  "extension",
  "ide",
  "library",
  "framework",
  "toolkit",
  "integration",
  "connector",
  "dashboard",
];

/**
 * Rules in priority order: the first that matches wins.
 *
 * MODEL leads because its signal is the most specific — a named family beside a
 * version number. BUSINESS sits below REGULATION because a lawsuit over an
 * acquisition is a regulation story. TOOL is last because its vocabulary is the
 * broadest, and it additionally demands a launch verb so that any post merely
 * mentioning an API is not a tool announcement.
 */
const RULES: ReadonlyArray<{ type: ClassifiedContentType; test: (text: string) => boolean }> = [
  {
    type: "MODEL",
    test: (t) => {
      const family = MODEL_FAMILY.exec(t);
      const launched = matchesAnyPhrase(t, LAUNCH_VERBS);
      const noun = matchesAnyPhrase(t, MODEL_NOUNS);
      // A family name with no launch verb has to lead the headline. Otherwise
      // every customer story naming a model becomes a model launch:
      // "Legora reviewed 41 documents in minutes with GPT-6 Astra".
      if (family && (launched || family.index === 0)) return true;
      // A parameter count is only a model when something nearby says so; on its
      // own it is money — "$1B to protect essential services".
      if (PARAMETER_COUNT.test(t) && noun) return true;
      return launched && noun;
    },
  },
  { type: "REGULATION", test: (t) => matchesAnyPhrase(t, REGULATION_WORDS) },
  { type: "BUSINESS", test: (t) => matchesAnyPhrase(t, BUSINESS_WORDS) },
  {
    type: "TOOL",
    test: (t) => matchesAnyPhrase(t, LAUNCH_VERBS) && matchesAnyPhrase(t, TOOL_WORDS),
  },
];

/**
 * Papers cluster only with papers unless the canonical URL already tied them.
 *
 * Lives here rather than in run.ts because it is a fact about content types,
 * and because the classifier's central invariant is stated in terms of it: one
 * module owns both the boundary and the rule that must not cross it.
 */
export function contentFamily(type: ContentType): "paper" | "general" {
  return type === "PAPER" ? "paper" : "general";
}

/**
 * Types a source states as fact about the item rather than as a default, which
 * the text may not overrule: arXiv sets PAPER from the feed itself, and Hacker
 * News sets DISCUSSION for a text post with no link.
 *
 * PAPER's presence here is also half of the content-family invariant.
 */
function isDeclaredFact(declared: ContentType): boolean {
  return declared === "PAPER" || declared === "DISCUSSION";
}

/**
 * Titles that state their own kind, where the rules below do not apply.
 *
 * "Show HN:" is Hacker News's convention for *I built this and here it is*. It
 * is a claim the item makes about itself, in its own text, which is exactly
 * what this module reads — so honouring it is not source coupling. The
 * classifier never learns where a title came from.
 *
 * ANCHORED, deliberately. A headline that merely mentions Show HN is an
 * article about Show HN and is classified normally; only a title that opens
 * with the announcement is one.
 *
 * SIX BRANCHES can type a title, and a Show HN launch reaches five of them
 * without the prefix mattering at all. Each was considered separately and each
 * is rejected for the same reason, so the reason is written once:
 *
 *   MODEL 1  family && (launched || family.index === 0)
 *            the prefix pushes any family name off index 0, but a launch verb
 *            anywhere in the title still opens it
 *   MODEL 2  PARAMETER_COUNT && noun          prefix-independent
 *            "Show HN: I fine-tuned a 7B model for SQL generation"
 *   MODEL 3  launched && noun                 prefix-independent
 *   TOOL     launched && TOOL_WORDS           prefix-independent
 *            "Show HN: Launching an open-source SDK"
 *   REGULATION / BUSINESS  single phrase      prefix-independent
 *            "Show HN: an EU AI Act compliance checker"
 *
 * The reason: every vocabulary in this file was measured against news
 * headlines, where "a 7B model" reports a release and "AI Act" reports a
 * regulation. On a launch list the same words describe what a person BUILT —
 * a model they fine-tuned, a compliance checker they wrote — and the rules
 * read the subject matter as the kind. The item has already said what it is.
 *
 * NOT by adding "Show HN:" to LAUNCH_VERBS, which the ticket first proposed:
 * that leaves MODEL 2 untouched and actively OPENS MODEL 1, MODEL 3 and TOOL
 * to every title on the list. It makes the promotion worse, and promotion is
 * the dangerous direction — a false MODEL is worth about ninety rank places.
 */
const SELF_ANNOUNCED_LAUNCH = /^\s*show hn\s*:/i;

/** Exported for the test that proves the guard is anchored. */
export function announcesItsOwnLaunch(title: string): boolean {
  return SELF_ANNOUNCED_LAUNCH.test(title);
}

/**
 * Infer a content type from an item's title, falling back to what the source
 * declared. Pure, and never crosses a content family.
 *
 * Title only, not title plus excerpt: several feeds carry a whole article body
 * as the excerpt, and at 600 characters of prose almost every rule here fires
 * on something. The title is the claim the item makes about itself.
 */
export function classifyContentType(title: string, declared: ContentType): ContentType {
  if (isDeclaredFact(declared)) return declared;
  // A title that announces itself as a launch is one. Returning `declared`
  // rather than a literal keeps the provenance honest: the value came from the
  // source default, so decideContentType records it as `default` and the
  // backfill stays free to revisit it when these rules improve.
  if (announcesItsOwnLaunch(title)) return declared;
  for (const rule of RULES) if (rule.test(title)) return rule.type;
  return declared;
}

export interface ContentTypeDecision {
  type: ContentType;
  /** Recorded on the row so the backfill never has to infer it back. */
  source: ContentTypeSource;
}

/**
 * The whole precedence rule in one place: what the adapter declared, then what
 * the title says, then the source default.
 *
 * It returns the provenance alongside the type because the one-off backfill
 * needs to know which stored types it may overwrite, and inferring that later
 * from `stored !== sourceDefault` is wrong the moment this classifier starts
 * moving types — the comparison then reports the classifier's own previous
 * output as an adapter's declaration, and a re-run cannot re-apply a changed
 * rule to anything it has already moved.
 */
export function decideContentType(
  declaredByAdapter: ContentType | undefined,
  title: string,
  sourceDefault: ContentType,
): ContentTypeDecision {
  if (declaredByAdapter) return { type: declaredByAdapter, source: "adapter" };
  const classified = classifyContentType(title, sourceDefault);
  return classified === sourceDefault
    ? { type: sourceDefault, source: "default" }
    : { type: classified, source: "classifier" };
}
