import type { ContentType, SourceKind, SourceTier } from "./schema";

/**
 * The shipped catalogue of sources and topics.
 *
 * Kept separate from seed.ts so that `sources:check` can verify exactly what
 * `db:seed` will write without needing a database. A check that reads a
 * different list from the seed would not be a check.
 *
 * Every feed here was fetched and parsed successfully while it was added; see
 * the pull request for the recorded run. Nothing needs a key or a paid plan.
 */
export interface SourceSeed {
  key: string;
  name: string;
  kind: SourceKind;
  tier: SourceTier;
  /** Feed URL for rss sources; null for API-backed adapters. */
  url: string | null;
  homepage: string;
  defaultContentType: ContentType;
  /**
   * Adapter options, plus `topicKeys`: topics every story from this source
   * belongs to regardless of its headline. Only a source that speaks for one
   * organisation gets these — an outlet reports on everyone, so a default
   * there would tag every story it files with whoever the outlet is about.
   *
   * This exists because tagging reads the primary item's text only, so a
   * first-party post titled "Introducing our new model" matches no keyword and
   * would carry no company topic at all.
   */
  config?: Record<string, unknown>;
  /** Seeded disabled when false. Defaults to true. */
  enabled?: boolean;
}

export interface TopicSeed {
  key: string;
  name: string;
  /** company | domain | field — how the onboarding chips are grouped. */
  group: "company" | "domain" | "field";
  /** Lower-case phrases that tag a story with this topic. */
  keywords: string[];
}

// ─── Sources ─────────────────────────────────────────────────────────────────
// PRIMARY  = the organisation that did the thing, publishing it itself.
// HIGH_QUALITY_REPORTING = established outlets and named analysts.
// COMMUNITY = aggregators and forums.

export const SOURCE_SEEDS: SourceSeed[] = [
  // ── PRIMARY: labs and vendors publishing their own work ──
  {
    key: "openai-blog",
    name: "OpenAI",
    kind: "rss",
    tier: "PRIMARY",
    url: "https://openai.com/news/rss.xml",
    homepage: "https://openai.com/news",
    defaultContentType: "NEWS",
    config: { topicKeys: ["openai"] },
  },
  {
    key: "google-deepmind",
    name: "Google DeepMind",
    kind: "rss",
    tier: "PRIMARY",
    url: "https://deepmind.google/blog/rss.xml",
    homepage: "https://deepmind.google/discover/blog",
    defaultContentType: "RESEARCH",
    config: { topicKeys: ["google"] },
  },
  {
    key: "google-research",
    name: "Google Research",
    kind: "rss",
    tier: "PRIMARY",
    url: "https://research.google/blog/rss/",
    homepage: "https://research.google/blog",
    defaultContentType: "RESEARCH",
    config: { topicKeys: ["google"] },
  },
  {
    key: "microsoft-research",
    name: "Microsoft Research",
    kind: "rss",
    tier: "PRIMARY",
    url: "https://www.microsoft.com/en-us/research/feed/",
    homepage: "https://www.microsoft.com/en-us/research",
    defaultContentType: "RESEARCH",
    config: { topicKeys: ["microsoft"] },
  },
  {
    key: "meta-engineering-ml",
    name: "Meta Engineering (ML)",
    kind: "rss",
    tier: "PRIMARY",
    url: "https://engineering.fb.com/category/ml-applications/feed/",
    homepage: "https://engineering.fb.com/category/ml-applications/",
    defaultContentType: "RESEARCH",
    config: { topicKeys: ["meta"] },
  },
  {
    key: "nvidia-blog",
    name: "NVIDIA",
    kind: "rss",
    tier: "PRIMARY",
    url: "https://blogs.nvidia.com/feed/",
    homepage: "https://blogs.nvidia.com",
    defaultContentType: "NEWS",
    config: { topicKeys: ["nvidia"] },
  },
  {
    key: "huggingface-blog",
    name: "Hugging Face",
    kind: "rss",
    tier: "PRIMARY",
    url: "https://huggingface.co/blog/feed.xml",
    homepage: "https://huggingface.co/blog",
    defaultContentType: "RELEASE",
    config: { topicKeys: ["hugging-face"] },
  },
  {
    key: "mistral-blog",
    name: "Mistral AI",
    kind: "rss",
    tier: "PRIMARY",
    url: "https://mistral.ai/rss.xml",
    homepage: "https://mistral.ai/news",
    defaultContentType: "NEWS",
    config: { topicKeys: ["mistral"] },
  },

  // ── PRIMARY: preprints, via the public arXiv API ──
  {
    key: "arxiv-ai",
    name: "arXiv",
    kind: "arxiv",
    tier: "PRIMARY",
    url: null,
    homepage: "https://arxiv.org",
    defaultContentType: "PAPER",
    config: {
      categories: ["cs.AI", "cs.LG", "cs.CL", "cs.CV", "cs.RO", "stat.ML"],
      maxResults: 60,
    },
  },

  // ── HIGH_QUALITY_REPORTING ──
  {
    key: "verge-ai",
    name: "The Verge",
    kind: "rss",
    tier: "HIGH_QUALITY_REPORTING",
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    homepage: "https://www.theverge.com/ai-artificial-intelligence",
    defaultContentType: "NEWS",
  },
  {
    key: "ars-technica-ai",
    name: "Ars Technica",
    kind: "rss",
    tier: "HIGH_QUALITY_REPORTING",
    url: "https://arstechnica.com/ai/feed/",
    homepage: "https://arstechnica.com/ai/",
    defaultContentType: "NEWS",
  },
  {
    key: "mit-technology-review-ai",
    name: "MIT Technology Review",
    kind: "rss",
    tier: "HIGH_QUALITY_REPORTING",
    url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/",
    homepage: "https://www.technologyreview.com/topic/artificial-intelligence/",
    defaultContentType: "NEWS",
  },
  {
    key: "techcrunch-ai",
    name: "TechCrunch",
    kind: "rss",
    tier: "HIGH_QUALITY_REPORTING",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    homepage: "https://techcrunch.com/category/artificial-intelligence/",
    defaultContentType: "NEWS",
  },
  {
    key: "wired-ai",
    name: "WIRED",
    kind: "rss",
    tier: "HIGH_QUALITY_REPORTING",
    url: "https://www.wired.com/feed/tag/ai/latest/rss",
    homepage: "https://www.wired.com/tag/artificial-intelligence/",
    defaultContentType: "NEWS",
  },

  // ── ANALYST: named experts reading the news rather than reporting it ──
  // Valuable for ranking, but two of them agreeing is two readings of one
  // story, not two witnesses. deriveVerification enforces that.
  {
    key: "simon-willison",
    name: "Simon Willison",
    kind: "rss",
    tier: "ANALYST",
    url: "https://simonwillison.net/atom/everything/",
    homepage: "https://simonwillison.net",
    defaultContentType: "NEWS",
  },
  // import-ai (importai.substack.com) was removed on 2026-09-17. Substack
  // returns 403 to datacenter IPs, so it failed on every hosted ingestion run
  // while working perfectly from a laptop — see #38. The owner's ruling was to
  // drop it rather than carry a source that is red by design, because a red
  // that is always there teaches everyone to stop reading reds.
  //
  // If it is ever re-added, it needs the HTML listing adapter from #26 or a
  // fetch path that Substack accepts; putting the feed URL back will not work.
  {
    key: "interconnects",
    name: "Interconnects",
    kind: "rss",
    tier: "ANALYST",
    url: "https://www.interconnects.ai/feed",
    homepage: "https://www.interconnects.ai",
    defaultContentType: "NEWS",
  },

  // ── COMMUNITY ──
  {
    key: "hackernews-ai",
    name: "Hacker News",
    kind: "hackernews",
    tier: "COMMUNITY",
    url: null,
    homepage: "https://news.ycombinator.com",
    // A linked story takes this type; the adapter marks self-posts DISCUSSION
    // itself, so defaulting this to DISCUSSION would mislabel every article.
    defaultContentType: "NEWS",
    config: { list: "top", limit: 120, minPoints: 20 },
  },
  {
    key: "hackernews-show",
    name: "Show HN",
    kind: "hackernews",
    tier: "COMMUNITY",
    url: null,
    homepage: "https://news.ycombinator.com/show",
    /**
     * RELEASE, and the imprecision is deliberate rather than overlooked.
     *
     * A Show HN post is a DEBUT — a person putting a thing in front of people
     * for the first time — and "Release" connotes a version of a product that
     * already exists. That is a real mismatch and it is smaller than either
     * alternative's cost.
     *
     * Not DISCUSSION: it is what the adapter assigns to front-page self-posts,
     * it carries ranking weight 0, and it would tell a reader that somebody
     * shipping a thing is a conversation. Not a new content type either: an
     * enum member costs a migration, a label, a badge colour, a ranking
     * weight, a place in every exhaustiveness switch and a row on #66 — and
     * the Signal model may replace the Story content-type axis entirely, in
     * which case the second build is the one that has to migrate rows.
     *
     * The open question is carried by #78. If launches get their own kind,
     * this line is where it changes.
     */
    defaultContentType: "RELEASE",
    /**
     * minPoints 3 is measured, not inherited. Against the live show list,
     * scores run min 2 / p25 3 / MEDIAN 4 / p75 17 / max 2100. The front
     * page's threshold of 20 keeps 23% of the list; 3 keeps 78% and still
     * drops the submissions sitting at 2. A threshold calibrated for one list
     * silently empties another.
     */
    config: { list: "show", limit: 120, minPoints: 3 },
  },
];

// ─── Topics ──────────────────────────────────────────────────────────────────
// Keywords are lower-case phrases matched against a story's title and excerpt.
// Short, ambiguous words ("meta", "grok") are kept short deliberately so the
// tagger can whole-word them; longer phrases are safe as substrings.

export const TOPIC_SEEDS: TopicSeed[] = [
  // ── Companies ──
  {
    key: "openai",
    name: "OpenAI",
    group: "company",
    keywords: [
      "openai",
      "chatgpt",
      "gpt-4",
      "gpt-5",
      "gpt-6",
      "sora",
      "dall-e",
      "o1",
      "o3",
      "codex",
    ],
  },
  {
    key: "anthropic",
    name: "Anthropic",
    group: "company",
    keywords: ["anthropic", "claude", "claude code", "constitutional ai"],
  },
  {
    key: "google",
    name: "Google & DeepMind",
    group: "company",
    keywords: [
      "google deepmind",
      "deepmind",
      "gemini",
      "alphafold",
      "google research",
      "veo",
      "imagen",
    ],
  },
  {
    key: "meta",
    name: "Meta",
    group: "company",
    keywords: ["meta ai", "llama", "pytorch", "fair", "segment anything"],
  },
  {
    key: "microsoft",
    name: "Microsoft",
    group: "company",
    keywords: ["microsoft", "copilot", "azure ai", "phi-3", "phi-4", "microsoft research"],
  },
  {
    key: "nvidia",
    name: "NVIDIA",
    group: "company",
    keywords: ["nvidia", "cuda", "blackwell", "rubin", "tensorrt", "nim"],
  },
  {
    key: "hugging-face",
    name: "Hugging Face",
    group: "company",
    keywords: ["hugging face", "huggingface", "transformers library", "model hub"],
  },
  {
    key: "mistral",
    name: "Mistral AI",
    group: "company",
    keywords: ["mistral", "mixtral", "codestral", "le chat"],
  },
  {
    key: "xai",
    name: "xAI",
    group: "company",
    keywords: ["xai", "grok"],
  },
  {
    key: "apple",
    name: "Apple",
    group: "company",
    keywords: ["apple intelligence", "apple ai", "core ml", "mlx"],
  },
  {
    key: "amazon",
    name: "Amazon & AWS",
    group: "company",
    keywords: ["amazon bedrock", "aws ai", "trainium", "inferentia", "amazon nova"],
  },
  {
    key: "deepseek",
    name: "DeepSeek",
    group: "company",
    keywords: ["deepseek"],
  },
  {
    key: "qwen",
    name: "Qwen & Alibaba",
    group: "company",
    keywords: ["qwen", "alibaba cloud ai", "tongyi"],
  },

  // ── Domains ──
  {
    key: "agents",
    name: "AI agents",
    group: "domain",
    keywords: [
      "ai agent",
      "agentic",
      "autonomous agent",
      "tool use",
      "computer use",
      "mcp",
      "model context protocol",
    ],
  },
  {
    key: "coding",
    name: "AI for coding",
    group: "domain",
    keywords: [
      "code generation",
      "coding assistant",
      "copilot",
      "cursor",
      "code review ai",
      "swe-bench",
      "pair programming",
    ],
  },
  {
    key: "robotics",
    name: "Robotics & embodied AI",
    group: "domain",
    keywords: [
      "robotics",
      "humanoid",
      "embodied ai",
      "manipulation",
      "self-driving",
      "autonomous vehicle",
    ],
  },
  {
    key: "healthcare",
    name: "Health & biology",
    group: "domain",
    keywords: [
      "medical ai",
      "clinical",
      "drug discovery",
      "protein",
      "alphafold",
      "diagnosis",
      "radiology",
    ],
  },
  {
    key: "security",
    name: "Security & misuse",
    group: "domain",
    keywords: [
      "prompt injection",
      "jailbreak",
      "deepfake",
      "ai security",
      "adversarial",
      "data poisoning",
      "model theft",
    ],
  },
  {
    key: "policy",
    name: "Policy & regulation",
    group: "domain",
    keywords: [
      "ai act",
      "regulation",
      "executive order",
      "copyright",
      "lawsuit",
      "export controls",
      "ai safety institute",
    ],
  },
  {
    key: "business",
    name: "Business & funding",
    group: "domain",
    keywords: [
      "funding round",
      "series a",
      "series b",
      "series c",
      "acquisition",
      "valuation",
      "ipo",
      "revenue",
      "layoffs",
    ],
  },
  {
    key: "hardware",
    name: "Chips & infrastructure",
    group: "domain",
    keywords: [
      "gpu",
      "tpu",
      "accelerator",
      "data center",
      "datacenter",
      "chip",
      "semiconductor",
      "hbm",
      "interconnect",
    ],
  },
  {
    key: "open-source",
    name: "Open source & open weights",
    group: "domain",
    keywords: [
      "open source",
      "open weights",
      "open model",
      "apache 2.0",
      "permissive license",
      "self-hosted",
    ],
  },
  {
    key: "creative",
    name: "Image, video & audio",
    group: "domain",
    keywords: [
      "text-to-image",
      "text-to-video",
      "image generation",
      "video generation",
      "music generation",
      "voice cloning",
    ],
  },

  // ── Fields ──
  {
    key: "llms",
    name: "Language models",
    group: "field",
    keywords: [
      "large language model",
      "llm",
      "foundation model",
      "pretraining",
      "context window",
      "tokenizer",
    ],
  },
  {
    key: "multimodal",
    name: "Multimodal",
    group: "field",
    keywords: ["multimodal", "vision language", "vlm", "image understanding", "any-to-any"],
  },
  {
    key: "reasoning",
    name: "Reasoning",
    group: "field",
    keywords: [
      "reasoning model",
      "chain of thought",
      "test-time compute",
      "inference-time",
      "math reasoning",
    ],
  },
  {
    key: "reinforcement-learning",
    name: "Reinforcement learning",
    group: "field",
    keywords: [
      "reinforcement learning",
      "rlhf",
      "rlaif",
      "reward model",
      "policy optimization",
      "dpo",
    ],
  },
  {
    key: "evaluation",
    name: "Evaluation & benchmarks",
    group: "field",
    keywords: [
      "benchmark",
      "evaluation",
      "leaderboard",
      "eval harness",
      "contamination",
      "mmlu",
      "arc-agi",
    ],
  },
  {
    key: "safety",
    name: "Safety & alignment",
    group: "field",
    keywords: [
      "alignment",
      "ai safety",
      "interpretability",
      "red team",
      "model welfare",
      "scalable oversight",
    ],
  },
  {
    key: "efficiency",
    name: "Efficiency & inference",
    group: "field",
    keywords: [
      "quantization",
      "distillation",
      "sparse",
      "mixture of experts",
      "inference speed",
      "kv cache",
      "flash attention",
    ],
  },
  {
    key: "retrieval",
    name: "Retrieval & memory",
    group: "field",
    keywords: [
      "retrieval augmented",
      "rag",
      "vector database",
      "embedding",
      "semantic search",
      "long-term memory",
    ],
  },
];
