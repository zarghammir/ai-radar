import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { TRUNCATE_ALL } from "@/db/tables";

/**
 * Route-level tests: the real handlers, called the way Next calls them.
 *
 * The handlers import the shared db singleton, so DATABASE_URL is pointed at
 * this file's own database before any route module is loaded — which is why
 * every route here is imported dynamically inside a test rather than at the
 * top of the file. Its own database NAME too: vitest runs files in parallel,
 * and two files dropping the same database race each other.
 */
const TEST_DB = "ai_radar_api_test";
const configured = process.env.DATABASE_URL;

if (!configured && process.env.CI) {
  throw new Error("CI must set DATABASE_URL; refusing to skip the API tests silently");
}
if (!configured) console.warn("\n!! DATABASE_URL is not set: the API tests did NOT run.\n");
const withDb = configured ? describe : describe.skip;

const urlFor = (database: string) => {
  const u = new URL(configured!);
  u.pathname = `/${database}`;
  return u.toString();
};

const BASE = "http://localhost:3000";
const req = (path: string) => new Request(`${BASE}${path}`) as never;
const body = async (res: Response) => (await res.json()) as Record<string, never>;

withDb("API routes", () => {
  let admin: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    admin = postgres(urlFor("postgres"), { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
    sql = postgres(urlFor(TEST_DB), { max: 4, onnotice: () => {} });
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    // Every dynamic import below now resolves the singleton to this database.
    process.env.DATABASE_URL = urlFor(TEST_DB);
  }, 60_000);

  afterAll(async () => {
    // Importing a route opens the shared db singleton against this database,
    // and a connection left open makes DROP DATABASE hang rather than fail.
    // A connection this file caused is this file's to close.
    const g = globalThis as unknown as { __aiRadarSql?: { end: (o?: unknown) => Promise<void> } };
    await g.__aiRadarSql?.end({ timeout: 5 }).catch(() => {});
    await sql?.end();
    // FORCE covers anything still attached: without it a stray backend leaves
    // an undroppable database behind on a machine other lanes share.
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => {});
    await admin?.end();
  }, 30_000);

  beforeEach(async () => {
    await sql.unsafe(TRUNCATE_ALL);
  }, 30_000);

  // ── Fixtures, written straight to the database ────────────────────────────

  async function source(key: string, over: Record<string, unknown> = {}) {
    const row = {
      key,
      name: (over.name as string) ?? key,
      kind: (over.kind as string) ?? "rss",
      tier: (over.tier as string) ?? "HIGH_QUALITY_REPORTING",
      url: `https://${key}.test/feed`,
      homepage: `https://${key}.test`,
      enabled: over.enabled ?? true,
      config: JSON.stringify(over.config ?? { secret: "must not be exposed" }),
      defaultContentType: "NEWS",
    };
    const [r] = await sql.unsafe(
      `insert into sources (key,name,kind,tier,url,homepage,enabled,config,default_content_type)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [
        row.key,
        row.name,
        row.kind,
        row.tier,
        row.url,
        row.homepage,
        row.enabled as boolean,
        row.config,
        row.defaultContentType,
      ],
    );
    return Number(r.id);
  }

  async function topic(key: string, name = key, group = "company") {
    const [r] = await sql.unsafe(
      `insert into topics (key,name,"group",keywords) values ($1,$2,$3,'[]'::jsonb) returning id`,
      [key, name, group],
    );
    return Number(r.id);
  }

  async function story(opts: {
    slug: string;
    title?: string;
    contentType?: string;
    verification?: string;
    lastActivityAt?: Date;
    score?: number;
    sourceIds: number[];
    topicIds?: number[];
    hidden?: boolean;
    read?: boolean;
    saved?: boolean;
    points?: number;
  }) {
    const at = opts.lastActivityAt ?? new Date(Date.now() - 3_600_000);
    const [s] = await sql.unsafe(
      `insert into stories (slug,title,content_type,verification,verification_note,first_seen_at,last_activity_at,source_count,score)
       values ($1,$2,$3,$4,$5,$6,$6,$7,$8) returning id`,
      [
        opts.slug,
        opts.title ?? opts.slug,
        opts.contentType ?? "NEWS",
        opts.verification ?? "CORROBORATED",
        "how this was graded",
        at.toISOString(),
        opts.sourceIds.length,
        opts.score ?? 0,
      ],
    );
    const storyId = Number(s.id);

    let first: number | null = null;
    let n = 0;
    for (const sourceId of opts.sourceIds) {
      n++;
      const [item] = await sql.unsafe(
        `insert into raw_items (source_id,external_id,url,canonical_url,title,excerpt,published_at,fetched_at,content_type,metadata,fingerprint,story_id,role)
         values ($1,$2,$3,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11) returning id`,
        [
          sourceId,
          `${opts.slug}-${n}`,
          `https://example.com/${opts.slug}-${n}`,
          opts.title ?? opts.slug,
          "a short excerpt for the card",
          at.toISOString(),
          opts.contentType ?? "NEWS",
          // Engagement goes on the LAST item only. Putting it on every item
          // would make "the blog post has no engagement" untestable, which is
          // the distinction between absent and zero that the card relies on.
          JSON.stringify(
            opts.points === undefined || n !== opts.sourceIds.length
              ? {}
              : { points: opts.points, comments: 3 },
          ),
          `${opts.slug}-${n}-fp`,
          storyId,
          n === 1 ? "primary" : "report",
        ],
      );
      if (first === null) first = Number(item.id);
    }
    await sql.unsafe(`update stories set primary_item_id = $1 where id = $2`, [first, storyId]);

    for (const topicId of opts.topicIds ?? []) {
      await sql.unsafe(`insert into story_topics (story_id,topic_id) values ($1,$2)`, [
        storyId,
        topicId,
      ]);
    }
    if (opts.hidden || opts.read) {
      await sql.unsafe(`insert into read_state (story_id,read_at,hidden) values ($1,$2,$3)`, [
        storyId,
        opts.read ? new Date().toISOString() : null,
        Boolean(opts.hidden),
      ]);
    }
    if (opts.saved) {
      await sql.unsafe(`insert into saved_items (story_id) values ($1)`, [storyId]);
    }
    return storyId;
  }

  // ── Topics ────────────────────────────────────────────────────────────────

  describe("GET /api/topics", () => {
    it("returns topics with a story count", async () => {
      const t = await topic("openai", "OpenAI");
      await topic("robotics", "Robotics", "domain");
      const s = await source("verge-ai");
      await story({ slug: "a", sourceIds: [s], topicIds: [t] });

      const { GET } = await import("@/app/api/topics/route");
      const res = await GET();
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const data = await body(res);
      const list = data.topics as unknown as { key: string; storyCount: number }[];
      expect(list).toHaveLength(2);
      expect(list.find((x) => x.key === "openai")!.storyCount).toBe(1);
      expect(list.find((x) => x.key === "robotics")!.storyCount).toBe(0);
    });
  });

  // ── Sources ───────────────────────────────────────────────────────────────

  describe("GET /api/sources", () => {
    it("returns the catalogue without operational settings", async () => {
      await source("verge-ai", { name: "The Verge" });
      const { GET } = await import("@/app/api/sources/route");
      const data = await body(await GET());
      const list = data.sources as unknown as Record<string, unknown>[];

      expect(list).toHaveLength(1);
      expect(list[0].key).toBe("verge-ai");
      expect(list[0].enabled).toBe(true);
      // The two fields the contract deliberately withholds. The feed url is
      // the one field here that could carry a credential in a query string.
      expect(list[0]).not.toHaveProperty("config");
      expect(list[0]).not.toHaveProperty("url");
      expect(JSON.stringify(list[0])).not.toContain("must not be exposed");
    });
  });

  describe("PUT /api/sources/:key", () => {
    it("switches a source off", async () => {
      await source("verge-ai");
      const { PUT } = await import("@/app/api/sources/[key]/route");
      const request = new Request(`${BASE}/api/sources/verge-ai`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      const res = await PUT(
        request as never,
        { params: Promise.resolve({ key: "verge-ai" }) } as never,
      );
      expect(res.status).toBe(200);
      expect((await body(res)).enabled).toBe(false);

      const [row] = await sql.unsafe(`select enabled from sources where key = 'verge-ai'`);
      expect(row.enabled).toBe(false);
    });

    it("rejects a body that is not { enabled: boolean }", async () => {
      await source("verge-ai");
      const { PUT } = await import("@/app/api/sources/[key]/route");
      const request = new Request(`${BASE}/api/sources/verge-ai`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: "no" }),
      });
      const res = await PUT(
        request as never,
        { params: Promise.resolve({ key: "verge-ai" }) } as never,
      );
      expect(res.status).toBe(400);
      expect((await body(res)).error).toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("is a 404 for a source that does not exist", async () => {
      const { PUT } = await import("@/app/api/sources/[key]/route");
      const request = new Request(`${BASE}/api/sources/nope`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      const res = await PUT(
        request as never,
        { params: Promise.resolve({ key: "nope" }) } as never,
      );
      expect(res.status).toBe(404);
      expect((await body(res)).error).toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ── Story detail ──────────────────────────────────────────────────────────

  describe("GET /api/stories/:slug", () => {
    it("returns the story with its provenance", async () => {
      const lab = await source("openai-blog", { name: "OpenAI", tier: "PRIMARY" });
      const forum = await source("hackernews-ai", {
        name: "Hacker News",
        kind: "hackernews",
        tier: "COMMUNITY",
      });
      const t = await topic("openai", "OpenAI");
      await story({
        slug: "introducing-gpt-6",
        title: "Introducing GPT-6",
        sourceIds: [lab, forum],
        topicIds: [t],
        points: 412,
      });

      const { GET } = await import("@/app/api/stories/[slug]/route");
      const res = await GET(req("/api/stories/introducing-gpt-6"), {
        params: Promise.resolve({ slug: "introducing-gpt-6" }),
      } as never);
      expect(res.status).toBe(200);
      const d = await body(res);

      expect(d.slug).toBe("introducing-gpt-6");
      expect(d.verificationNote).toBe("how this was graded");
      expect(d.sources as unknown as unknown[]).toHaveLength(2);
      expect(d.items as unknown as unknown[]).toHaveLength(2);
      expect(d.timeline as unknown as unknown[]).toHaveLength(2);
      expect((d.topics as unknown as { key: string }[])[0].key).toBe("openai");
      // Empty on a story the ranking run has not reached, never absent.
      expect(d.scoreComponents).toEqual([]);
      expect(d.summary).toBeNull();
      expect(d.excerpt).toBe("a short excerpt for the card");

      const items = d.items as unknown as { source: { key: string }; engagement: unknown }[];
      const hn = items.find((i) => i.source.key === "hackernews-ai")!;
      const blog = items.find((i) => i.source.key === "openai-blog")!;
      expect(hn.engagement).toEqual({ points: 412, comments: 3 });
      // Absent, not zero: no engagement recorded is a different fact.
      expect(blog.engagement).toBeNull();
    });

    it("counts one source once when it files two items on the same story", async () => {
      // Every other test gives each story one item per source, so nothing was
      // asserting the de-duplication a card depends on to explain its badge.
      const src = await source("verge-ai", { name: "The Verge" });
      await story({ slug: "twice", sourceIds: [src, src] });
      const { GET } = await import("@/app/api/stories/[slug]/route");
      const d = await body(
        await GET(req("/api/stories/twice"), {
          params: Promise.resolve({ slug: "twice" }),
        } as never),
      );
      // Two items, one source. The card's source list is what the verification
      // badge is derived from, so a duplicate there would claim corroboration
      // the story does not have.
      expect(d.items as unknown as unknown[]).toHaveLength(2);
      expect((d.sources as unknown as { key: string }[]).map((x) => x.key)).toEqual(["verge-ai"]);
    });

    it("returns whyItMatters as null rather than leaving the key out", async () => {
      // An omitted key and a null are not the same value to a client, and a
      // list where the key is sometimes absent is worse than one where it is
      // always present and sometimes null.
      const src = await source("verge-ai");
      await story({ slug: "plain", sourceIds: [src] });
      const { GET } = await import("@/app/api/stories/[slug]/route");
      const d = await body(
        await GET(req("/api/stories/plain"), {
          params: Promise.resolve({ slug: "plain" }),
        } as never),
      );
      expect("whyItMatters" in d).toBe(true);
      expect(d.whyItMatters).toBeNull();
    });

    it("explains the score with server-supplied labels once ranked", async () => {
      const { rankAllStories } = await import("@/pipeline/ranking/rank-all");
      const { getDb } = await import("@/db/client");
      const db = getDb();
      const { COMPONENT_LABELS } = await import("@/pipeline/ranking/score");

      const lab = await source("openai-blog", { name: "OpenAI", tier: "PRIMARY" });
      await story({ slug: "ranked", sourceIds: [lab], verification: "PRIMARY_SOURCE" });
      await rankAllStories(db, new Date());

      const { GET } = await import("@/app/api/stories/[slug]/route");
      const d = await body(
        await GET(req("/api/stories/ranked"), {
          params: Promise.resolve({ slug: "ranked" }),
        } as never),
      );
      const comps = d.scoreComponents as unknown as { key: string; label: string; value: number }[];
      expect(comps.length).toBeGreaterThanOrEqual(2);
      // The label is the server's, not the client's: the wording cannot drift
      // from the weights that produced the number.
      for (const c of comps) expect(c.label).toBe(COMPONENT_LABELS[c.key as never]);
      expect(comps.find((c) => c.key === "primarySource")!.value).toBeGreaterThan(0);
      // The sum is what the why-ranked panel adds up to.
      expect(comps.reduce((n, c) => n + c.value, 0)).toBeCloseTo(d.score as unknown as number, 1);
    });

    it("is a 404 for an unknown slug", async () => {
      const { GET } = await import("@/app/api/stories/[slug]/route");
      const res = await GET(req("/api/stories/nope"), {
        params: Promise.resolve({ slug: "nope" }),
      } as never);
      expect(res.status).toBe(404);
      expect((await body(res)).error).toMatchObject({ code: "NOT_FOUND" });
    });

    it("still returns a hidden story by direct link", async () => {
      const s = await source("verge-ai");
      await story({ slug: "hidden-one", sourceIds: [s], hidden: true });
      const { GET } = await import("@/app/api/stories/[slug]/route");
      const res = await GET(req("/api/stories/hidden-one"), {
        params: Promise.resolve({ slug: "hidden-one" }),
      } as never);
      expect(res.status).toBe(200);
    });
  });

  // ── Radar ─────────────────────────────────────────────────────────────────

  describe("GET /api/radar", () => {
    it("returns a page with the filters it actually applied", async () => {
      const s = await source("verge-ai");
      await story({ slug: "a", sourceIds: [s] });
      const { GET } = await import("@/app/api/radar/route");
      const data = await body(await GET(req("/api/radar")));

      expect(data.stories as unknown as unknown[]).toHaveLength(1);
      expect(data.hasMore).toBe(false);
      expect(data.nextCursor).toBeNull();
      expect(data.appliedFilters).toMatchObject({ since: "7d", sort: "newest" });
    });

    it("carries whyItMatters on every card, valued or null", async () => {
      // Today renders this in a LIST, so it has to be on the card: fetching one
      // story's detail per row to get it is the wrong shape for a list.
      const src = await source("verge-ai");
      const withIt = await story({ slug: "explained", sourceIds: [src] });
      await story({ slug: "plain", sourceIds: [src] });
      await sql.unsafe(`update stories set why_it_matters = $1 where id = $2`, [
        "It is the first model to ship with this context window.",
        withIt,
      ]);

      const { GET } = await import("@/app/api/radar/route");
      const cards = (await body(await GET(req("/api/radar")))).stories as unknown as {
        slug: string;
        whyItMatters: string | null;
      }[];
      expect(cards).toHaveLength(2);
      for (const c of cards) expect("whyItMatters" in c).toBe(true);
      expect(cards.find((c) => c.slug === "explained")!.whyItMatters).toBe(
        "It is the first model to ship with this context window.",
      );
      expect(cards.find((c) => c.slug === "plain")!.whyItMatters).toBeNull();
    });

    it("leaves hidden stories out of the list", async () => {
      const s = await source("verge-ai");
      await story({ slug: "shown", sourceIds: [s] });
      await story({ slug: "hidden-one", sourceIds: [s], hidden: true });
      const { GET } = await import("@/app/api/radar/route");
      const data = await body(await GET(req("/api/radar")));
      const slugs = (data.stories as unknown as { slug: string }[]).map((x) => x.slug);
      expect(slugs).toEqual(["shown"]);
    });

    it("filters by type, verification and topic", async () => {
      const s = await source("verge-ai");
      const t = await topic("openai", "OpenAI");
      await story({
        slug: "release-openai",
        contentType: "RELEASE",
        sourceIds: [s],
        topicIds: [t],
      });
      await story({ slug: "news-other", contentType: "NEWS", sourceIds: [s] });
      await story({
        slug: "release-unverified",
        contentType: "RELEASE",
        verification: "UNVERIFIED",
        sourceIds: [s],
      });
      const { GET } = await import("@/app/api/radar/route");

      const byType = await body(await GET(req("/api/radar?type=RELEASE")));
      expect(byType.stories as unknown as unknown[]).toHaveLength(2);

      const byBoth = await body(
        await GET(req("/api/radar?type=RELEASE&verification=CORROBORATED")),
      );
      expect((byBoth.stories as unknown as { slug: string }[]).map((x) => x.slug)).toEqual([
        "release-openai",
      ]);

      const byTopic = await body(await GET(req("/api/radar?topic=openai")));
      expect((byTopic.stories as unknown as { slug: string }[]).map((x) => x.slug)).toEqual([
        "release-openai",
      ]);
    });

    it("pages with a cursor without repeating or skipping a story", async () => {
      const s = await source("verge-ai");
      for (let i = 0; i < 5; i++) {
        await story({
          slug: `s${i}`,
          sourceIds: [s],
          lastActivityAt: new Date(Date.now() - (i + 1) * 60_000),
        });
      }
      const { GET } = await import("@/app/api/radar/route");

      const first = await body(await GET(req("/api/radar?limit=2")));
      expect(first.stories as unknown as unknown[]).toHaveLength(2);
      expect(first.hasMore).toBe(true);

      const second = await body(await GET(req(`/api/radar?limit=2&cursor=${first.nextCursor}`)));
      const third = await body(await GET(req(`/api/radar?limit=2&cursor=${second.nextCursor}`)));

      const seen = [
        ...(first.stories as unknown as { slug: string }[]),
        ...(second.stories as unknown as { slug: string }[]),
        ...(third.stories as unknown as { slug: string }[]),
      ].map((x) => x.slug);
      expect(seen).toEqual(["s0", "s1", "s2", "s3", "s4"]);
      expect(new Set(seen).size).toBe(5);
      expect(third.hasMore).toBe(false);
    });

    it("orders by score when asked, and by id while every score is zero", async () => {
      // Both halves on purpose. The first proves the documented degenerate
      // behaviour until #36 lands; the second proves the sort actually reads
      // the column rather than falling through to id order by accident, which
      // is the only way to know the wiring works before #36 exists.
      const s = await source("verge-ai");
      const older = await story({
        slug: "older",
        sourceIds: [s],
        lastActivityAt: new Date(Date.now() - 7_200_000),
      });
      const newer = await story({
        slug: "newer",
        sourceIds: [s],
        lastActivityAt: new Date(Date.now() - 60_000),
      });
      const { GET } = await import("@/app/api/radar/route");

      const zeroed = await body(await GET(req("/api/radar?sort=importance")));
      expect((zeroed.stories as unknown as { slug: string }[]).map((x) => x.slug)).toEqual([
        "newer",
        "older",
      ]);
      expect(newer).toBeGreaterThan(older);

      await sql.unsafe(`update stories set score = 90 where slug = 'older'`);
      const scored = await body(await GET(req("/api/radar?sort=importance")));
      expect((scored.stories as unknown as { slug: string }[]).map((x) => x.slug)).toEqual([
        "older",
        "newer",
      ]);
    });

    it("orders by real scores once the ranker has run", async () => {
      // The test above sets scores by hand. This one lets the real ranker
      // produce them, so the sort is proven against the thing that will
      // actually populate the column rather than against a fixture — and the
      // two orders differ, so it cannot pass by coinciding with newest.
      const { rankAllStories } = await import("@/pipeline/ranking/rank-all");
      const { getDb } = await import("@/db/client");
      const db = getDb();

      const lab = await source("openai-blog", { name: "OpenAI", tier: "PRIMARY" });
      const forum = await source("hackernews-ai", {
        name: "Hacker News",
        kind: "hackernews",
        tier: "COMMUNITY",
      });
      // Older but first-party, so it outranks despite being further down a
      // newest-first list.
      await story({
        slug: "older-primary",
        sourceIds: [lab],
        verification: "PRIMARY_SOURCE",
        lastActivityAt: new Date(Date.now() - 5 * 3_600_000),
      });
      await story({
        slug: "newer-community",
        sourceIds: [forum],
        verification: "UNVERIFIED",
        lastActivityAt: new Date(Date.now() - 60_000),
      });

      const result = await rankAllStories(db, new Date());
      expect(result.ranked).toBe(2);

      const { GET } = await import("@/app/api/radar/route");
      const newest = (await body(await GET(req("/api/radar?sort=newest")))).stories as unknown as {
        slug: string;
      }[];
      const important = (await body(await GET(req("/api/radar?sort=importance"))))
        .stories as unknown as {
        slug: string;
        score: number;
      }[];

      expect(newest.map((x) => x.slug)).toEqual(["newer-community", "older-primary"]);
      expect(important.map((x) => x.slug)).toEqual(["older-primary", "newer-community"]);
      // Real scores, not the zero default, and the order follows them.
      expect(important[0].score).toBeGreaterThan(important[1].score);
      expect(important[0].score).toBeGreaterThan(0);
    });

    it("orders by how many sources arrived recently when trending", async () => {
      const a = await source("verge-ai");
      const b = await source("wired-ai");
      await story({ slug: "one-source", sourceIds: [a] });
      await story({ slug: "two-sources", sourceIds: [a, b] });
      const { GET } = await import("@/app/api/radar/route");
      const data = await body(await GET(req("/api/radar?sort=trending")));
      expect((data.stories as unknown as { slug: string }[]).map((x) => x.slug)).toEqual([
        "two-sources",
        "one-source",
      ]);
    });

    it("rejects an unknown sort, an out-of-range limit and a filter naming nothing", async () => {
      const { GET } = await import("@/app/api/radar/route");
      for (const [path, fragment] of [
        ["/api/radar?sort=sideways", "sort"],
        ["/api/radar?limit=0", "limit"],
        ["/api/radar?limit=500", "limit"],
        ["/api/radar?since=never", "since"],
        ["/api/radar?type=GOSSIP", "type"],
        ["/api/radar?topic=does-not-exist", "topic"],
        ["/api/radar?cursor=not-a-cursor", "cursor"],
      ] as const) {
        const res = await GET(req(path));
        expect(res.status, path).toBe(400);
        const err = (await body(res)).error as unknown as { code: string; message: string };
        expect(err.code).toBe("VALIDATION_ERROR");
        expect(err.message.toLowerCase()).toContain(fragment);
      }
    });
  });

  // ── Saved, read and hidden ────────────────────────────────────────────────

  describe("saving", () => {
    it("saves, updates on a second save, and unsaves", async () => {
      const src = await source("verge-ai");
      const id = await story({ slug: "a", sourceIds: [src] });
      const { POST, DELETE } = await import("@/app/api/saved/[storyId]/route");
      const ctx = { params: Promise.resolve({ storyId: String(id) }) } as never;

      const first = await POST(
        new Request(`${BASE}/api/saved/${id}`, {
          method: "POST",
          body: JSON.stringify({ note: "read later" }),
        }) as never,
        ctx,
      );
      expect(first.status).toBe(200);
      expect(await body(first)).toMatchObject({ saved: true, note: "read later", tags: [] });

      // Idempotent: a second tap on a phone must not be an error.
      const again = await POST(
        new Request(`${BASE}/api/saved/${id}`, {
          method: "POST",
          body: JSON.stringify({ note: "changed", tags: ["ai"] }),
        }) as never,
        ctx,
      );
      expect(again.status).toBe(200);
      expect(await body(again)).toMatchObject({ saved: true, note: "changed", tags: ["ai"] });

      const removed = await DELETE(new Request(`${BASE}/api/saved/${id}`) as never, ctx);
      expect(await body(removed)).toMatchObject({ saved: false });
      // Also idempotent the other way.
      expect((await DELETE(new Request(`${BASE}/api/saved/${id}`) as never, ctx)).status).toBe(200);
    });

    it("saves with no body at all", async () => {
      const src = await source("verge-ai");
      const id = await story({ slug: "a", sourceIds: [src] });
      const { POST } = await import("@/app/api/saved/[storyId]/route");
      const res = await POST(
        new Request(`${BASE}/api/saved/${id}`, { method: "POST" }) as never,
        {
          params: Promise.resolve({ storyId: String(id) }),
        } as never,
      );
      expect(res.status).toBe(200);
      expect(await body(res)).toMatchObject({ saved: true, note: null, tags: [] });
    });

    it("is a 404 for a story that does not exist, and a 400 for a bad id", async () => {
      const { POST } = await import("@/app/api/saved/[storyId]/route");
      const missing = await POST(
        new Request(`${BASE}/api/saved/999`, { method: "POST" }) as never,
        {
          params: Promise.resolve({ storyId: "999" }),
        } as never,
      );
      expect(missing.status).toBe(404);

      const bad = await POST(
        new Request(`${BASE}/api/saved/abc`, { method: "POST" }) as never,
        {
          params: Promise.resolve({ storyId: "abc" }),
        } as never,
      );
      expect(bad.status).toBe(400);
    });

    it("lists saved stories newest first, with the note and when it was saved", async () => {
      const src = await source("verge-ai");
      const one = await story({ slug: "one", sourceIds: [src] });
      const two = await story({ slug: "two", sourceIds: [src] });
      const { POST } = await import("@/app/api/saved/[storyId]/route");
      for (const id of [one, two]) {
        await POST(
          new Request(`${BASE}/api/saved/${id}`, {
            method: "POST",
            body: JSON.stringify({ note: `n${id}` }),
          }) as never,
          {
            params: Promise.resolve({ storyId: String(id) }),
          } as never,
        );
      }
      const { GET } = await import("@/app/api/saved/route");
      const data = await body(await GET(req("/api/saved")));
      const list = data.stories as unknown as {
        slug: string;
        note: string;
        savedAt: string;
        saved: boolean;
      }[];
      expect(list.map((x) => x.slug)).toEqual(["two", "one"]);
      expect(list[0].note).toBe(`n${two}`);
      expect(list[0].savedAt).toMatch(/^\d{4}-/);
      expect(list[0].saved).toBe(true);
    });
  });

  describe("read and hidden are separate facts", () => {
    it("marks read without hiding, and hides without marking read", async () => {
      const src = await source("verge-ai");
      const id = await story({ slug: "a", sourceIds: [src] });
      const read = await import("@/app/api/read/[storyId]/route");
      const hide = await import("@/app/api/hide/[storyId]/route");
      const ctx = { params: Promise.resolve({ storyId: String(id) }) } as never;

      const marked = await body(
        await read.POST(new Request(`${BASE}/api/read/${id}`, { method: "POST" }) as never, ctx),
      );
      expect(marked).toMatchObject({ read: true });
      expect(marked.readAt).not.toBeNull();

      // Still visible: reading is not hiding.
      const { GET } = await import("@/app/api/radar/route");
      expect(
        (await body(await GET(req("/api/radar")))).stories as unknown as unknown[],
      ).toHaveLength(1);

      const hidden = await body(
        await hide.POST(new Request(`${BASE}/api/hide/${id}`, { method: "POST" }) as never, ctx),
      );
      expect(hidden).toMatchObject({ hidden: true });
      // Hiding must not have cleared the read mark.
      const [row] = await sql.unsafe(
        `select read_at, hidden from read_state where story_id = ${id}`,
      );
      expect(row.read_at).not.toBeNull();
      expect(row.hidden).toBe(true);

      // And now it is out of the list, while still reachable by link.
      expect(
        (await body(await GET(req("/api/radar")))).stories as unknown as unknown[],
      ).toHaveLength(0);
    });

    it("unmarks and unhides when asked", async () => {
      const src = await source("verge-ai");
      const id = await story({ slug: "a", sourceIds: [src] });
      const read = await import("@/app/api/read/[storyId]/route");
      const hide = await import("@/app/api/hide/[storyId]/route");
      const ctx = { params: Promise.resolve({ storyId: String(id) }) } as never;

      await read.POST(new Request(`${BASE}/api/read/${id}`, { method: "POST" }) as never, ctx);
      const un = await body(
        await read.POST(
          new Request(`${BASE}/api/read/${id}`, {
            method: "POST",
            body: JSON.stringify({ read: false }),
          }) as never,
          ctx,
        ),
      );
      expect(un).toMatchObject({ read: false, readAt: null });

      await hide.POST(new Request(`${BASE}/api/hide/${id}`, { method: "POST" }) as never, ctx);
      const shown = await body(
        await hide.POST(
          new Request(`${BASE}/api/hide/${id}`, {
            method: "POST",
            body: JSON.stringify({ hidden: false }),
          }) as never,
          ctx,
        ),
      );
      expect(shown).toMatchObject({ hidden: false });
    });
  });

  // ── Preferences ───────────────────────────────────────────────────────────

  describe("preferences", () => {
    it("answers with defaults on a fresh install rather than a 404", async () => {
      const { GET } = await import("@/app/api/preferences/route");
      const data = await body(await GET());
      expect(data).toMatchObject({
        briefTime: "07:30",
        timezone: "UTC",
        briefLength: "10",
        theme: "system",
      });
      expect(data.topicKeys).toEqual([]);
    });

    it("updates only the fields it is given", async () => {
      await topic("openai", "OpenAI");
      const { GET, PUT } = await import("@/app/api/preferences/route");
      await GET();
      const res = await PUT(
        new Request(`${BASE}/api/preferences`, {
          method: "PUT",
          body: JSON.stringify({ briefLength: "5", topicKeys: ["openai"] }),
        }) as never,
      );
      expect(res.status).toBe(200);
      const data = await body(res);
      expect(data).toMatchObject({ briefLength: "5", briefTime: "07:30" });
      expect(data.topicKeys).toEqual(["openai"]);
    });

    it("rejects an unknown topic rather than dropping it", async () => {
      const { PUT } = await import("@/app/api/preferences/route");
      const res = await PUT(
        new Request(`${BASE}/api/preferences`, {
          method: "PUT",
          body: JSON.stringify({ topicKeys: ["nope"] }),
        }) as never,
      );
      expect(res.status).toBe(400);
      expect(((await body(res)).error as unknown as { message: string }).message).toContain("nope");
    });

    it("rejects a bad time, a bad zone, a bad theme and an unknown field", async () => {
      const { PUT } = await import("@/app/api/preferences/route");
      for (const patch of [
        { briefTime: "7:30" },
        { timezone: "Mars/Olympus" },
        { theme: "neon" },
        { somethingElse: true },
      ]) {
        const res = await PUT(
          new Request(`${BASE}/api/preferences`, {
            method: "PUT",
            body: JSON.stringify(patch),
          }) as never,
        );
        expect(res.status, JSON.stringify(patch)).toBe(400);
      }
    });
  });

  // ── Brief ─────────────────────────────────────────────────────────────────

  describe("GET /api/brief", () => {
    it("returns a window, a count and the reading time of what it returned", async () => {
      const src = await source("verge-ai");
      await story({ slug: "a", sourceIds: [src], lastActivityAt: new Date(Date.now() - 60_000) });
      const { GET } = await import("@/app/api/brief/route");
      const data = await body(await GET(req("/api/brief")));

      expect(data.length).toBe("10");
      expect(data.count).toBe(1);
      const window = data.window as unknown as { from: string; to: string; briefTime: string };
      expect(window.briefTime).toBe("07:30");
      expect(Date.parse(window.from)).toBeLessThan(Date.parse(window.to));
      // count and readingMinutes describe the RESPONSE, not the window.
      const stories = data.stories as unknown as { readingMinutes: number }[];
      expect(stories).toHaveLength(data.count as unknown as number);
      expect(data.readingMinutes).toBe(stories.reduce((n, s) => n + s.readingMinutes, 0));
    });

    it("carries whyItMatters on brief cards too", async () => {
      const src = await source("verge-ai");
      const id = await story({
        slug: "a",
        sourceIds: [src],
        lastActivityAt: new Date(Date.now() - 60_000),
      });
      await sql.unsafe(
        `update stories set why_it_matters = 'Because it matters.' where id = ${id}`,
      );
      const { GET } = await import("@/app/api/brief/route");
      const data = await body(await GET(req("/api/brief")));
      const cards = data.stories as unknown as { whyItMatters: string | null }[];
      expect(cards[0].whyItMatters).toBe("Because it matters.");
    });

    it("leaves out anything older than the window", async () => {
      const src = await source("verge-ai");
      await story({
        slug: "recent",
        sourceIds: [src],
        lastActivityAt: new Date(Date.now() - 60_000),
      });
      await story({
        slug: "ancient",
        sourceIds: [src],
        lastActivityAt: new Date(Date.now() - 40 * 3_600_000),
      });
      const { GET } = await import("@/app/api/brief/route");
      const data = await body(await GET(req("/api/brief")));
      expect((data.stories as unknown as { slug: string }[]).map((x) => x.slug)).toEqual([
        "recent",
      ]);
    });

    it("leaves a hidden story out of the brief too", async () => {
      // The contract says hidden stories leave EVERY list, and nothing was
      // holding the brief to that: removing the filter reddened nothing.
      const src = await source("verge-ai");
      await story({
        slug: "shown",
        sourceIds: [src],
        lastActivityAt: new Date(Date.now() - 60_000),
      });
      await story({
        slug: "hidden-one",
        sourceIds: [src],
        lastActivityAt: new Date(Date.now() - 60_000),
        hidden: true,
      });
      const { GET } = await import("@/app/api/brief/route");
      const data = await body(await GET(req("/api/brief")));
      expect((data.stories as unknown as { slug: string }[]).map((x) => x.slug)).toEqual(["shown"]);
      expect(data.count).toBe(1);
    });

    it("rejects a length it does not offer", async () => {
      const { GET } = await import("@/app/api/brief/route");
      const res = await GET(req("/api/brief?length=7"));
      expect(res.status).toBe(400);
      expect(((await body(res)).error as unknown as { message: string }).message).toContain(
        "length",
      );
    });
  });

  // ── Histogram ─────────────────────────────────────────────────────────────

  describe("GET /api/radar/histogram", () => {
    it("returns every hour in the window, including the empty ones", async () => {
      const s = await source("verge-ai");
      await story({
        slug: "now-ish",
        sourceIds: [s],
        lastActivityAt: new Date(Date.now() - 30 * 60_000),
      });
      const { GET } = await import("@/app/api/radar/histogram/route");
      const data = await body(await GET(req("/api/radar/histogram")));

      const buckets = data.buckets as unknown as { hour: string; count: number }[];
      // Floor first: every check below passes on an empty array.
      expect(buckets.length).toBeGreaterThanOrEqual(24);
      expect(buckets.some((b) => b.count === 1)).toBe(true);
      expect(buckets.some((b) => b.count === 0)).toBe(true);
      expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(1);

      // Contiguous hours, no gaps: a gap reads as missing data, not as quiet.
      for (let i = 1; i < buckets.length; i++) {
        const gap = Date.parse(buckets[i].hour) - Date.parse(buckets[i - 1].hour);
        expect(gap).toBe(3_600_000);
      }
    });

    it("rejects a filter naming nothing", async () => {
      const { GET } = await import("@/app/api/radar/histogram/route");
      const res = await GET(req("/api/radar/histogram?source=nope"));
      expect(res.status).toBe(400);
      expect((await body(res)).error).toMatchObject({ code: "VALIDATION_ERROR" });
    });
  });
});
