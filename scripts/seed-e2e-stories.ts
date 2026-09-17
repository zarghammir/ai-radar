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
import { sources, stories } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/** Enough for the browser scripts, which ask for three ids and a brief. */
const MIN_STORIES = 4;

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
];

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

  const written = await db.select({ id: stories.id }).from(stories);

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

  console.log(
    JSON.stringify(
      { seeded: written.length, scored: ranked.ranked, minimum: MIN_STORIES },
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
