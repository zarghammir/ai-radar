import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { matchedAiVocabulary } from "@/pipeline/normalize/ai-vocabulary";
import { SOURCE_SEEDS } from "@/db/seed-data";
import { TRUNCATE_ALL } from "@/db/tables";
import { rawItems, sources, stories, storyTopics, topics, ingestRuns } from "@/db/schema";
import { deriveVerification } from "./clustering/verification";
import { rankStory } from "./ranking/score";
import { CANDIDATE_LIMIT, assignStory, refreshStory, runIngest, storySources } from "./run";
import { describeEmptyPass, exitCodeFor } from "@/worker/report";
import { matchesAnyKeyword } from "./normalize/keywords";

/**
 * These run against a real Postgres, on a database of their own.
 *
 * Its own database rather than the configured one because the suite truncates
 * between tests: pointed at a developer's database it would silently delete
 * their seeded catalogue, which is not something `npm test` should do.
 */
const TEST_DB = "ai_radar_pipeline_test";
const configured = process.env.DATABASE_URL;

// A skip that CI can trigger is a suite that agrees with itself while running
// nothing, so CI is not allowed to reach the skip.
if (!configured && process.env.CI) {
  throw new Error("CI must set DATABASE_URL; refusing to skip the pipeline tests silently");
}

if (!configured) {
  // Skipping quietly is how a suite ends up agreeing with itself while running
  // nothing. Say so where it cannot be missed.
  console.warn(
    "\n!! DATABASE_URL is not set: the pipeline tests did NOT run.\n" +
      "!! Copy .env.example to .env and point DATABASE_URL at a local Postgres.\n",
  );
}

const withDb = configured ? describe : describe.skip;

function urlFor(database: string): string {
  const u = new URL(configured!);
  u.pathname = `/${database}`;
  return u.toString();
}

const NOW = new Date("2026-09-16T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toUTCString();

// ── Fake services ────────────────────────────────────────────────────────────

interface FeedItem {
  title: string;
  link: string;
  date: string;
  description?: string;
}

const rssFeed = (items: FeedItem[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Test feed</title>` +
  items
    .map(
      (i) =>
        `<item><title>${i.title}</title><link>${i.link}</link><guid>${i.link}</guid>` +
        `<pubDate>${i.date}</pubDate><description>${i.description ?? ""}</description></item>`,
    )
    .join("") +
  `</channel></rss>`;

const atomFeed = (entries: { id: string; title: string; summary: string; published: string }[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">` +
  entries
    .map(
      (e) =>
        `<entry><id>${e.id}</id><title>${e.title}</title><summary>${e.summary}</summary>` +
        `<published>${e.published}</published><updated>${e.published}</updated>` +
        `<author><name>A Researcher</name></author>` +
        `<link href="${e.id}" rel="alternate" type="text/html"/><category term="cs.AI"/></entry>`,
    )
    .join("") +
  `</feed>`;

interface HnStory {
  id: number;
  title: string;
  url?: string;
  score?: number;
  time?: number;
}

/** Serves whatever each test needs, and records nothing else. */
function fakeNetwork(routes: Record<string, string>, failUrls: string[] = []) {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (failUrls.some((f) => url.includes(f))) {
      return { ok: false, status: 500, text: async () => "" } as Response;
    }
    for (const [match, body] of Object.entries(routes)) {
      if (url.includes(match)) return { ok: true, status: 200, text: async () => body } as Response;
    }
    return { ok: false, status: 404, text: async () => "" } as Response;
  }) as unknown as typeof fetch;
}

function hnRoutes(list: HnStory[]): Record<string, string> {
  const routes: Record<string, string> = {
    // Keyed on the shared suffix so the same builder serves topstories.json
    // and showstories.json — fakeNetwork matches on `includes`.
    "stories.json": JSON.stringify(list.map((s) => s.id)),
  };
  for (const s of list) {
    routes[`/item/${s.id}.json`] = JSON.stringify({
      id: s.id,
      type: "story",
      title: s.title,
      url: s.url,
      by: "someone",
      time: Math.floor((s.time ?? NOW.getTime() - 3_600_000) / 1000),
      score: s.score ?? 200,
      descendants: 40,
    });
  }
  return routes;
}

withDb("pipeline orchestration", () => {
  let admin: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;
  let db: Db;

  beforeAll(async () => {
    admin = postgres(urlFor("postgres"), { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
    sql = postgres(urlFor(TEST_DB), { max: 4, onnotice: () => {} });
    db = drizzle(sql, { schema }) as unknown as Db;
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`).catch(() => {});
    await admin?.end();
  });

  beforeEach(async () => {
    await sql.unsafe(TRUNCATE_ALL);
  });

  async function addSource(over: Partial<typeof sources.$inferInsert> & { key: string }) {
    const [row] = await db
      .insert(sources)
      .values({
        name: over.key,
        kind: "rss",
        tier: "HIGH_QUALITY_REPORTING",
        url: `https://${over.key}.test/feed`,
        homepage: `https://${over.key}.test`,
        defaultContentType: "NEWS",
        ...over,
      })
      .returning();
    return row;
  }

  const GPT6_URL = "https://openai.com/index/gpt-6/";

  async function openAiBlog() {
    return addSource({
      key: "openai-blog",
      name: "OpenAI",
      tier: "PRIMARY",
      defaultContentType: "NEWS",
    });
  }
  async function hackerNews() {
    return addSource({
      key: "hackernews-ai",
      name: "Hacker News",
      kind: "hackernews",
      tier: "COMMUNITY",
      url: null,
    });
  }

  // ── The ticket's expected output ───────────────────────────────────────────

  it("makes a blog post and its Hacker News thread one story", async () => {
    await openAiBlog();
    await hackerNews();
    const routes = {
      "openai-blog.test/feed": rssFeed([
        {
          title: "Introducing GPT-6",
          link: GPT6_URL,
          date: hoursAgo(2),
          description: "A new model.",
        },
      ]),
      // Deliberately unlike the blog headline: if these two titles were similar
      // the title rule would join them and this test would pass without ever
      // exercising the URL rule it exists to cover.
      ...hnRoutes([
        {
          id: 1,
          title: "Everyone is talking about the new model",
          url: `${GPT6_URL}?utm_source=hn`,
        },
      ]),
    };

    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(routes), sink: () => {} });

    const allStories = await db.select().from(stories);
    expect(allStories).toHaveLength(1);
    expect(allStories[0].sourceCount).toBe(2);
    expect(allStories[0].verification).toBe("PRIMARY_SOURCE");
    expect(allStories[0].verificationNote).toContain("OpenAI");

    const items = await db.select().from(rawItems).where(eq(rawItems.storyId, allStories[0].id));
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.role).sort()).toEqual(["discussion", "primary"]);
  });

  it("keeps two different announcements from one source apart", async () => {
    await openAiBlog();
    const routes = {
      "openai-blog.test/feed": rssFeed([
        { title: "Introducing GPT-6", link: GPT6_URL, date: hoursAgo(2) },
        {
          title: "OpenAI hires a new finance chief",
          link: "https://openai.com/index/cfo/",
          date: hoursAgo(3),
        },
      ]),
    };
    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(routes), sink: () => {} });
    expect(await db.select().from(stories)).toHaveLength(2);
  });

  it("changes no story ids when it runs again", async () => {
    await openAiBlog();
    await hackerNews();
    const routes = {
      "openai-blog.test/feed": rssFeed([
        { title: "Introducing GPT-6", link: GPT6_URL, date: hoursAgo(2) },
        {
          title: "OpenAI hires a new finance chief",
          link: "https://openai.com/index/cfo/",
          date: hoursAgo(3),
        },
      ]),
      ...hnRoutes([{ id: 1, title: "Introducing GPT-6 from OpenAI", url: GPT6_URL }]),
    };
    const opts = { now: NOW, fetchImpl: fakeNetwork(routes), sink: () => {} };

    await runIngest(db, undefined, opts);
    const first = (await db.select().from(stories))
      .map((s) => ({ id: s.id, slug: s.slug }))
      .sort((a, b) => a.id - b.id);
    const firstItems = (await db.select().from(rawItems)).length;

    const second = await runIngest(db, undefined, opts);
    const after = (await db.select().from(stories))
      .map((s) => ({ id: s.id, slug: s.slug }))
      .sort((a, b) => a.id - b.id);

    expect(first.length).toBeGreaterThan(0);
    expect(after).toEqual(first);
    expect((await db.select().from(rawItems)).length).toBe(firstItems);
    expect(second.itemsInserted).toBe(0);
    expect(second.storiesCreated).toBe(0);
  });

  // ── Clustering rules ──────────────────────────────────────────────────────

  it("does not fold an item into a story that went quiet more than 72 hours ago", async () => {
    const blog = await openAiBlog();
    const [old] = await db
      .insert(stories)
      .values({
        slug: "introducing-gpt-6",
        title: "Introducing GPT-6",
        contentType: "NEWS",
        firstSeenAt: new Date(NOW.getTime() - 200 * 3_600_000),
        lastActivityAt: new Date(NOW.getTime() - 100 * 3_600_000),
      })
      .returning();

    const [item] = await db
      .insert(rawItems)
      .values({
        sourceId: blog.id,
        externalId: "late",
        url: "https://example.com/late",
        canonicalUrl: "https://example.com/late",
        title: "Introducing GPT-6",
        publishedAt: NOW,
        fetchedAt: NOW,
        contentType: "NEWS",
        fingerprint: "late-fingerprint",
      })
      .returning();

    const assigned = await db.transaction((tx) => assignStory(tx, item, NOW));
    expect(assigned.created).toBe(true);
    expect(assigned.storyId).not.toBe(old.id);
  });

  it("does not let a paper and a news report cluster on title alone", async () => {
    await addSource({
      key: "arxiv-ai",
      name: "arXiv",
      kind: "arxiv",
      tier: "PRIMARY",
      url: null,
      defaultContentType: "PAPER",
    });
    await addSource({ key: "verge-ai", name: "The Verge", tier: "HIGH_QUALITY_REPORTING" });
    const title = "Scaling Laws For Agentic Retrieval Systems";
    const routes = {
      "export.arxiv.org": atomFeed([
        {
          id: "http://arxiv.org/abs/2509.11111v1",
          title,
          summary: "We study scaling.",
          published: NOW.toISOString(),
        },
      ]),
      "verge-ai.test/feed": rssFeed([
        { title, link: "https://verge.test/scaling-laws", date: hoursAgo(1) },
      ]),
    };
    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(routes), sink: () => {} });

    const rows = await db.select().from(stories);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.contentType).sort()).toEqual(["NEWS", "PAPER"]);
  });

  it("joins a paper and a report when they share a canonical url", async () => {
    // The URL rule outranks the content family, which is what "unless
    // URL-matched" means: the same page is the same thing.
    await addSource({
      key: "arxiv-ai",
      name: "arXiv",
      kind: "arxiv",
      tier: "PRIMARY",
      url: null,
      defaultContentType: "PAPER",
    });
    await hackerNews();
    const routes = {
      "export.arxiv.org": atomFeed([
        {
          id: "http://arxiv.org/abs/2509.22222v1",
          title: "A Study Of Agentic Retrieval",
          summary: "We study retrieval.",
          published: NOW.toISOString(),
        },
      ]),
      ...hnRoutes([
        {
          id: 7,
          title: "A Study Of Agentic Retrieval (LLM paper)",
          url: "https://arxiv.org/abs/2509.22222",
        },
      ]),
    };
    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(routes), sink: () => {} });

    const rows = await db.select().from(stories);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceCount).toBe(2);
  });

  it("counts one source once when it files two items on the same story", async () => {
    // Without de-duplication this story would report two sources and the
    // verification would read CORROBORATED, which is the defect the single
    // source array exists to prevent.
    await addSource({ key: "verge-ai", name: "The Verge", tier: "HIGH_QUALITY_REPORTING" });
    const routes = {
      "verge-ai.test/feed": rssFeed([
        {
          title: "OpenAI launches GPT-6, its most capable model",
          link: "https://verge.test/a",
          date: hoursAgo(2),
        },
        {
          title: "OpenAI launches GPT-6 model, what it means",
          link: "https://verge.test/b",
          date: hoursAgo(1),
        },
      ]),
    };
    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(routes), sink: () => {} });

    const rows = await db.select().from(stories);
    expect(rows).toHaveLength(1);
    const items = await db.select().from(rawItems).where(eq(rawItems.storyId, rows[0].id));
    expect(items).toHaveLength(2);
    expect(rows[0].sourceCount).toBe(1);
    expect(rows[0].verification).toBe("EMERGING");
  });

  // ── Verification, ranking and the single source array ─────────────────────

  it("hands deriveVerification and rankStory the very same array", async () => {
    await openAiBlog();
    await hackerNews();
    const routes = {
      "openai-blog.test/feed": rssFeed([
        { title: "Introducing GPT-6", link: GPT6_URL, date: hoursAgo(2) },
      ]),
      ...hnRoutes([{ id: 1, title: "Introducing GPT-6 from OpenAI", url: GPT6_URL }]),
    };
    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(routes), sink: () => {} });
    const [story] = await db.select().from(stories);

    const attached = await db.transaction((tx) => storySources(tx, story.id));
    expect(attached).toHaveLength(2);

    // One array, both consumers, no mapping step in between. This is the seam
    // where one module once counted items while the other counted outlets.
    expect(deriveVerification(attached).level).toBe(story.verification);
    const ranked = rankStory(
      {
        lastActivityAt: story.lastActivityAt,
        contentType: story.contentType,
        sources: attached,
        // The stored level, so this really is the story's own data going into
        // both functions rather than a constant standing in for it.
        verification: story.verification,
        topicKeys: [],
        userTopicKeys: [],
      },
      NOW,
    );
    expect(Number.isFinite(ranked.score)).toBe(true);
    expect(ranked.components.primarySource).toBeGreaterThan(0);
  });

  it("names the primary item and prefers a first-party source for it", async () => {
    await openAiBlog();
    await hackerNews();
    const routes = {
      "openai-blog.test/feed": rssFeed([
        { title: "Introducing GPT-6", link: GPT6_URL, date: hoursAgo(1) },
      ]),
      // Older than the blog post, so "earliest" alone would pick this one.
      ...hnRoutes([
        {
          id: 1,
          title: "Introducing GPT-6 from OpenAI",
          url: GPT6_URL,
          time: NOW.getTime() - 5 * 3_600_000,
        },
      ]),
    };
    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(routes), sink: () => {} });

    const [story] = await db.select().from(stories);
    const primary = (
      await db.select().from(rawItems).where(eq(rawItems.id, story.primaryItemId!))
    )[0];
    const blogSource = (await db.select().from(sources).where(eq(sources.key, "openai-blog")))[0];
    expect(primary.sourceId).toBe(blogSource.id);
  });

  // ── Topics ────────────────────────────────────────────────────────────────

  it("tags a story from the topic keywords", async () => {
    await openAiBlog();
    const [openaiTopic] = await db
      .insert(topics)
      .values({ key: "openai", name: "OpenAI", group: "company", keywords: ["openai", "gpt-6"] })
      .returning();
    await db.insert(topics).values({
      key: "robotics",
      name: "Robotics",
      group: "domain",
      keywords: ["humanoid", "robotics"],
    });

    const routes = {
      "openai-blog.test/feed": rssFeed([
        {
          title: "Introducing GPT-6",
          link: GPT6_URL,
          date: hoursAgo(2),
          description: "OpenAI ships a model.",
        },
      ]),
    };
    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(routes), sink: () => {} });

    const [story] = await db.select().from(stories);
    const tags = await db.select().from(storyTopics).where(eq(storyTopics.storyId, story.id));
    expect(tags.map((t) => t.topicId)).toEqual([openaiTopic.id]);
  });

  // ── A late primary item takes over the story ──────────────────────────────

  it("lets a blog post arriving after the forum thread take over the story", async () => {
    // Review scenario A. Sources run in table order, so a thread that beats the
    // post to the feed creates the story, and everything derived from the
    // primary item has to follow when the post lands.
    await hackerNews();
    const hn = {
      ...hnRoutes([
        {
          id: 1,
          title: "Everyone is talking about the new model",
          url: GPT6_URL,
          time: NOW.getTime() - 1 * 3_600_000,
        },
      ]),
    };
    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(hn), sink: () => {} });

    const afterRunOne = (await db.select().from(stories))[0];
    expect(afterRunOne.title).toBe("Everyone is talking about the new model");

    await addSource({
      key: "openai-blog",
      name: "OpenAI",
      tier: "PRIMARY",
      defaultContentType: "RELEASE",
    });
    const both = {
      ...hn,
      "openai-blog.test/feed": rssFeed([
        { title: "Introducing GPT-6", link: GPT6_URL, date: hoursAgo(3) },
      ]),
    };
    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(both), sink: () => {} });

    const rows = await db.select().from(stories);
    expect(rows).toHaveLength(1);
    const story = rows[0];
    expect(story.sourceCount).toBe(2);
    expect(story.verification).toBe("PRIMARY_SOURCE");
    // The story's face, its type and when it began must all follow the item
    // that is now primary, not the one that happened to arrive first.
    expect(story.title).toBe("Introducing GPT-6");
    // MODEL rather than the blog's RELEASE default: since #41 the primary
    // item's type is classified from its own title, and "Introducing GPT-6" is
    // a model launch. What this line is here to prove is unchanged — that the
    // type follows the item that is now primary — so it also asserts the type
    // is no longer the one the forum item gave the story.
    expect(story.contentType).toBe("MODEL");
    expect(story.contentType).not.toBe(afterRunOne.contentType);
    expect(story.firstSeenAt.getTime()).toBe(NOW.getTime() - 3 * 3_600_000);
    // The slug is the permalink and deliberately does not move.
    expect(story.slug).toBe("everyone-is-talking-about-the-new-model");
  });

  it("makes a paper first seen through a forum link a paper story", async () => {
    // The family check reads the story's content type, so if that stays frozen
    // at the forum item's type a paper absorbs news reports forever after.
    const ARXIV_URL = "https://arxiv.org/abs/2509.33333";
    await hackerNews();
    const hn = hnRoutes([
      {
        id: 9,
        title: "A neural approach to retrieval agents",
        url: ARXIV_URL,
        time: NOW.getTime() - 3_600_000,
      },
    ]);
    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(hn), sink: () => {} });
    expect((await db.select().from(stories))[0].contentType).toBe("NEWS");

    await addSource({
      key: "arxiv-ai",
      name: "arXiv",
      kind: "arxiv",
      tier: "PRIMARY",
      url: null,
      defaultContentType: "PAPER",
    });
    const withPaper = {
      ...hn,
      "export.arxiv.org": atomFeed([
        {
          id: `http://arxiv.org/abs/2509.33333v1`,
          title: "A Neural Approach To Retrieval Agents",
          summary: "We study retrieval.",
          published: new Date(NOW.getTime() - 4 * 3_600_000).toISOString(),
        },
      ]),
    };
    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(withPaper), sink: () => {} });

    const afterPaper = await db.select().from(stories);
    expect(afterPaper).toHaveLength(1);
    expect(afterPaper[0].contentType).toBe("PAPER");

    // Now a news report with the same headline must not join it.
    await addSource({ key: "verge-ai", name: "The Verge", tier: "HIGH_QUALITY_REPORTING" });
    const withNews = {
      ...withPaper,
      "verge-ai.test/feed": rssFeed([
        {
          title: "A Neural Approach To Retrieval Agents",
          link: "https://verge.test/neural",
          date: hoursAgo(1),
        },
      ]),
    };
    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(withNews), sink: () => {} });

    const finalRows = await db.select().from(stories);
    expect(finalRows).toHaveLength(2);
    expect(finalRows.map((r) => r.contentType).sort()).toEqual(["NEWS", "PAPER"]);
  });

  it("compares against the most recently active stories when there are more than the cap", async () => {
    // Review scenario E. This test is the control for removing the orderBy on
    // the candidate query: without it the cap takes an arbitrary 300 rows and
    // the matching story is missed even though it is open and in the window.
    const blog = await openAiBlog();
    const filler = Array.from({ length: CANDIDATE_LIMIT + 20 }, (_, i) => ({
      slug: `unrelated-${i}`,
      title: `Unrelated filler subject number ${i}`,
      contentType: "NEWS" as const,
      firstSeenAt: new Date(NOW.getTime() - 10 * 3_600_000),
      lastActivityAt: new Date(NOW.getTime() - (10 * 3_600_000 - i * 1000)),
    }));
    await db.insert(stories).values(filler);
    // The match is the most recently active, so ordering finds it first and an
    // arbitrary 300 rows does not reach it.
    const [match] = await db
      .insert(stories)
      .values({
        slug: "introducing-gpt-6",
        title: "Introducing GPT-6",
        contentType: "NEWS",
        firstSeenAt: new Date(NOW.getTime() - 2 * 3_600_000),
        lastActivityAt: new Date(NOW.getTime() - 60_000),
      })
      .returning();

    const [item] = await db
      .insert(rawItems)
      .values({
        sourceId: blog.id,
        externalId: "late-match",
        url: "https://example.com/late-match",
        canonicalUrl: "https://example.com/late-match",
        title: "Introducing GPT-6",
        publishedAt: NOW,
        fetchedAt: NOW,
        contentType: "NEWS",
        fingerprint: "late-match-fingerprint",
      })
      .returning();

    const assigned = await db.transaction((tx) => assignStory(tx, item, NOW));
    expect(assigned.created).toBe(false);
    expect(assigned.storyId).toBe(match.id);
  });

  it("tags a vaguely titled first-party post from its source's default topic", async () => {
    // Tagging reads the primary item's text only, so a post titled
    // "Introducing our new model" matches no keyword and would otherwise carry
    // no company topic at all — the gap found during the pipeline ticket.
    const [openaiTopic] = await db
      .insert(topics)
      .values({ key: "openai", name: "OpenAI", group: "company", keywords: ["openai", "chatgpt"] })
      .returning();
    await db
      .insert(topics)
      .values({ key: "robotics", name: "Robotics", group: "domain", keywords: ["humanoid"] });
    await addSource({
      key: "openai-blog",
      name: "OpenAI",
      tier: "PRIMARY",
      config: { topicKeys: ["openai"] },
    });

    const routes = {
      "openai-blog.test/feed": rssFeed([
        {
          title: "Introducing our new model",
          link: GPT6_URL,
          date: hoursAgo(2),
          description: "Available today.",
        },
      ]),
    };
    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(routes), sink: () => {} });

    const [story] = await db.select().from(stories);
    // The control that this is the default and not a lucky keyword hit.
    expect(story.title).toBe("Introducing our new model");
    expect(matchesAnyKeyword(story.title, ["openai", "chatgpt"])).toBe(false);

    const tags = await db.select().from(storyTopics).where(eq(storyTopics.storyId, story.id));
    expect(tags.map((t) => t.topicId)).toEqual([openaiTopic.id]);
  });

  it("does not let a forum thread add its own topics to a story", async () => {
    const [openaiTopic] = await db
      .insert(topics)
      .values({ key: "openai", name: "OpenAI", group: "company", keywords: ["openai"] })
      .returning();
    await db.insert(topics).values({
      key: "agents",
      name: "Agents",
      group: "domain",
      keywords: ["agentic", "ai agent"],
    });
    await addSource({
      key: "openai-blog",
      name: "OpenAI",
      tier: "PRIMARY",
      config: { topicKeys: ["openai"] },
    });
    // Given a default of its own, which must be ignored: defaults come from the
    // primary item's source, not from whichever sources happen to be attached.
    await addSource({
      key: "hackernews-ai",
      name: "Hacker News",
      kind: "hackernews",
      tier: "COMMUNITY",
      url: null,
      config: { topicKeys: ["agents"] },
    });

    const routes = {
      "openai-blog.test/feed": rssFeed([
        { title: "Introducing our new model", link: GPT6_URL, date: hoursAgo(2) },
      ]),
      // The forum headline mentions agents; the blog post does not.
      ...hnRoutes([{ id: 1, title: "This is an agentic model, apparently", url: GPT6_URL }]),
    };
    await runIngest(db, undefined, { now: NOW, fetchImpl: fakeNetwork(routes), sink: () => {} });

    const [story] = await db.select().from(stories);
    expect(story.sourceCount).toBe(2);
    const tags = await db.select().from(storyTopics).where(eq(storyTopics.storyId, story.id));
    expect(tags.map((t) => t.topicId)).toEqual([openaiTopic.id]);
  });

  // ── Failure reporting ─────────────────────────────────────────────────────

  it("reports a Hacker News item it could not fetch through the log", async () => {
    await hackerNews();
    const lines: string[] = [];
    const routes = hnRoutes([
      { id: 1, title: "Introducing GPT-6 from OpenAI", url: GPT6_URL },
      { id: 2, title: "Another LLM story", url: "https://example.com/2" },
    ]);
    await runIngest(db, undefined, {
      now: NOW,
      fetchImpl: fakeNetwork(routes, ["/item/2.json"]),
      sink: (l) => lines.push(l),
    });

    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join("\n");
    expect(joined).toContain("hackernews-ai");
    expect(joined).toContain("2");
    expect(joined).toContain("failed");
    // The story that did resolve is still stored: a partial failure is not a
    // reason to drop the rest of the run.
    expect(await db.select().from(stories)).toHaveLength(1);
  });

  it("records a failed source on its ingest run without stopping the others", async () => {
    await openAiBlog();
    await addSource({ key: "broken", name: "Broken", url: "https://broken.test/feed" });
    const routes = {
      "openai-blog.test/feed": rssFeed([
        { title: "Introducing GPT-6", link: GPT6_URL, date: hoursAgo(2) },
      ]),
    };
    const result = await runIngest(db, undefined, {
      now: NOW,
      fetchImpl: fakeNetwork(routes),
      sink: () => {},
    });

    expect(result.bySource.find((s) => s.sourceKey === "broken")?.error).toContain("404");
    expect(result.bySource.find((s) => s.sourceKey === "openai-blog")?.error).toBeNull();
    expect(await db.select().from(stories)).toHaveLength(1);

    const runs = await db.select().from(ingestRuns);
    expect(runs).toHaveLength(2);
    const broken = runs.find((r) => r.error !== null);
    expect(broken?.error).toContain("404");
    expect(broken?.finishedAt).not.toBeNull();

    const brokenSource = (await db.select().from(sources).where(eq(sources.key, "broken")))[0];
    expect(brokenSource.lastError).toContain("404");
    expect(brokenSource.lastFetchedAt).not.toBeNull();
  });

  it("stores the database's own reason when a write fails, not just the statement", async () => {
    // A fake 404 never reaches the database. This makes the failure happen
    // inside Postgres, which is where drizzle wraps the real cause in a
    // message that is only the SQL.
    await openAiBlog();
    await db
      .insert(topics)
      .values({ key: "openai", name: "OpenAI", group: "company", keywords: ["openai", "gpt-6"] });
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION cr30_boom() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'cr30 boom'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER cr30_boom_trigger BEFORE INSERT ON story_topics
      FOR EACH ROW EXECUTE FUNCTION cr30_boom();
    `);

    try {
      const routes = {
        "openai-blog.test/feed": rssFeed([
          {
            title: "Introducing GPT-6",
            link: GPT6_URL,
            date: hoursAgo(2),
            description: "OpenAI ships a model.",
          },
        ]),
      };
      const result = await runIngest(db, undefined, {
        now: NOW,
        fetchImpl: fakeNetwork(routes),
        sink: () => {},
      });

      // The item's transaction rolled back, so nothing is half-written.
      expect(await db.select().from(stories)).toHaveLength(0);
      expect(await db.select().from(rawItems)).toHaveLength(0);

      // And the stored reason says what the database objected to, not only
      // which statement was running when it did.
      const reason = result.bySource[0].error ?? "";
      expect(reason).toContain("cr30 boom");

      const [run] = await db.select().from(ingestRuns);
      expect(run.error).toContain("cr30 boom");
      expect(run.itemsFetched).toBe(1);
      expect(run.itemsNew).toBe(0);

      const [source] = await db.select().from(sources).where(eq(sources.key, "openai-blog"));
      expect(source.lastError).toContain("cr30 boom");
    } finally {
      await sql.unsafe(`DROP TRIGGER IF EXISTS cr30_boom_trigger ON story_topics`);
      await sql.unsafe(`DROP FUNCTION IF EXISTS cr30_boom()`);
    }
  });

  it("only runs the sources it was asked for", async () => {
    const blog = await openAiBlog();
    await addSource({ key: "verge-ai", name: "The Verge" });
    const routes = {
      "openai-blog.test/feed": rssFeed([
        { title: "Introducing GPT-6", link: GPT6_URL, date: hoursAgo(2) },
      ]),
      "verge-ai.test/feed": rssFeed([
        { title: "Something else entirely", link: "https://verge.test/x", date: hoursAgo(2) },
      ]),
    };
    const result = await runIngest(db, [blog.id], {
      now: NOW,
      fetchImpl: fakeNetwork(routes),
      sink: () => {},
    });
    expect(result.bySource.map((s) => s.sourceKey)).toEqual(["openai-blog"]);
    expect(await db.select().from(stories)).toHaveLength(1);
  });

  it("skips a disabled source", async () => {
    await openAiBlog();
    await addSource({ key: "verge-ai", name: "The Verge", enabled: false });
    const routes = {
      "openai-blog.test/feed": rssFeed([
        { title: "Introducing GPT-6", link: GPT6_URL, date: hoursAgo(2) },
      ]),
      "verge-ai.test/feed": rssFeed([
        { title: "Something else entirely", link: "https://verge.test/x", date: hoursAgo(2) },
      ]),
    };
    const result = await runIngest(db, undefined, {
      now: NOW,
      fetchImpl: fakeNetwork(routes),
      sink: () => {},
    });
    expect(result.bySource.map((s) => s.sourceKey)).toEqual(["openai-blog"]);
  });

  // ── #104 ───────────────────────────────────────────────────────────────────
  // exitCodeFor's unit tests cover the DECISION. These cover the FACT reaching
  // it: whether runIngest actually counts the catalogue correctly. That is the
  // composition, and it is the part a unit test cannot see.
  describe("the catalogue counts an empty pass needs to explain itself", () => {
    it("counts what EXISTS, not what ran", async () => {
      await openAiBlog(); // enabled
      await addSource({ key: "verge-ai", name: "The Verge", enabled: false });

      const r = await runIngest(db, undefined, {
        now: NOW,
        fetchImpl: fakeNetwork({}),
        sink: () => {},
      });

      expect(r.bySource).toHaveLength(1); // only the enabled one RAN
      expect(r.sourcesConfigured).toBe(2); // both EXIST
      expect(r.sourcesEnabled).toBe(1);
    });

    it("a fully switched-off catalogue is an empty pass that FAILS", async () => {
      await addSource({ key: "a", enabled: false });
      await addSource({ key: "b", enabled: false });

      const r = await runIngest(db, undefined, {
        now: NOW,
        fetchImpl: fakeNetwork({}),
        sink: () => {},
      });

      expect(r.bySource).toHaveLength(0);
      expect(r.sourcesConfigured).toBe(2);
      expect(r.sourcesEnabled).toBe(0);
      expect(exitCodeFor(r)).toBe(1);
      expect(describeEmptyPass(r)).toContain("0 of 2");
    });

    it("re-enabling one source returns the same catalogue to green", async () => {
      await addSource({ key: "alpha", enabled: false });
      await addSource({ key: "beta", enabled: false });

      // The re-enabled source is given a WORKING feed on purpose, and the
      // first version of this test did not do that. Re-enabling a source makes
      // it RUN, and a source that runs and fails is exit 1 for a completely
      // different and legitimate reason — "every source failed". The control
      // then passed while isolating nothing, because both halves were red for
      // unrelated causes. It has to end genuinely green or it does not show
      // that the COUNT was what made the first half red.
      const routes = {
        "alpha.test/feed": rssFeed([
          { title: "Alpha ships something", link: "https://alpha.test/1", date: hoursAgo(2) },
        ]),
      };

      const off = await runIngest(db, undefined, {
        now: NOW,
        fetchImpl: fakeNetwork(routes),
        sink: () => {},
      });
      expect(off.bySource).toHaveLength(0);
      expect(exitCodeFor(off)).toBe(1);

      await db.update(sources).set({ enabled: true }).where(eq(sources.key, "alpha"));
      const on = await runIngest(db, undefined, {
        now: NOW,
        fetchImpl: fakeNetwork(routes),
        sink: () => {},
      });
      expect(on.sourcesEnabled).toBe(1);
      expect(on.bySource).toHaveLength(1);
      expect(on.bySource[0].error).toBeNull(); // it really succeeded
      expect(exitCodeFor(on)).toBe(0);
    });

    it("an UNSEEDED catalogue stays green, which is the case that gets checks deleted", async () => {
      const r = await runIngest(db, undefined, {
        now: NOW,
        fetchImpl: fakeNetwork({}),
        sink: () => {},
      });

      expect(r.sourcesConfigured).toBe(0);
      expect(exitCodeFor(r)).toBe(0);
      expect(describeEmptyPass(r)).toContain("no sources are seeded");
    });
  });

  // ── #99 ────────────────────────────────────────────────────────────────────
  // Asserted at the point the value is WRITTEN, not at the API that serves it.
  // GET /api/sources is one consumer; #86's health reads the same row, and the
  // next consumer will not know to check. The property has to hold at the write
  // or every reader has to remember it.
  it("writes no credential fragment into lastError when a pass fails", async () => {
    await openAiBlog();

    const configuredUrl = new URL(process.env.DATABASE_URL!);
    const fragments = [
      configuredUrl.hostname,
      configuredUrl.port,
      configuredUrl.username,
      configuredUrl.password,
      configuredUrl.pathname.replace(/^\//, ""),
    ].filter((v) => v.length >= 3);

    // FLOOR on the instrument itself: if the configured URL yielded nothing
    // long enough to redact, every assertion below would pass vacuously.
    expect(fragments.length).toBeGreaterThan(0);

    // The shape postgres.js produces when a socket dies mid-pass: the
    // coordinates are in the MESSAGE, which is how they reached the stored
    // string. Thrown from fetch so it lands in the same per-source try that
    // wraps the database work.
    const boom = `write CONNECT_TIMEOUT ${configuredUrl.hostname}:${configuredUrl.port || "5432"}`;
    expect(fragments.some((f) => boom.includes(f))).toBe(true); // the input really carries one

    const failing = (async () => {
      throw new Error(boom);
    }) as unknown as typeof fetch;

    await runIngest(db, undefined, { now: NOW, fetchImpl: failing, sink: () => {} });

    const [row] = await db.select().from(sources).where(eq(sources.key, "openai-blog"));
    expect(row.lastError).toBeTruthy(); // something was stored, so this is not vacuous
    for (const fragment of fragments) expect(row.lastError).not.toContain(fragment);
    // The positive: an operator can still tell what happened.
    expect(row.lastError).toContain("CONNECT_TIMEOUT");

    // ingestRuns.error is the same string plus the fetch context's log tail,
    // and the tail does not pass through describeError — so it is redacted
    // again at the write. This is the assertion that would catch a contributor
    // logging something new into that context.
    const runs = await db.select().from(ingestRuns);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      for (const fragment of fragments) expect(run.error ?? "").not.toContain(fragment);
    }
  });

  // ── Adjacent tech: kept, not shown by default (#71) ────────────────────────

  describe("a source that labels instead of gating", () => {
    const TITLE = "Show HN: A tiny Postgres migration runner";

    it("STORES a non-AI item and marks its story adjacent tech", async () => {
      // The half of the acceptance that gets skipped. Testing only that the
      // filter hides it cannot tell a working filter from an item that was
      // never stored at all — which is the bug this ticket exists to fix.
      expect(matchedAiVocabulary(TITLE), "fixture must genuinely not match").toBe(false);

      await addSource({
        key: "hn-discovery",
        name: "Show HN",
        kind: "hackernews",
        tier: "COMMUNITY",
        url: null,
        config: { list: "top", minPoints: 3, keywordPolicy: "label" },
      });
      await runIngest(db, undefined, {
        now: NOW,
        fetchImpl: fakeNetwork(hnRoutes([{ id: 1, title: TITLE, url: "https://example.com/pg" }])),
        sink: () => {},
      });

      const items = await db.select().from(schema.rawItems);
      expect(items).toHaveLength(1);
      expect(items[0].matchedAiVocabulary).toBe(false);

      const [story] = await db.select().from(schema.stories);
      expect(story.adjacentTech).toBe(true);
    });

    it("still discards the same item when the source gates", async () => {
      // The control that the POLICY is doing the work. Without it the test
      // above would pass just as well if the gate had been removed outright,
      // which would empty the front door instead of widening the back one.
      await hackerNews();
      await runIngest(db, undefined, {
        now: NOW,
        fetchImpl: fakeNetwork(hnRoutes([{ id: 1, title: TITLE, url: "https://example.com/pg" }])),
        sink: () => {},
      });
      expect(await db.select().from(schema.rawItems)).toHaveLength(0);
    });

    it("stores a non-AI Show HN post using the CATALOGUE's own config", async () => {
      // #107. Every other test in this file builds its source by hand, so all
      // of them pass whatever the catalogue says — they prove the mechanism
      // and say nothing about whether the shipped Show HN row uses it.
      //
      // This one drives the real seed. A typo in keywordPolicy makes it fail
      // here rather than reporting the ticket done while Show HN keeps
      // discarding, which is the silent failure #111 is about.
      const seed = SOURCE_SEEDS.find((s) => s.key === "hackernews-show");
      expect(seed, "the catalogue must still carry Show HN").toBeDefined();
      expect(matchedAiVocabulary(TITLE), "fixture must genuinely not match").toBe(false);

      await addSource({
        key: seed!.key,
        name: seed!.name,
        kind: seed!.kind,
        tier: seed!.tier,
        url: null,
        defaultContentType: seed!.defaultContentType,
        config: seed!.config,
      });
      await runIngest(db, undefined, {
        now: NOW,
        fetchImpl: fakeNetwork(hnRoutes([{ id: 1, title: TITLE, url: "https://example.com/pg" }])),
        sink: () => {},
      });

      const items = await db.select().from(schema.rawItems);
      expect(items).toHaveLength(1);
      expect(items[0].matchedAiVocabulary).toBe(false);
      const [story] = await db.select().from(schema.stories);
      expect(story.adjacentTech).toBe(true);
    });

    it("leaves the FRONT PAGE discarding the same post", async () => {
      // The control, and the half that matters. Without it the test above
      // passes equally well if the gate had simply been deleted — which would
      // empty the front door rather than widening the back one.
      const seed = SOURCE_SEEDS.find((s) => s.key === "hackernews-ai");
      expect(seed!.config?.keywordPolicy, "the front page must not be labelled").toBeUndefined();

      await addSource({
        key: seed!.key,
        name: seed!.name,
        kind: seed!.kind,
        tier: seed!.tier,
        url: null,
        defaultContentType: seed!.defaultContentType,
        config: seed!.config,
      });
      await runIngest(db, undefined, {
        now: NOW,
        fetchImpl: fakeNetwork(hnRoutes([{ id: 1, title: TITLE, url: "https://example.com/pg" }])),
        sink: () => {},
      });
      expect(await db.select().from(schema.rawItems)).toHaveLength(0);
    });

    it("gates on an unrecognised policy rather than falling open", async () => {
      // Every other test in this describe passes the literal "label", so the
      // asymmetry this pins was invisible: the adapter used to gate only on
      // the exact literal "gate" while run.ts labels only on the exact literal
      // "label". A typo therefore turned the gate OFF and, because the story
      // was then not from a "label" source, put the resulting non-AI items in
      // the DEFAULT VIEW — the precise inverse of what this change promises.
      await addSource({
        key: "hn-typo",
        name: "Show HN",
        kind: "hackernews",
        tier: "COMMUNITY",
        url: null,
        config: { list: "top", minPoints: 3, keywordPolicy: "labl" },
      });
      await runIngest(db, undefined, {
        now: NOW,
        fetchImpl: fakeNetwork(hnRoutes([{ id: 1, title: TITLE, url: "https://example.com/pg" }])),
        sink: () => {},
      });
      expect(await db.select().from(schema.rawItems)).toHaveLength(0);
    });

    it("does not treat an unevaluated item as a miss", async () => {
      // The upgrade window, which is the only time this state exists: between
      // the migration and the MANUAL backfill every pre-existing row is NULL.
      // `matchedAiVocabulary === false` is what keeps those rows out of
      // adjacent tech; loosened to `!matchedAiVocabulary`, every story whose
      // items all come from a label source would flip to adjacent and VANISH
      // from the default view.
      //
      // This doubles as the deletion control for that operator: all three
      // tests above use booleans, so the mutation passes every one of them.
      const src = await addSource({
        key: "hn-discovery",
        name: "Show HN",
        kind: "hackernews",
        tier: "COMMUNITY",
        url: null,
        config: { list: "top", minPoints: 3, keywordPolicy: "label" },
      });
      await runIngest(db, undefined, {
        now: NOW,
        fetchImpl: fakeNetwork(hnRoutes([{ id: 1, title: TITLE, url: "https://example.com/pg" }])),
        sink: () => {},
      });
      void src;

      // Put the row back into the state an upgraded database is in.
      await db.update(schema.rawItems).set({ matchedAiVocabulary: null });
      const [before] = await db.select().from(schema.stories);
      // The precondition, asserted rather than assumed. This test only means
      // something if the story IS adjacent before the NULL — otherwise the
      // final expectation is true for a reason that has nothing to do with
      // NULL handling, and the control stops reddening without failing.
      // It is guaranteed today only by the fixture in the sibling test above,
      // which is one edit away from silently retiring this one.
      expect(before.adjacentTech).toBe(true);
      await db.transaction(async (tx) => {
        await refreshStory(tx, before.id);
      });

      const [story] = await db.select().from(schema.stories);
      expect(story.adjacentTech).toBe(false);
    });

    it("keeps a story out of adjacent tech when one item does match", async () => {
      // One matching item is enough. A launch nobody described in AI words is
      // adjacent; the same launch written up by somebody who did is not.
      //
      // Two SOURCES rather than two items from one, because a fingerprint is
      // scoped to source plus canonical url — one source publishing the same
      // link twice is one item, and an earlier version of this test proved
      // only that.
      const url = "https://example.com/pg";
      await addSource({
        key: "hn-discovery",
        name: "Show HN",
        kind: "hackernews",
        tier: "COMMUNITY",
        url: null,
        config: { list: "top", minPoints: 3, keywordPolicy: "label" },
      });
      await addSource({
        key: "a-newsletter",
        name: "A newsletter",
        tier: "ANALYST",
        // Also a label source, so the miss cannot be rescued by provenance —
        // this test is about one item MATCHING, not about where it came from.
        config: { keywordPolicy: "label" },
      });
      await runIngest(db, undefined, {
        now: NOW,
        fetchImpl: fakeNetwork({
          ...hnRoutes([{ id: 1, title: TITLE, url }]),
          "a-newsletter.test/feed": rssFeed([
            { title: "An AI agent that writes migrations", link: url, date: hoursAgo(2) },
          ]),
        }),
        sink: () => {},
      });

      const items = await db.select().from(schema.rawItems);
      expect(items).toHaveLength(2);
      expect(items.filter((i) => i.matchedAiVocabulary === true)).toHaveLength(1);

      const rows = await db.select().from(schema.stories);
      expect(rows).toHaveLength(1);
      expect(rows[0].adjacentTech).toBe(false);
    });
  });
});
