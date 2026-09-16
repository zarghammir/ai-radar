/* AI Radar \u2014 prototype content.
   Real stories published between 9 and 16 September 2026. Every headline, outlet
   and URL is genuine. Nothing here is placeholder text.
   verification: primary | corroborated | emerging | unverified
   type:         news | release | paper | model | discussion | signal          */

window.RADAR_STORIES = [
  {
    id: "openai-valuation",
    rank: 1,
    type: "news",
    verification: "unverified",
    headline: "OpenAI weighs funding at a $1.2T\u2013$1.5T valuation",
    summary: "Reports say OpenAI is considering a new private round, with outlets disagreeing on whether the mark is $1.2 trillion or $1.5 trillion.",
    why: "A private mega-round instead of an IPO keeps disclosure minimal while it absorbs capital its competitors need.",
    keyPoints: [
      "Bloomberg and the FT report $1.2 trillion; the New York Times reports $1.5 trillion.",
      "Altman has said a listing before 2027 is unlikely.",
      "OpenAI passed $40 billion annualised revenue last month."
    ],
    grading: "One bar. No named source and no company statement. Four outlets carry it and they do not agree on the figure.",
    source: { name: "Bloomberg", url: "https://www.bloomberg.com/news/articles/2026-09-15/openai-weighing-funding-round-at-over-1-2-trillion-valuation" },
    also: [
      { name: "Fortune", url: "https://fortune.com/", at: "08:10" },
      { name: "Forbes", url: "https://www.forbes.com/", at: "08:44" },
      { name: "24/7 Wall St.", url: "https://247wallst.com/", at: "09:02", note: "differs" }
    ],
    detected: "07:25",
    day: "16 Sep",
    minutes: 3,
    topics: ["funding", "markets"],
    pickup: [1, 1, 2, 3, 3, 4, 4, 4],
    ranking: [
      { label: "Independent outlets", value: 80, display: "4 of 5" },
      { label: "Matches your topics", value: 92, display: "high" },
      { label: "Freshness", value: 88, display: "6h" },
      { label: "Source weight", value: 70, display: "good" },
      { label: "Unverified penalty", value: 34, display: "\u221234", negative: true }
    ]
  },
  {
    id: "anthropic-ci",
    rank: 2,
    type: "discussion",
    verification: "primary",
    headline: "Anthropic reports a 25x CI jump as Claude authors most of its code",
    summary: "Anthropic published how it rearchitected test impact analysis after continuous-integration jobs grew twenty-five-fold in six months.",
    why: "The bottleneck for AI-assisted teams moves from writing code to verifying it, and that cost arrives sooner than headcount suggests.",
    keyPoints: [
      "Engineers ship roughly eight times more code per quarter than in 2021\u201325.",
      "Claude authors around 80% of that code.",
      "Test count grew tenfold; test selection had to scale horizontally."
    ],
    grading: "Four bars. The company published this itself, with its own numbers.",
    source: { name: "Anthropic", url: "https://claude.com/blog/agentic-coding-is-straining-ci-heres-how-we-scaled-test-impact-analysis-at-anthropic" },
    also: [{ name: "Agentic Ready", url: "https://agenticready.com/", at: "10:05" }],
    detected: "08:20",
    day: "15 Sep",
    minutes: 5,
    topics: ["agents", "developer tools", "testing"],
    pickup: [1, 1, 1, 2, 2, 2, 2, 2],
    ranking: [
      { label: "Independent outlets", value: 30, display: "1 of 5" },
      { label: "Matches your topics", value: 95, display: "high" },
      { label: "Freshness", value: 62, display: "1d" },
      { label: "Source weight", value: 96, display: "primary" }
    ]
  },
  {
    id: "openai-agents-api",
    rank: 3,
    type: "release",
    verification: "primary",
    headline: "OpenAI opens the Codex agent harness as a public-beta API",
    summary: "OpenAI released the Agents API in public beta, exposing the managed harness that runs Codex to all developers.",
    why: "Session orchestration, context compaction and recovery become vendor infrastructure, which erases a large chunk of in-house agent scaffolding.",
    keyPoints: [
      "Durable sessions carry agent work across turns.",
      "Bring your own tools and MCP servers.",
      "Sandbox partners include Cloudflare, E2B, Modal and Vercel."
    ],
    grading: "Four bars. Announced by OpenAI on its own newsroom.",
    source: { name: "OpenAI", url: "https://openai.com/index/introducing-the-agents-api/" },
    also: [
      { name: "MarkTechPost", url: "https://www.marktechpost.com/", at: "16:30" },
      { name: "Investing.com", url: "https://www.investing.com/", at: "17:12" }
    ],
    detected: "14:20",
    day: "11 Sep",
    minutes: 4,
    topics: ["agents", "developer tools"],
    pickup: [1, 1, 2, 2, 3, 3, 3, 3],
    ranking: [
      { label: "Independent outlets", value: 55, display: "3 of 5" },
      { label: "Matches your topics", value: 98, display: "high" },
      { label: "Freshness", value: 40, display: "5d" },
      { label: "Source weight", value: 96, display: "primary" }
    ]
  },
  {
    id: "apple-siri",
    rank: 4,
    type: "release",
    verification: "primary",
    headline: "Apple ships rebuilt Siri in beta, built on Gemini-based foundation models",
    summary: "Apple released Siri AI in beta on 14 September alongside iOS 27, running on-device and on Private Cloud Compute.",
    why: "The largest consumer assistant surface now runs on a rival's models behind a de-identifying privacy layer, setting an architecture precedent.",
    keyPoints: [
      "Apple Foundation Models built with Google Gemini under a multi-year deal.",
      "Hybrid on-device plus Private Cloud Compute routing.",
      "Beta ships with daily limits; a paid tier is signalled."
    ],
    grading: "Four bars. Apple Newsroom, with three major outlets corroborating within the hour.",
    source: { name: "Apple Newsroom", url: "https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/" },
    also: [
      { name: "Forbes", url: "https://www.forbes.com/", at: "17:40" },
      { name: "CNBC", url: "https://www.cnbc.com/", at: "17:52" },
      { name: "MacObserver", url: "https://www.macobserver.com/", at: "18:30" }
    ],
    detected: "17:05",
    day: "14 Sep",
    minutes: 3,
    topics: ["assistants", "privacy", "partnerships"],
    pickup: [1, 2, 3, 4, 4, 4, 4, 4],
    ranking: [
      { label: "Independent outlets", value: 88, display: "4 of 5" },
      { label: "Matches your topics", value: 60, display: "medium" },
      { label: "Freshness", value: 55, display: "2d" },
      { label: "Source weight", value: 96, display: "primary" }
    ]
  },
  {
    id: "atria-dawn-signal",
    rank: 5,
    type: "signal",
    verification: "emerging",
    headline: "Atria Dawn weights landed on GitHub days before the report",
    summary: "An Atria-Dawn-Preview repo and an OpenAI-compatible API appeared quietly, with gateway integration merged before the technical report was posted.",
    why: "Repo-first drops are an early read on Chinese lab releases, days ahead of the press cycle.",
    keyPoints: [
      "GitHub repo surfaced around 11 September, credited to Shanghai AI Laboratory.",
      "Standard instruct plus FP8-quantised checkpoints.",
      "An LLM gateway integration landed within 24 hours."
    ],
    grading: "Two bars. The repository is real and verifiable. The claim that it preceded the report comes from secondary coverage, not from timestamps we read ourselves.",
    source: { name: "Hugging Face", url: "https://huggingface.co/internlm/Atria-Dawn-Preview" },
    also: [{ name: "OrcaRouter", url: "https://orcarouter.com/", at: "09:40" }],
    detected: "22:30",
    day: "11 Sep",
    minutes: 2,
    topics: ["open weights", "signal"],
    pickup: [1, 1, 1, 1, 2, 2, 2, 2],
    ranking: [
      { label: "Independent outlets", value: 25, display: "1 of 5" },
      { label: "Matches your topics", value: 85, display: "high" },
      { label: "Freshness", value: 38, display: "5d" },
      { label: "Source weight", value: 50, display: "medium" },
      { label: "Emerging penalty", value: 18, display: "\u221218", negative: true }
    ]
  },
  {
    id: "cohere-translate",
    rank: 6,
    type: "model",
    verification: "primary",
    headline: "Cohere releases a 218B open-weight translation model",
    summary: "Cohere Labs published open weights for a 218B-parameter translation mixture-of-experts covering fifty languages, with twenty-five billion active parameters.",
    why: "A self-hostable translator that Cohere claims beats DeepL and Google changes the build-or-buy call for localisation pipelines.",
    keyPoints: [
      "WMT26 all-language score of 83.60.",
      "16K token input and output limits, text only.",
      "CC BY-NC 4.0, gated weights \u2014 non-commercial."
    ],
    grading: "Four bars. Cohere published the weights and the card itself.",
    source: { name: "Cohere", url: "https://cohere.com/blog/north-small-translate" },
    also: [
      { name: "Unite.AI", url: "https://www.unite.ai/", at: "13:20" },
      { name: "MarkTechPost", url: "https://www.marktechpost.com/", at: "14:05" }
    ],
    detected: "11:30",
    day: "10 Sep",
    minutes: 3,
    topics: ["open weights", "multilingual"],
    pickup: [1, 1, 2, 3, 3, 3, 3, 3],
    ranking: [
      { label: "Independent outlets", value: 55, display: "3 of 5" },
      { label: "Matches your topics", value: 72, display: "good" },
      { label: "Freshness", value: 30, display: "6d" },
      { label: "Source weight", value: 96, display: "primary" }
    ]
  },
  {
    id: "atria-dawn-paper",
    rank: 7,
    type: "paper",
    verification: "primary",
    headline: "Atria Dawn report pairs a 744B agentic model with a 769-task human study",
    summary: "Shanghai AI Laboratory posted the Atria Dawn Preview technical report on arXiv, covering sixteen benchmarks and a human-AI collaboration study.",
    why: "One of the few releases reporting real-task human records alongside benchmarks, which is a better proxy for production agent value.",
    keyPoints: [
      "744B mixture-of-experts base, 256K context, MIT-licensed checkpoints.",
      "Highest listed score on 5 of 16 benchmarks, including BrowseComp 92.5.",
      "769 task records from 56 users; about a third rated infeasible without AI."
    ],
    grading: "Four bars. Posted by the authors to arXiv with checkpoints attached.",
    source: { name: "arXiv", url: "https://arxiv.org/abs/2609.15818" },
    also: [
      { name: "Hugging Face Papers", url: "https://huggingface.co/papers", at: "06:15" },
      { name: "Papers with Code", url: "https://paperswithcode.com/", at: "07:40" }
    ],
    detected: "04:10",
    day: "15 Sep",
    minutes: 6,
    topics: ["agents", "open weights", "evaluation"],
    pickup: [1, 1, 2, 2, 3, 3, 3, 3],
    ranking: [
      { label: "Independent outlets", value: 52, display: "3 of 5" },
      { label: "Matches your topics", value: 90, display: "high" },
      { label: "Freshness", value: 60, display: "1d" },
      { label: "Source weight", value: 90, display: "primary" }
    ]
  },
  {
    id: "amodei-pacing",
    rank: 8,
    type: "discussion",
    verification: "primary",
    headline: "Amodei publishes \u201cWe Must Pace the Frontier\u201d with a three-step plan",
    summary: "Dario Amodei argued the industry should slow capability gains by one to two years and committed Anthropic to embedded third-party evaluators.",
    why: "If pacing commitments stick, frontier capability timelines and the compliance surface around them both shift under your roadmap.",
    keyPoints: [
      "Anthropic unilaterally grants evaluators employee-level access.",
      "Cites recursive self-improvement and the Hugging Face agent-swarm incident.",
      "Altman, Musk, Hassabis and Nadella publicly backed step one."
    ],
    grading: "Four bars. Published under the author's own name on his own site.",
    source: { name: "Dario Amodei", url: "https://www.darioamodei.com/post/we-must-pace-the-frontier" },
    also: [
      { name: "Axios", url: "https://www.axios.com/", at: "17:10" },
      { name: "Fortune", url: "https://fortune.com/", at: "18:00" }
    ],
    detected: "16:00",
    day: "12 Sep",
    minutes: 6,
    topics: ["safety", "policy"],
    pickup: [1, 2, 3, 3, 3, 3, 3, 3],
    ranking: [
      { label: "Independent outlets", value: 58, display: "3 of 5" },
      { label: "Matches your topics", value: 66, display: "good" },
      { label: "Freshness", value: 44, display: "4d" },
      { label: "Source weight", value: 88, display: "primary" }
    ]
  },
  {
    id: "china-response",
    rank: 9,
    type: "news",
    verification: "corroborated",
    headline: "China's Foreign Ministry rejects Amodei's call to curb its AI",
    summary: "Spokesperson Guo Jiakun called Amodei's chip-restriction argument fearmongering, days before US\u2013China talks in Washington.",
    why: "Compute export policy is now a stated diplomatic flashpoint, which feeds directly into GPU availability and pricing.",
    keyPoints: [
      "Amodei's essay urged continued curbs on chips and chipmaking gear.",
      "Guo: confrontation \u201cserves no one's interest\u201d.",
      "Global Times called the essay a Cold War playbook for AI."
    ],
    grading: "Three bars. Reported independently by several outlets, but no primary transcript published.",
    source: { name: "NPR", url: "https://www.npr.org/2026/09/14/nx-s1-5968456/china-hits-back-ai-development" },
    also: [
      { name: "Global Times", url: "https://www.globaltimes.cn/", at: "13:20" },
      { name: "Maine Public", url: "https://www.mainepublic.org/", at: "14:00" }
    ],
    detected: "12:40",
    day: "14 Sep",
    minutes: 3,
    topics: ["policy", "chips", "geopolitics"],
    pickup: [1, 2, 3, 3, 3, 3, 3, 3],
    ranking: [
      { label: "Independent outlets", value: 62, display: "3 of 5" },
      { label: "Matches your topics", value: 58, display: "medium" },
      { label: "Freshness", value: 52, display: "2d" },
      { label: "Source weight", value: 74, display: "good" }
    ]
  },
  {
    id: "sakana-fugu",
    rank: 10,
    type: "release",
    verification: "primary",
    headline: "Sakana ships Fugu Max, a router over open and specialist models",
    summary: "Sakana AI released Fugu Max and Fugu Ultra v2, an orchestration layer that routes each request to the leanest model that can solve it.",
    why: "A live test of whether routing over open weights can undercut frontier pricing without losing benchmark ground.",
    keyPoints: [
      "$2 per million input tokens, $6 per million output.",
      "Claims 40\u201360% below Sonnet 5 and Kimi K3 on output.",
      "Ultra v2 runs with no frontier proprietary model in its pool."
    ],
    grading: "Four bars. Sakana published the release and the pricing itself.",
    source: { name: "Sakana AI", url: "https://sakana.ai/fugu-max-release/" },
    also: [{ name: "DataNorth", url: "https://datanorth.ai/", at: "11:00" }],
    detected: "09:15",
    day: "11 Sep",
    minutes: 4,
    topics: ["open weights", "inference cost", "routing"],
    pickup: [1, 1, 2, 2, 2, 2, 2, 2],
    ranking: [
      { label: "Independent outlets", value: 34, display: "2 of 5" },
      { label: "Matches your topics", value: 80, display: "high" },
      { label: "Freshness", value: 36, display: "5d" },
      { label: "Source weight", value: 88, display: "primary" }
    ]
  },
  {
    id: "project-lily",
    rank: 11,
    type: "news",
    verification: "emerging",
    headline: "404 Media: contractors are reading real ChatGPT conversations",
    summary: "404 Media obtained internal materials showing OpenAI hired hundreds of contractors to read, summarise and score real user conversations.",
    why: "Default-on human review of prompts is a consent and data-handling problem for anyone routing customer text through a hosted model.",
    keyPoints: [
      "Reviewer instructions, Slack messages and a scoring rubric obtained.",
      "Targets include less sycophancy, fewer emoji, less AI-speak.",
      "Review is on by default on Free, Plus and Pro; opt-out covers new chats only."
    ],
    grading: "Two bars. One outlet with documents it has not published in full, and no company response yet.",
    source: { name: "404 Media", url: "https://www.404media.co/inside-project-lily-the-humans-reading-your-chatgpt-chats/" },
    also: [
      { name: "Tom's Hardware", url: "https://www.tomshardware.com/", at: "12:30" },
      { name: "Tom's Guide", url: "https://www.tomsguide.com/", at: "13:15" }
    ],
    detected: "10:15",
    day: "14 Sep",
    minutes: 4,
    topics: ["privacy", "policy"],
    pickup: [1, 1, 2, 3, 3, 3, 3, 3],
    ranking: [
      { label: "Independent outlets", value: 48, display: "3 of 5" },
      { label: "Matches your topics", value: 70, display: "good" },
      { label: "Freshness", value: 50, display: "2d" },
      { label: "Source weight", value: 60, display: "medium" },
      { label: "Emerging penalty", value: 22, display: "\u221222", negative: true }
    ]
  },
  {
    id: "claude-code-limits",
    rank: 12,
    type: "signal",
    verification: "corroborated",
    headline: "Claude Code weekly limits fall 17% as a May promotion expires",
    summary: "A permanent 25% weekly limit increase took effect on 14 September, one day after a temporary 50% boost expired.",
    why: "A quiet baseline change is a real capacity cut for any team whose delivery plan was sized against the boosted limits.",
    keyPoints: [
      "The +25% is measured against pre-May levels, not current ones.",
      "The 50% promotion ran from May and lapsed on 13 September.",
      "Applies across Pro, Max, Team and seat-based Enterprise."
    ],
    grading: "Three bars. Several outlets did the arithmetic independently; there is no primary announcement framing it as a cut.",
    source: { name: "Implicator.ai", url: "https://www.implicator.ai/anthropic-claude-code-weekly-limits-september-14/" },
    also: [{ name: "Windows Report", url: "https://windowsreport.com/", at: "09:10" }],
    detected: "06:40",
    day: "14 Sep",
    minutes: 2,
    topics: ["pricing", "coding tools", "signal"],
    pickup: [1, 1, 2, 2, 2, 2, 2, 2],
    ranking: [
      { label: "Independent outlets", value: 44, display: "2 of 5" },
      { label: "Matches your topics", value: 88, display: "high" },
      { label: "Freshness", value: 50, display: "2d" },
      { label: "Source weight", value: 56, display: "medium" }
    ]
  },
  {
    id: "cornelis",
    rank: 13,
    type: "news",
    verification: "corroborated",
    headline: "Cornelis raises $205M for GPU-agnostic AI networking",
    summary: "The Intel spinoff closed $205M led by IAG Capital Partners and launched a fabric that computes in-network alongside Qualcomm.",
    why: "Open, GPU-agnostic interconnect is the main lever on cluster idle time, and therefore on what inference actually costs you.",
    keyPoints: [
      "Led by IAG Capital Partners, with a Qualcomm strategic collaboration.",
      "Targets GPU time wasted waiting on data movement.",
      "Funds CN5000 and CN6000 switch production."
    ],
    grading: "Three bars. Covered by four independent trade outlets from a company announcement.",
    source: { name: "TechCrunch", url: "https://techcrunch.com/2026/09/14/ai-infrastructure-company-cornelis-raises-205m-to-chip-away-at-nvidias-dominance/" },
    also: [
      { name: "SiliconANGLE", url: "https://siliconangle.com/", at: "14:20" },
      { name: "Network World", url: "https://www.networkworld.com/", at: "15:05" }
    ],
    detected: "13:00",
    day: "14 Sep",
    minutes: 3,
    topics: ["funding", "chips", "infrastructure"],
    pickup: [1, 2, 3, 3, 3, 3, 3, 3],
    ranking: [
      { label: "Independent outlets", value: 60, display: "3 of 5" },
      { label: "Matches your topics", value: 48, display: "medium" },
      { label: "Freshness", value: 52, display: "2d" },
      { label: "Source weight", value: 76, display: "good" }
    ]
  },
  {
    id: "perplexity-local",
    rank: 14,
    type: "release",
    verification: "primary",
    headline: "Perplexity's local agent comes to Windows on RTX GPUs",
    summary: "Perplexity shipped its fully local agent in the Windows app for RTX GPUs with 24GB or more of video memory.",
    why: "A shipping consumer agent with zero token cost and on-device data is a live counter-example to the API-only assumption.",
    keyPoints: [
      "Model, harness, orchestrator and scheduler all run on the device.",
      "Defaults to a local Qwen 3.8 27B post-trained for the agent.",
      "Pro and Max subscribers; local work burns no credits."
    ],
    grading: "Four bars. Announced on NVIDIA's own blog with Perplexity.",
    source: { name: "NVIDIA", url: "https://blogs.nvidia.com/blog/local-ai-perplexity-windows-pcs/" },
    also: [
      { name: "VentureBeat", url: "https://venturebeat.com/", at: "16:40" },
      { name: "Unite.AI", url: "https://www.unite.ai/", at: "17:20" }
    ],
    detected: "15:30",
    day: "14 Sep",
    minutes: 3,
    topics: ["local inference", "agents"],
    pickup: [1, 2, 3, 3, 3, 3, 3, 3],
    ranking: [
      { label: "Independent outlets", value: 56, display: "3 of 5" },
      { label: "Matches your topics", value: 82, display: "high" },
      { label: "Freshness", value: 52, display: "2d" },
      { label: "Source weight", value: 90, display: "primary" }
    ]
  }
];

/* Items ingested per hour today, 00:00 \u2192 23:00. Index 13 is the current hour. */
window.RADAR_ARRIVALS = [0,0,1,0,0,0,2,3,5,4,6,3,4,7,5,4,2,3,1,2,1,0,1,0];
window.RADAR_CURRENT_HOUR = 13;

window.RADAR_SOURCES = [
  { name: "Anthropic Newsroom",       url: "https://www.anthropic.com/news",            kind: "Company blog", on: true },
  { name: "OpenAI News",              url: "https://openai.com/news/",                  kind: "Company blog", on: true },
  { name: "Google DeepMind Blog",     url: "https://deepmind.google/blog/",             kind: "Company blog", on: true },
  { name: "arXiv cs.CL",              url: "https://arxiv.org/list/cs.CL/recent",       kind: "Preprints",    on: true },
  { name: "arXiv cs.LG",              url: "https://arxiv.org/list/cs.LG/recent",       kind: "Preprints",    on: true },
  { name: "Hugging Face Daily Papers",url: "https://huggingface.co/papers",             kind: "Preprints",    on: true },
  { name: "Hacker News",              url: "https://news.ycombinator.com/",             kind: "Discussion",   on: true },
  { name: "Simon Willison's Weblog",  url: "https://simonwillison.net/",                kind: "Newsletter",   on: true },
  { name: "Import AI",                url: "https://importai.substack.com/",            kind: "Newsletter",   on: false },
  { name: "The Batch",                url: "https://www.deeplearning.ai/the-batch/",    kind: "Newsletter",   on: false }
];

window.RADAR_TOPICS = [
  "agents", "open weights", "safety", "policy", "chips", "funding",
  "developer tools", "evaluation", "privacy", "inference cost",
  "multilingual", "local inference", "assistants", "robotics"
];
