/**
 * Puts stories into an end-to-end database, THROUGH THE REAL PIPELINE.
 *
 *   npm run db:seed:stories
 *
 * WHY THIS EXISTS. CI's browser checks used to work in any database, because
 * Today served the built-in catalogue whatever was behind it. #62 turns Today
 * on to the live database, and CI's `ai_radar_e2e` is migrated but empty — so
 * Today honestly offers nothing and `collectStoryIds` refuses to measure an
 * empty screen. The floor was right; the data was missing.
 *
 * WHY NOT `NEXT_PUBLIC_USE_FIXTURES=1` FOR THE BROWSER JOB. It is one line and
 * it turns CI green. It also means the browser checks never exercise the live
 * path, on the pull request whose entire subject is turning that path on. A
 * green that comes from not running the thing under test is the planted-state
 * trap one layer up, and it would look exactly like a fix.
 *
 * WHY NOT INSERT ROWS DIRECTLY. A story that never went through the pipeline is
 * not the thing the screen renders: it has no sources joined to it, no
 * clustering, no content type from the classifier and no score. Inserting one
 * would exercise the SELECT and nothing else. So this feeds RSS to the real
 * `runIngest` over an injected fetch — no network, no fixtures, the same code
 * the worker runs — and then ranks, because a story nobody scored cannot reach
 * Today.
 */
import { getDb, getSql } from "@/db/client";
import { runIngest } from "@/pipeline/run";
import { rankAllStories } from "@/pipeline/ranking/rank-all";
import { readingMinutes } from "@/pipeline/normalize/text";
import { BRIEF_LENGTHS, sources, stories } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/** Enough for the browser scripts, which ask for three ids and a brief. */
const MIN_STORIES = 4;

/**
 * THE LONGEST FINITE READING BUDGET, DERIVED FROM THE PRODUCT'S OWN LIST.
 *
 * This guarded the SHORTEST budget until #114, which was the wrong end. A
 * corpus longer than five minutes proves the five-minute setting can cut and
 * says nothing about the ten — and `BRIEF_LENGTHS` is ["5", "10", "all"], so
 * ten is a real choice a reader can make. When #114 added `ten < all`, the
 * brief ran ELEVEN minutes: a margin of one minute, one story, over the
 * ten-minute budget. One summary edit from a correct build going red.
 *
 * Guarding the longest finite budget guards every shorter one by construction,
 * which is why this is the end to hold.
 *
 * DERIVED rather than written as 10, so adding a longer option to
 * BRIEF_LENGTHS raises this floor automatically instead of leaving a new
 * setting the corpus cannot exercise — the exact gap #114 was filed for. "all"
 * is dropped because it is not a budget: it is the absence of one.
 */
const LONGEST_FINITE_BUDGET_MINUTES = Math.max(
  ...BRIEF_LENGTHS.filter((length) => length !== "all").map(Number),
);

/**
 * Dealt round-robin across whatever is enabled, so the count does not depend on
 * how many sources the database happens to have.
 */

const ITEMS = [
  {
    title: "Anthropic publishes a threat report on agentic misuse",
    link: "https://www.anthropic.com/news/e2e-threat-report",
    minutesAgo: 25,
  },
  {
    title: "OpenAI opens the Codex agent harness as a public-beta API",
    link: "https://openai.com/index/e2e-codex-harness",
    minutesAgo: 40,
  },
  {
    title: "A new open-weights model claims parity on long-context evaluation",
    link: "https://www.theverge.com/e2e-open-weights-parity",
    minutesAgo: 55,
  },
  {
    title: "Chip export rules widen to cover inference accelerators",
    link: "https://arstechnica.com/e2e-export-rules",
    minutesAgo: 70,
  },
  {
    title: "A developer tool for tracing agent runs reaches version 1.0",
    link: "https://techcrunch.com/e2e-agent-tracing-1-0",
    minutesAgo: 85,
  },
  // SIX MORE, AND THE COUNT IS LOAD-BEARING RATHER THAN GENEROUS. See
  // MIN_BRIEF_MINUTES below: with five items the whole brief ran exactly five
  // minutes, so the five-minute reading budget had nothing to cut and
  // verify:saved reported the preference broken on a working build.
  {
    title: "Cloud providers report AI capacity sold out through next year",
    link: "https://www.reuters.com/e2e-capacity-sold-out",
    minutesAgo: 100,
  },
  {
    title: "Researchers publish a replication of long-context retrieval claims",
    link: "https://www.nature.com/e2e-long-context-replication",
    minutesAgo: 115,
  },
  {
    title: "A court declines to block training on licensed news archives",
    link: "https://www.theguardian.com/e2e-training-archives-ruling",
    minutesAgo: 130,
  },
  {
    title: "Practitioners argue evaluation harnesses measure the harness",
    link: "https://news.ycombinator.com/e2e-harness-measures-harness",
    minutesAgo: 145,
  },
  {
    title: "A funding round values an inference startup at eleven billion",
    link: "https://www.bloomberg.com/e2e-inference-round",
    minutesAgo: 160,
  },
  {
    title: "An open dataset of agent trajectories is released under CC-BY",
    link: "https://huggingface.co/e2e-agent-trajectories",
    minutesAgo: 175,
  },
  // FOUR MORE FOR HEADROOM, not for coverage. #114 raised the floor to the
  // LONGEST finite budget, and at eleven items the brief ran eleven minutes
  // against a ten-minute budget — a margin of one story. A floor that only
  // just holds is a floor that fails on the next summary edit, and the whole
  // point of putting it in the seeder was to stop a corpus problem surfacing
  // as a confident failure somewhere else.
  {
    title: "A safety evaluation suite adds multi-turn jailbreak scenarios",
    link: "https://www.anthropic.com/e2e-multiturn-evals",
    minutesAgo: 190,
  },
  {
    title: "Two labs publish conflicting results on scaling inference compute",
    link: "https://arxiv.org/e2e-conflicting-inference-scaling",
    minutesAgo: 205,
  },
  {
    title: "A regulator opens consultation on model disclosure requirements",
    link: "https://www.ft.com/e2e-model-disclosure-consultation",
    minutesAgo: 220,
  },
  {
    title: "An inference runtime ships speculative decoding by default",
    link: "https://github.com/e2e-speculative-decoding-default",
    minutesAgo: 235,
  },
];

/**
 * One story told twice, so the corpus contains a multi-source story at all.
 *
 * The headlines share almost every token, which is what makes assignStory
 * cluster them; the links differ, which is what makes them two items from two
 * sources rather than one item seen twice.
 */
const PICKUP = {
  origin: {
    title: "Hugging Face releases an open dataset of agent trajectories",
    link: "https://huggingface.co/e2e-trajectories-release",
    minutesAgo: 250,
  },
  report: {
    title: "Hugging Face releases an open dataset of agent trajectories under CC-BY",
    link: "https://www.theverge.com/e2e-trajectories-report",
    minutesAgo: 240,
  },
};

function rssFeed(now: Date, items: typeof ITEMS): string {
  const entries = items
    .map(
      (item) => `
    <item>
      <title>${item.title}</title>
      <link>${item.link}</link>
      <guid>${item.link}</guid>
      <pubDate>${new Date(now.getTime() - item.minutesAgo * 60_000).toUTCString()}</pubDate>
      <description>Seeded for the end-to-end database so the browser checks measure a real screen.</description>
    </item>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Seeded</title>${entries}</channel></rss>`;
}

async function main() {
  const db = getDb();
  // The REAL clock, not a pinned one: the brief window is computed per request
  // against the server's own now, so items dated relative to a frozen time
  // would seed a database whose stories are outside the window Today asks for.
  const now = new Date();

  // ENABLED sources only, which is what runIngest itself iterates — and the
  // reason is that A DEVELOPER'S DATABASE DOES NOT MATCH THE SHIPPED ONE.
  //
  // The shipped catalogue has seventeen sources and enables all of them:
  // seed-data.ts sets `enabled` on none of them and the column defaults to
  // true. The database I first ran this against had exactly ONE row in
  // `sources`, because it predates most of the catalogue and had never been
  // re-seeded. Feeds keyed on "every rss source" were therefore written for
  // sources that did not exist locally, one story arrived, and the floor below
  // caught it.
  //
  // Keying on what is actually enabled here-and-now makes the seed independent
  // of both facts: it writes the same number of stories against a full
  // catalogue, a partial one, or a developer's half-migrated copy.
  const feeds = await db
    .select()
    .from(sources)
    .where(and(eq(sources.kind, "rss"), eq(sources.enabled, true)));
  const withUrls = feeds.filter((source): source is typeof source & { url: string } =>
    Boolean(source.url),
  );
  if (withUrls.length === 0) {
    throw new Error(
      "no ENABLED rss source with a url in the catalogue — run db:seed first, " +
        "and check that something is enabled: runIngest only fetches enabled sources",
    );
  }

  // Items are dealt round-robin across whatever is enabled, so this seeds the
  // same number of stories whether the catalogue ships one source or ten.
  const routes: Record<string, string> = {};
  withUrls.forEach((source, index) => {
    const mine = ITEMS.filter((_, i) => i % withUrls.length === index);
    // THE PICKUP PAIR, and it is the only reason this seeder can produce a
    // story with MORE THAN ONE SOURCE.
    //
    // Every other item goes to exactly one feed, so every other story has one
    // source — which means the story page's whole subject, several sources
    // with roles and an order, was unreachable locally and could only be
    // typechecked. #15's acceptance names that case specifically.
    //
    // These two go to the first two feeds with DIFFERENT links and nearly the
    // same headline, which is what a real pickup looks like: the lab publishes,
    // somebody reports on it. assignStory clusters them because the titles pass
    // isSameStory (tokenJaccard >= 0.5) while the canonical URLs differ — so
    // this exercises the TITLE path rather than the trivial same-URL one, and
    // the story ends up with two raw_items from two sources.
    //
    // It is not a hand-written story row: it goes through runIngest, the real
    // normalizer and the real clusterer, exactly like everything else here.
    if (index === 0) mine.push(PICKUP.origin);
    if (index === 1) mine.push(PICKUP.report);
    routes[source.url] = rssFeed(now, mine);
  });

  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    for (const [match, body] of Object.entries(routes)) {
      if (url.includes(match) || match.includes(url)) {
        return { ok: true, status: 200, text: async () => body } as Response;
      }
    }
    // Everything else is offline on purpose: a seed that reached the network
    // would be neither deterministic nor safe to run in CI.
    return { ok: false, status: 404, text: async () => "" } as Response;
  }) as unknown as typeof fetch;

  await runIngest(db, undefined, { now, fetchImpl, sink: () => {} });
  const ranked = await rankAllStories(db, now);

  const written = await db.select({ id: stories.id, summary: stories.summary }).from(stories);

  // THE FLOOR ON THE SEED ITSELF. Without it the problem moves one step
  // earlier and gets quieter: a seed that silently wrote nothing would hand the
  // browser job the same empty screen, and the failure would once again be
  // reported by whatever ran next rather than by the thing that failed.
  if (written.length < MIN_STORIES) {
    throw new Error(
      `seeded ${written.length} stories, need at least ${MIN_STORIES} — ` +
        `the browser checks would measure an empty screen`,
    );
  }
  if (ranked.ranked < 1) {
    throw new Error(
      `seeded ${written.length} stories and ranked ${ranked.ranked} — ` +
        `an unscored story cannot appear on Today, so this would look like an empty day`,
    );
  }

  // THE CORPUS FLOOR THE BROWSER CHECKS DEPEND ON, asserted here rather than
  // discovered there.
  //
  // verify:today and verify:saved both prove that the FIVE-MINUTE reading
  // budget shortens the brief. That can only be true if the whole brief runs
  // longer than five minutes. With the original five items it ran exactly
  // five: readingMinutes is max(1, round(words / 220)) and each seeded summary
  // is short, so five items meant five minutes, the budget cut nothing, and
  // both scripts reported the reading-length preference broken on a build
  // where it worked perfectly.
  //
  // Asserting it HERE is the point. A seeder that quietly produces a corpus
  // its consumers cannot measure against turns into two confident failures
  // naming the wrong subject, in two different files, neither of which can see
  // why. This floor names the real cause once, at the place that can fix it.
  // MIRRORS THE PRODUCER RATHER THAN RE-DERIVING IT, because the first version
  // of this floor re-derived it and got a different number. It passed every
  // text into readingMinutes() as ONE array, which sums the words and rounds
  // once: eleven short stories came out as 1 minute and the floor failed a
  // corpus that was actually fine.
  //
  // The real path, src/api/stories.ts:213, computes each story's minutes from
  // its SUMMARY ALONE — `readingMinutes([s.summary ?? excerpt ?? ""])` — where
  // the max(1, …) floors every story at one minute. The brief then SUMS those
  // per-story values (brief-server.ts:50, api/brief/route.ts:51). Summing
  // eleven ones is eleven; rounding their combined word count is one. Same
  // function, same inputs, different answer, and only one of them is what a
  // reader's budget is measured against.
  const totalMinutes = written.reduce(
    (total, story) => total + readingMinutes([story.summary ?? ""]),
    0,
  );
  if (totalMinutes <= LONGEST_FINITE_BUDGET_MINUTES) {
    throw new Error(
      `the seeded brief runs ${totalMinutes} minute(s), which the ${LONGEST_FINITE_BUDGET_MINUTES}-minute ` +
        `reading budget cannot shorten — verify:today's "ten-minute brief did not shorten the list" ` +
        `and verify:saved's preference check would both fail, and both would blame the product. ` +
        `ADD ITEMS TO ITEMS ABOVE. Do not lower this floor: it is derived from BRIEF_LENGTHS so that ` +
        `every budget the reader can choose is one the corpus can actually exercise.`,
    );
  }

  console.log(
    JSON.stringify(
      {
        seeded: written.length,
        scored: ranked.ranked,
        minimum: MIN_STORIES,
        briefMinutes: totalMinutes,
        longestFiniteBudget: LONGEST_FINITE_BUDGET_MINUTES,
      },
      null,
      2,
    ),
  );
}

// main().then(...) rather than top-level await: tsx transpiles these scripts to
// CJS, where top-level await is a build error rather than a runtime one — so
// the script would not have run at all. The connection is closed in BOTH
// branches, because the worker's non-exiting-process defect is ticketed and
// this script must not inherit it.
main()
  .then(async () => {
    await getSql().end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    await getSql().end();
    process.exit(1);
  });
