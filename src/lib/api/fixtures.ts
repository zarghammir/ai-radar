/**
 * Fixtures for the Today page, standing in for /api/brief until the routes on
 * feat/api-routes merge.
 *
 * The content is REAL: genuine AI stories from 9-16 September 2026, with real
 * outlets and working URLs. No lorem.
 *
 * The awkward cases are here from the start, because a Today page that has only
 * ever been seen with a full healthy brief is a page nobody has seen:
 *   - a story whose only source is ONE OUTLET THAT FILED TWICE (sourceCount 1,
 *     so "also reported by" must render nothing, not "+0 others");
 *   - an ANALYST-ONLY story, where no outlet in the list is a newsroom;
 *   - an UNVERIFIED story, labelled and ranked low but NOT dropped — the owner
 *     ruled directly that a leak can be the most important thing that happened;
 *   - every story with `summary: null`, which is Phase 1 reality, so the
 *     excerpt fallback is exercised rather than assumed;
 *   - `whyItMatters: null` everywhere, likewise;
 *   - a QUIET DAY and an EMPTY DAY as whole scenarios.
 */
import type { BriefResponse, SourceRef, StoryCard } from "@/lib/api/types";

const openai: SourceRef = {
  key: "openai-blog",
  name: "OpenAI",
  tier: "PRIMARY",
  homepage: "https://openai.com/news",
};
const anthropic: SourceRef = {
  key: "anthropic-news",
  name: "Anthropic",
  tier: "PRIMARY",
  homepage: "https://www.anthropic.com/news",
};
const apple: SourceRef = {
  key: "apple-newsroom",
  name: "Apple Newsroom",
  tier: "PRIMARY",
  homepage: "https://www.apple.com/newsroom/",
};
const bloomberg: SourceRef = {
  key: "bloomberg",
  name: "Bloomberg",
  tier: "HIGH_QUALITY_REPORTING",
  homepage: "https://www.bloomberg.com",
};
const fortune: SourceRef = {
  key: "fortune",
  name: "Fortune",
  tier: "HIGH_QUALITY_REPORTING",
  homepage: "https://fortune.com",
};
const forbes: SourceRef = {
  key: "forbes",
  name: "Forbes",
  tier: "HIGH_QUALITY_REPORTING",
  homepage: "https://www.forbes.com",
};
const npr: SourceRef = {
  key: "npr",
  name: "NPR",
  tier: "HIGH_QUALITY_REPORTING",
  homepage: "https://www.npr.org",
};
const simonWillison: SourceRef = {
  key: "simon-willison",
  name: "Simon Willison",
  tier: "ANALYST",
  homepage: "https://simonwillison.net",
};
const importAi: SourceRef = {
  key: "import-ai",
  name: "Import AI",
  tier: "ANALYST",
  homepage: "https://importai.substack.com",
};
const hackernews: SourceRef = {
  key: "hackernews",
  name: "Hacker News",
  tier: "COMMUNITY",
  homepage: "https://news.ycombinator.com",
};
const huggingface: SourceRef = {
  key: "huggingface-papers",
  name: "Hugging Face",
  tier: "DISCOVERY",
  homepage: "https://huggingface.co/papers",
};

type Seed = Omit<StoryCard, "summary" | "whyItMatters" | "saved" | "read"> &
  Partial<Pick<StoryCard, "summary" | "whyItMatters" | "saved" | "read">>;

/** Phase 1 reality applied once, so no fixture can quietly pretend otherwise. */
function story(seed: Seed): StoryCard {
  return {
    summary: null,
    whyItMatters: null,
    saved: false,
    read: false,
    ...seed,
  };
}

export const FIXTURE_STORIES: StoryCard[] = [
  story({
    id: 412,
    slug: "openai-opens-codex-agent-harness-api",
    title: "OpenAI opens the Codex agent harness as a public-beta API",
    excerpt:
      "The managed harness that runs Codex is now available to every developer, with durable sessions that carry agent work across turns and support for your own tools and MCP servers.",
    url: "https://openai.com/index/introducing-the-agents-api/",
    contentType: "RELEASE",
    verification: "PRIMARY_SOURCE",
    verificationNote: "Published directly by OpenAI and picked up by 2 other sources.",
    sourceCount: 3,
    sources: [openai, forbes, fortune],
    primarySource: openai,
    topics: [
      { key: "agents", name: "Agents", group: "field" },
      { key: "openai", name: "OpenAI", group: "company" },
    ],
    publishedAt: "2026-09-16T14:20:00.000Z",
    firstSeenAt: "2026-09-16T14:31:00.000Z",
    lastActivityAt: "2026-09-16T17:02:00.000Z",
    readingMinutes: 1,
    score: 58.2,
  }),
  story({
    id: 418,
    slug: "anthropic-ci-strain-test-impact-analysis",
    title: "Anthropic reports a 25x CI jump as Claude authors most of its code",
    excerpt:
      "Engineers ship roughly eight times more code per quarter than in 2021-25, test count grew tenfold, and test selection had to be rebuilt to scale horizontally.",
    url: "https://claude.com/blog/agentic-coding-is-straining-ci-heres-how-we-scaled-test-impact-analysis-at-anthropic",
    contentType: "DISCUSSION",
    verification: "PRIMARY_SOURCE",
    verificationNote: "Published by Anthropic with its own figures.",
    // THE AWKWARD ONE: Anthropic filed twice (the post and its changelog entry).
    // `sources` is de-duplicated, so this is ONE source and the card must show
    // no "also reported by" line at all.
    sourceCount: 1,
    sources: [anthropic],
    primarySource: anthropic,
    topics: [
      { key: "agents", name: "Agents", group: "field" },
      { key: "developer-tools", name: "Developer tools", group: "domain" },
    ],
    publishedAt: "2026-09-16T08:20:00.000Z",
    firstSeenAt: "2026-09-16T08:34:00.000Z",
    lastActivityAt: "2026-09-16T09:10:00.000Z",
    readingMinutes: 1,
    score: 51.4,
  }),
  story({
    id: 421,
    slug: "apple-ships-rebuilt-siri-beta",
    title: "Apple ships rebuilt Siri in beta, built on Gemini-based foundation models",
    excerpt:
      "Siri AI arrived in beta alongside iOS 27, running on-device and on Private Cloud Compute, with Apple Foundation Models built together with Google under a multi-year deal.",
    url: "https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/",
    contentType: "RELEASE",
    // A PRIMARY source outranks any amount of pickup: deriveVerification
    // returns PRIMARY_SOURCE the moment the originator published it.
    verification: "PRIMARY_SOURCE",
    verificationNote: "Published directly by Apple Newsroom and picked up by 3 other sources.",
    sourceCount: 4,
    sources: [apple, forbes, fortune, npr],
    primarySource: apple,
    topics: [
      { key: "assistants", name: "Assistants", group: "field" },
      { key: "apple", name: "Apple", group: "company" },
    ],
    publishedAt: "2026-09-14T17:05:00.000Z",
    firstSeenAt: "2026-09-14T17:18:00.000Z",
    lastActivityAt: "2026-09-16T11:40:00.000Z",
    readingMinutes: 1,
    score: 44.9,
  }),
  story({
    id: 430,
    slug: "atria-dawn-technical-report",
    title: "Atria Dawn report pairs a 744B agentic model with a 769-task human study",
    excerpt:
      "Shanghai AI Laboratory posted the technical report to arXiv: a 744B mixture-of-experts base, 256K context, MIT-licensed checkpoints, and 769 task records from 56 users.",
    url: "https://arxiv.org/abs/2609.15818",
    contentType: "PAPER",
    verification: "EMERGING",
    verificationNote: "One discovery feed so far; no newsroom has picked it up.",
    // THE ANALYST-ONLY ONE: nothing here is a newsroom. Two analysts agreeing is
    // weaker than two newsrooms agreeing, which is why this sits at EMERGING.
    sourceCount: 3,
    sources: [huggingface, simonWillison, importAi],
    primarySource: huggingface,
    topics: [
      { key: "open-weights", name: "Open weights", group: "field" },
      { key: "evaluation", name: "Evaluation", group: "field" },
    ],
    publishedAt: "2026-09-15T04:10:00.000Z",
    firstSeenAt: "2026-09-15T05:02:00.000Z",
    lastActivityAt: "2026-09-16T07:55:00.000Z",
    readingMinutes: 1,
    score: 33.1,
  }),
  story({
    id: 444,
    slug: "openai-weighs-funding-at-trillion-plus",
    title: "OpenAI weighs funding at a $1.2T–$1.5T valuation",
    excerpt:
      "Reports say OpenAI is considering a new private round. Outlets disagree by $300 billion on the figure and the sourcing is anonymous throughout.",
    url: "https://www.bloomberg.com/news/articles/2026-09-15/openai-weighing-funding-round-at-over-1-2-trillion-valuation",
    // NEWS, not BUSINESS: content type comes from the SOURCE's default and no
    // seeded source emits BUSINESS, so a fixture asserting it would be a state
    // the product cannot currently reach.
    contentType: "NEWS",
    // ALLOWED ON TODAY, labelled, ranked low, NOT dropped. The owner ruled this
    // directly: a leak can be the most important thing that happened, and the
    // chip is what makes it safe to show.
    //
    // It reaches UNVERIFIED the only way anything does: ONE source that is
    // neither a newsroom nor an analyst. An earlier version listed four
    // newsrooms, which deriveVerification grades CORROBORATED — the story
    // demonstrating the owner's ruling was a state the product cannot produce.
    verification: "UNVERIFIED",
    verificationNote: "Single community source: Hacker News.",
    sourceCount: 1,
    sources: [hackernews],
    primarySource: hackernews,
    topics: [
      { key: "funding", name: "Funding", group: "domain" },
      { key: "openai", name: "OpenAI", group: "company" },
    ],
    publishedAt: "2026-09-16T07:25:00.000Z",
    firstSeenAt: "2026-09-16T07:41:00.000Z",
    lastActivityAt: "2026-09-16T10:12:00.000Z",
    readingMinutes: 1,
    score: 21.7,
  }),
  story({
    id: 451,
    slug: "china-rejects-amodei-chip-argument",
    title: "China's Foreign Ministry rejects Amodei's call to curb its AI",
    excerpt:
      "Spokesperson Guo Jiakun called the chip-restriction argument fearmongering, days before US-China talks in Washington.",
    url: "https://www.npr.org/2026/09/14/nx-s1-5968456/china-hits-back-ai-development",
    // NEWS for the same reason: nothing can emit REGULATION today. Its badge
    // ("Policy") is covered by the label test rather than by a fixture
    // pretending the pipeline can produce it.
    contentType: "NEWS",
    verification: "CORROBORATED",
    verificationNote: "Reported independently by several outlets; no primary transcript published.",
    sourceCount: 3,
    sources: [npr, fortune, forbes],
    primarySource: npr,
    topics: [
      { key: "policy", name: "Policy", group: "domain" },
      { key: "chips", name: "Chips", group: "domain" },
    ],
    publishedAt: "2026-09-14T12:40:00.000Z",
    firstSeenAt: "2026-09-14T13:05:00.000Z",
    lastActivityAt: "2026-09-15T16:20:00.000Z",
    readingMinutes: 1,
    score: 28.4,
    read: true,
  }),
];

const WINDOW = {
  from: "2026-09-16T07:30:00.000Z",
  to: "2026-09-16T18:00:00.000Z",
  briefTime: "07:30",
  timezone: "America/Toronto",
};

function brief(stories: StoryCard[], length: BriefResponse["length"]): BriefResponse {
  return {
    window: WINDOW,
    length,
    count: stories.length,
    readingMinutes: stories.reduce((total, s) => total + s.readingMinutes, 0),
    stories,
  };
}

/**
 * `length` is a READING-MINUTE BUDGET, not a story count: take the highest
 * ranked until the next story would exceed it, and always return at least one
 * if the window has any. Mirrors the rule in docs/api.md so the switch behaves
 * here the way it will behave against the real route.
 */
/**
 * The contract's selection rule, exported so it can be tested against story
 * sets the fixtures do not contain.
 *
 * Highest ranked first, taking each story while it fits, and ALWAYS at least
 * one even if that story alone exceeds the budget — docs/api.md, the paragraph
 * on `length`. Because every later story that would exceed the budget is
 * skipped, ONLY THE FIRST can push past it: an over-budget selection therefore
 * always holds exactly one story, which is what lets the header say "the top
 * story alone" as a fact.
 */
export function selectWithinBudget(stories: StoryCard[], budget: number): StoryCard[] {
  const ranked = [...stories].sort((a, b) => b.score - a.score);
  const chosen: StoryCard[] = [];
  let spent = 0;
  for (const s of ranked) {
    if (chosen.length > 0 && spent + s.readingMinutes > budget) continue;
    chosen.push(s);
    spent += s.readingMinutes;
  }
  return chosen;
}

export function fixtureBrief(length: BriefResponse["length"] = "10"): BriefResponse {
  if (length === "all") {
    return brief(
      [...FIXTURE_STORIES].sort((a, b) => b.score - a.score),
      "all",
    );
  }
  return brief(selectWithinBudget(FIXTURE_STORIES, Number(length)), length);
}

/** A quiet day: the brief is real but thin. */
export function fixtureQuietBrief(): BriefResponse {
  return brief([FIXTURE_STORIES[1]], "all");
}

/** Nothing ingested yet, or nothing in the window. */
export function fixtureEmptyBrief(): BriefResponse {
  return brief([], "all");
}
