import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { rawItems, sources, stories, storyTopics, topics, userPreferences } from "@/db/schema";
import { COMPONENT_LABELS, WEIGHTS } from "./score";
import { RANKING_WINDOW_HOURS, rankAllStories, scoreComponentList } from "./rank-all";

/**
 * Its own database, and its own NAME: two test files that create and drop the
 * same database race each other, because vitest runs files in parallel.
 */
const TEST_DB = "ai_radar_ranking_test";
const configured = process.env.DATABASE_URL;

if (!configured && process.env.CI) {
  throw new Error("CI must set DATABASE_URL; refusing to skip the ranking tests silently");
}
if (!configured) {
  console.warn("\n!! DATABASE_URL is not set: the ranking tests did NOT run.\n");
}
const withDb = configured ? describe : describe.skip;

const urlFor = (database: string) => {
  const u = new URL(configured!);
  u.pathname = `/${database}`;
  return u.toString();
};

const NOW = new Date("2026-09-16T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

withDb("rankAllStories", () => {
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
    await sql.unsafe(
      `TRUNCATE story_topics, raw_items, stories, topics, ingest_runs, sources, user_preferences RESTART IDENTITY CASCADE`,
    );
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

  /** A story with its items already attached, built directly so the ranking
   *  inputs are the subject rather than the ingest path that produced them. */
  async function addStory(opts: {
    slug: string;
    title?: string;
    contentType?: schema.ContentType;
    verification?: schema.VerificationLevel;
    lastActivityAt?: Date;
    items: { sourceId: number; points?: number; comments?: number; publishedAt?: Date }[];
    topicKeys?: string[];
  }) {
    const at = opts.lastActivityAt ?? hoursAgo(1);
    const [story] = await db
      .insert(stories)
      .values({
        slug: opts.slug,
        title: opts.title ?? opts.slug,
        contentType: opts.contentType ?? "NEWS",
        verification: opts.verification ?? "CORROBORATED",
        firstSeenAt: at,
        lastActivityAt: at,
      })
      .returning();

    let n = 0;
    for (const item of opts.items) {
      n++;
      await db.insert(rawItems).values({
        sourceId: item.sourceId,
        externalId: `${opts.slug}-${n}`,
        url: `https://example.com/${opts.slug}-${n}`,
        canonicalUrl: `https://example.com/${opts.slug}-${n}`,
        title: opts.title ?? opts.slug,
        publishedAt: item.publishedAt ?? at,
        fetchedAt: at,
        contentType: opts.contentType ?? "NEWS",
        fingerprint: `${opts.slug}-${n}-fp`,
        storyId: story.id,
        metadata:
          item.points === undefined ? {} : { points: item.points, comments: item.comments ?? 0 },
      });
    }

    for (const key of opts.topicKeys ?? []) {
      const [t] = await db.select().from(topics).where(eq(topics.key, key));
      await db.insert(storyTopics).values({ storyId: story.id, topicId: t.id });
    }
    return story;
  }

  const reload = async (id: number) =>
    (await db.select().from(stories).where(eq(stories.id, id)))[0];

  // ── The ticket's expected output ───────────────────────────────────────────

  it("ranks a fresh primary source above an old community story", async () => {
    const lab = await addSource({ key: "openai-blog", tier: "PRIMARY" });
    const forum = await addSource({ key: "hackernews-ai", tier: "COMMUNITY" });
    const fresh = await addStory({
      slug: "fresh-primary",
      verification: "PRIMARY_SOURCE",
      lastActivityAt: hoursAgo(1),
      items: [{ sourceId: lab.id }],
    });
    const old = await addStory({
      slug: "old-community",
      verification: "UNVERIFIED",
      lastActivityAt: hoursAgo(20),
      items: [{ sourceId: forum.id }],
    });

    const result = await rankAllStories(db, NOW);
    expect(result.ranked).toBe(2);
    expect((await reload(fresh.id)).score).toBeGreaterThan((await reload(old.id)).score);
  });

  it("stores components that sum to the stored score", async () => {
    const lab = await addSource({ key: "openai-blog", tier: "PRIMARY" });
    const s = await addStory({ slug: "sums", items: [{ sourceId: lab.id }] });
    await rankAllStories(db, NOW);

    const row = await reload(s.id);
    const values = Object.values(row.scoreComponents);
    // Floor: a components object that came back empty would sum to zero and
    // agree with a score of zero perfectly.
    expect(values.length).toBeGreaterThanOrEqual(3);
    const sum = values.reduce((a, b) => a + b, 0);
    expect(Math.abs(row.score - sum)).toBeLessThan(0.11);
  });

  // ── The two named deletion controls ───────────────────────────────────────

  it("ranks a followed-topic story above its unfollowed twin", async () => {
    // NAMED CONTROL for removing the topic-match component.
    await db
      .insert(topics)
      .values({ key: "openai", name: "OpenAI", group: "company", keywords: ["openai"] });
    await db.insert(userPreferences).values({ id: 1, topicKeys: ["openai"] });
    const lab = await addSource({ key: "openai-blog", tier: "PRIMARY" });

    const followed = await addStory({
      slug: "followed",
      items: [{ sourceId: lab.id }],
      topicKeys: ["openai"],
    });
    const twin = await addStory({ slug: "unfollowed", items: [{ sourceId: lab.id }] });

    await rankAllStories(db, NOW);
    const a = await reload(followed.id);
    const b = await reload(twin.id);
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.scoreComponents.topicMatch).toBe(WEIGHTS.topicFirstMatch);
    expect(b.scoreComponents.topicMatch).toBeUndefined();
  });

  it("gives a single outlet filing twice no corroboration", async () => {
    // NAMED CONTROL for removing the storySources pass-through.
    const outlet = await addSource({ key: "verge-ai", tier: "HIGH_QUALITY_REPORTING" });
    const twice = await addStory({
      slug: "one-outlet-twice",
      items: [{ sourceId: outlet.id }, { sourceId: outlet.id }],
    });
    await rankAllStories(db, NOW);

    const row = await reload(twice.id);
    expect(row.scoreComponents.corroboration).toBeUndefined();
    expect(row.scoreComponents.qualityReporting).toBe(WEIGHTS.highQualityReporting);
  });

  it("pays corroboration once a second outlet joins", async () => {
    // The positive control beside the negative one above.
    const a = await addSource({ key: "verge-ai" });
    const b = await addSource({ key: "wired-ai" });
    const story = await addStory({
      slug: "two-outlets",
      items: [{ sourceId: a.id }, { sourceId: b.id }],
    });
    await rankAllStories(db, NOW);
    expect((await reload(story.id)).scoreComponents.corroboration).toBe(
      WEIGHTS.corroborationPerSource,
    );
  });

  // ── Verification, engagement, window, determinism ─────────────────────────

  it("pushes an unverified story below its corroborated twin", async () => {
    const outlet = await addSource({ key: "verge-ai" });
    const weak = await addStory({
      slug: "weak",
      verification: "UNVERIFIED",
      items: [{ sourceId: outlet.id }],
    });
    const strong = await addStory({
      slug: "strong",
      verification: "CORROBORATED",
      items: [{ sourceId: outlet.id }],
    });
    await rankAllStories(db, NOW);

    const w = await reload(weak.id);
    const s = await reload(strong.id);
    expect(w.scoreComponents.unverifiedPenalty).toBe(-WEIGHTS.unverifiedPenalty);
    expect(w.score).toBeLessThan(s.score);
    expect(s.score - w.score).toBeCloseTo(WEIGHTS.unverifiedPenalty, 1);
  });

  it("uses the best engagement signal on the story", async () => {
    const forum = await addSource({ key: "hackernews-ai", tier: "COMMUNITY" });
    const quiet = await addStory({
      slug: "quiet",
      items: [{ sourceId: forum.id, points: 5, comments: 1 }],
    });
    const loud = await addStory({
      slug: "loud",
      items: [
        { sourceId: forum.id, points: 5, comments: 1 },
        { sourceId: forum.id, points: 400, comments: 300 },
      ],
    });
    await rankAllStories(db, NOW);

    const q = await reload(quiet.id);
    const l = await reload(loud.id);
    expect(l.scoreComponents.engagement).toBeGreaterThan(q.scoreComponents.engagement);
  });

  it("takes points and comments from the same item, not the best of each", async () => {
    // Two items whose strongest numbers live on different rows. Taking the
    // maximum of each field would describe a conversation that never happened,
    // and the earlier test cannot tell the two apart because its best item is
    // strongest in both fields at once.
    const forum = await addSource({ key: "hackernews-ai", tier: "COMMUNITY" });
    const split = await addStory({
      slug: "split-signal",
      items: [
        { sourceId: forum.id, points: 50, comments: 0 },
        { sourceId: forum.id, points: 2, comments: 300 },
      ],
    });
    await rankAllStories(db, NOW);

    const sameItem = 4 * Math.log10(51);
    const maxOfEach = 4 * Math.log10(51) + 1.5 * Math.log10(301);
    const engagement = (await reload(split.id)).scoreComponents.engagement;
    expect(engagement).toBeCloseTo(Math.round(sameItem * 10) / 10, 1);
    expect(engagement).toBeLessThan(maxOfEach - 1);
  });

  it("leaves a story outside the window untouched", async () => {
    const outlet = await addSource({ key: "verge-ai" });
    const recent = await addStory({ slug: "recent", items: [{ sourceId: outlet.id }] });
    const ancient = await addStory({
      slug: "ancient",
      lastActivityAt: new Date(NOW.getTime() - (RANKING_WINDOW_HOURS + 5) * 3_600_000),
      items: [{ sourceId: outlet.id }],
    });

    const result = await rankAllStories(db, NOW);
    expect(result.ranked).toBe(1);
    expect((await reload(recent.id)).score).toBeGreaterThan(0);
    // Untouched, not zeroed: the default is what it keeps.
    expect((await reload(ancient.id)).score).toBe(0);
    expect(Object.keys((await reload(ancient.id)).scoreComponents)).toEqual([]);
  });

  it("is deterministic for a fixed now, down to the stored row", async () => {
    const lab = await addSource({ key: "openai-blog", tier: "PRIMARY" });
    const forum = await addSource({ key: "hackernews-ai", tier: "COMMUNITY" });
    await addStory({
      slug: "a",
      items: [{ sourceId: lab.id }, { sourceId: forum.id, points: 40 }],
    });
    await addStory({ slug: "b", verification: "EMERGING", items: [{ sourceId: forum.id }] });

    await rankAllStories(db, NOW);
    const first = await sql.unsafe(
      `select md5(string_agg(t::text,'|' order by t.slug)) as h from stories t`,
    );
    await rankAllStories(db, NOW);
    const second = await sql.unsafe(
      `select md5(string_agg(t::text,'|' order by t.slug)) as h from stories t`,
    );
    expect(first[0].h).toBeTruthy();
    expect(second[0].h).toBe(first[0].h);
  });

  it("does not rank when there is nothing in the window", async () => {
    const result = await rankAllStories(db, NOW);
    expect(result.ranked).toBe(0);
  });
});

describe("scoreComponentList", () => {
  it("labels every component and keeps the values", () => {
    const list = scoreComponentList({ recency: 13.1, primarySource: 20, unverifiedPenalty: -6 });
    expect(list).toEqual([
      { key: "recency", label: COMPONENT_LABELS.recency, value: 13.1 },
      { key: "primarySource", label: COMPONENT_LABELS.primarySource, value: 20 },
      { key: "unverifiedPenalty", label: "Unverified claim", value: -6 },
    ]);
  });

  it("falls back to the key when a component has no label", () => {
    // A component added to the model without a label must still render, and
    // must be visibly unlabelled rather than silently dropped.
    const list = scoreComponentList({ somethingNew: 3 });
    expect(list).toEqual([{ key: "somethingNew", label: "somethingNew", value: 3 }]);
  });

  it("returns an empty list for a story that has not been ranked", () => {
    expect(scoreComponentList({})).toEqual([]);
  });
});
