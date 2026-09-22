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

/**
 * The operator secret the guarded routes check (#103). A real-looking value
 * rather than "test": readInternalSecret REFUSES the .env.example placeholders,
 * so a placeholder here would make every guarded route answer 503 and the
 * guard tests would pass for the wrong reason.
 */
const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const req = (path: string) => new Request(`${BASE}${path}`) as never;
const body = async (res: Response) => (await res.json()) as Record<string, never>;

withDb("API routes", () => {
  let admin: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;
  let savedSecret: string | undefined;

  beforeAll(async () => {
    admin = postgres(urlFor("postgres"), { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
    sql = postgres(urlFor(TEST_DB), { max: 4, onnotice: () => {} });
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    // Every dynamic import below now resolves the singleton to this database.
    process.env.DATABASE_URL = urlFor(TEST_DB);
    // The guarded routes read this from the environment at request time.
    savedSecret = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = SECRET;
  }, 60_000);

  afterAll(async () => {
    if (savedSecret === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = savedSecret;
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
    adjacentTech?: boolean;
  }) {
    const at = opts.lastActivityAt ?? new Date(Date.now() - 3_600_000);
    const [s] = await sql.unsafe(
      `insert into stories (slug,title,content_type,verification,verification_note,first_seen_at,last_activity_at,source_count,score,adjacent_tech)
       values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9) returning id`,
      [
        opts.slug,
        opts.title ?? opts.slug,
        opts.contentType ?? "NEWS",
        opts.verification ?? "CORROBORATED",
        "how this was graded",
        at.toISOString(),
        opts.sourceIds.length,
        opts.score ?? 0,
        opts.adjacentTech ?? false,
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
      // The fields the contract deliberately withholds, under one RULE rather
      // than a list: fields that can carry operator-supplied or
      // component-written text stay out, because this response is
      // unauthenticated (#101).
      expect(list[0]).not.toHaveProperty("config");
      expect(list[0]).not.toHaveProperty("url");
      expect(JSON.stringify(list[0])).not.toContain("must not be exposed");
    });

    /**
     * #101. `sources.lastError` holds arbitrary text written by the worker,
     * and #99 measured that text carrying `getaddrinfo ENOTFOUND <host>` and
     * `role "<user>" does not exist`. This route has no authentication, so
     * every byte of it is public.
     *
     * ASSERTED AT THE API BOUNDARY, NOT AT THE WRITE SITES. The writers keep
     * changing; a per-writer assertion is a sweep whose predicate is narrower
     * than its claim, and it goes stale the first time someone adds a writer.
     * This is the one place every writer's output must pass through to become
     * public.
     */
    it("never serves lastError, whatever the worker wrote into it", async () => {
      const CANARY = 'zz-canary-9q7x.example.invalid:59999 role "leaked-user"';
      await source("verge-ai");
      await sql.unsafe(`update sources set last_error = $1 where key = 'verge-ai'`, [CANARY]);

      // The fixture must actually carry the string, or a clean result below
      // proves nothing about the route.
      const [stored] = await sql.unsafe(`select last_error from sources where key='verge-ai'`);
      expect(stored.last_error).toBe(CANARY);

      const { GET } = await import("@/app/api/sources/route");
      const payload = await body(await GET());
      const raw = JSON.stringify(payload);

      expect(raw).not.toContain("zz-canary-9q7x.example.invalid");
      expect(raw).not.toContain("leaked-user");
      const list = payload.sources as unknown as Record<string, unknown>[];
      expect(list[0]).not.toHaveProperty("lastError");
    });

    /**
     * The positive beside it, and the reason #101 is not a silent trade.
     * Removing the TEXT must not remove the FACT that a source is broken, or
     * this swaps one silent failure for another — a reader who can see neither
     * the error nor the failure is worse off than before.
     */
    it("still shows a failing source AS failing once the text is gone", async () => {
      await source("blocked-feed");
      await sql.unsafe(`update sources set last_error='anything at all' where key='blocked-feed'`);
      const [src] = await sql.unsafe(`select id from sources where key='blocked-feed'`);
      for (let i = 0; i < 3; i++) {
        await sql.unsafe(
          `insert into ingest_runs (source_id, started_at, finished_at, error)
           values ($1, now() - interval '1 hour', now(), 'a failure')`,
          [src.id],
        );
      }

      const { GET } = await import("@/app/api/sources/route");
      const list = (await body(await GET())).sources as unknown as Record<string, unknown>[];
      const row = list.find((r) => r.key === "blocked-feed")!;

      expect(row).not.toHaveProperty("lastError"); // the text is gone
      expect(row.health).toBe("FAILING"); // the fact is not
      expect(row.consecutiveFailures).toBe(3);
    });

    /**
     * Health over run history. These exist because the pure classifier cannot
     * check the query that feeds it: the consecutive-failure count is computed
     * in SQL, and every interesting case is about which rows it counts.
     */
    async function run(
      sourceId: number,
      at: string,
      outcome: "ok" | "failed" | "in-flight",
    ): Promise<void> {
      await sql.unsafe(
        `insert into ingest_runs (source_id, started_at, finished_at, error)
         values ($1, $2::timestamptz, $3, $4)`,
        [
          sourceId,
          at,
          outcome === "in-flight" ? null : at,
          outcome === "failed" ? "HTTP 403" : null,
        ],
      );
    }

    async function healthOf(key: string) {
      const { GET } = await import("@/app/api/sources/route");
      const data = await body(await GET());
      const list = data.sources as unknown as Record<string, unknown>[];
      const row = list.find((s) => s.key === key);
      expect(row, `no source ${key} in the response`).toBeDefined();
      return row as { health: string; consecutiveFailures: number };
    }

    it("reports a source that has never run as UNKNOWN, not healthy", async () => {
      await source("never-run");
      expect(await healthOf("never-run")).toMatchObject({
        health: "UNKNOWN",
        consecutiveFailures: 0,
      });
    });

    it("reports a source that has never once succeeded as FAILING", async () => {
      // This is import-ai on a hosted runner: refused by IP on every run since
      // the source existed, so there is no last success to count from. The
      // query bounds on negative infinity rather than guarding on null, and
      // without that this source counts zero failures and reads as healthy.
      const id = await source("import-ai");
      await run(id, "2026-09-16T09:00:00Z", "failed");
      await run(id, "2026-09-16T09:30:00Z", "failed");
      await run(id, "2026-09-16T10:00:00Z", "failed");
      expect(await healthOf("import-ai")).toMatchObject({
        health: "FAILING",
        consecutiveFailures: 3,
      });
    });

    it("counts only the failures since the last success", async () => {
      const id = await source("flaky");
      await run(id, "2026-09-16T08:00:00Z", "failed");
      await run(id, "2026-09-16T08:30:00Z", "failed");
      await run(id, "2026-09-16T09:00:00Z", "ok");
      await run(id, "2026-09-16T09:30:00Z", "failed");
      await run(id, "2026-09-16T10:00:00Z", "failed");
      // Five runs, four of them failures, but only two since it last worked —
      // so it is below the threshold and reported OK rather than FAILING.
      expect(await healthOf("flaky")).toMatchObject({ health: "OK", consecutiveFailures: 2 });
    });

    it("clears the count when the most recent run succeeded", async () => {
      const id = await source("recovered");
      await run(id, "2026-09-16T08:00:00Z", "failed");
      await run(id, "2026-09-16T08:30:00Z", "failed");
      await run(id, "2026-09-16T09:00:00Z", "failed");
      await run(id, "2026-09-16T09:30:00Z", "ok");
      expect(await healthOf("recovered")).toMatchObject({ health: "OK", consecutiveFailures: 0 });
    });

    /**
     * Health is per-source, and that is the whole point of #38 — so a suite in
     * which every fixture creates ONE source cannot test it. With a single
     * source the correlated count and a global count over ingest_runs are the
     * same number, and all three `source_id = s.id` correlations in the query
     * can be deleted without a single test failing.
     *
     * In production eighteen sources share that table. A lost correlation
     * marks all eighteen FAILING the moment one crosses the threshold, or lets
     * one healthy feed clear everyone else's count: this ticket's own defect,
     * restored across the whole catalogue.
     *
     * Three tests rather than one clever fixture, because the three
     * correlations need three different arrangements to catch — a single
     * fixture can expose one or another but not all of them at once.
     */
    it("counts each source's failures separately, not the table's", async () => {
      // Catches the correlation on the failure count itself. B's success is
      // EARLIER than A's failures, so without `f.source_id = s.id` the query
      // hands B all three of A's failures and reports B as FAILING.
      const a = await source("blocked-feed");
      const b = await source("working-feed");
      await run(b, "2026-09-16T08:00:00Z", "ok");
      await run(a, "2026-09-16T09:00:00Z", "failed");
      await run(a, "2026-09-16T09:30:00Z", "failed");
      await run(a, "2026-09-16T10:00:00Z", "failed");

      expect(await healthOf("blocked-feed")).toMatchObject({
        health: "FAILING",
        consecutiveFailures: 3,
      });
      expect(await healthOf("working-feed")).toMatchObject({
        health: "OK",
        consecutiveFailures: 0,
      });
    });

    it("does not treat another source's success as this source's", async () => {
      // Catches the correlation on the inner "when did this source last
      // succeed" lookup. B succeeds AFTER A's failures, so without
      // `ok.source_id = s.id` the query believes A last succeeded at 11:00,
      // counts no failures after it, and reports the blocked feed as OK.
      const a = await source("never-succeeded");
      const b = await source("healthy-neighbour");
      await run(a, "2026-09-16T09:00:00Z", "failed");
      await run(a, "2026-09-16T09:30:00Z", "failed");
      await run(a, "2026-09-16T10:00:00Z", "failed");
      await run(b, "2026-09-16T11:00:00Z", "ok");

      expect(await healthOf("never-succeeded")).toMatchObject({
        health: "FAILING",
        consecutiveFailures: 3,
      });
      expect(await healthOf("healthy-neighbour")).toMatchObject({ health: "OK" });
    });

    it("keeps a source with no runs UNKNOWN while another source has many", async () => {
      // Catches the correlation on the completed-run count. Without
      // `r.source_id = s.id` the untouched source inherits its neighbour's
      // three completed runs, stops being UNKNOWN, and reports OK — a source
      // nobody has ever fetched described as working.
      const a = await source("busy-feed");
      await source("untouched-feed");
      await run(a, "2026-09-16T09:00:00Z", "failed");
      await run(a, "2026-09-16T09:30:00Z", "failed");
      await run(a, "2026-09-16T10:00:00Z", "failed");

      expect(await healthOf("untouched-feed")).toMatchObject({
        health: "UNKNOWN",
        consecutiveFailures: 0,
      });
      expect(await healthOf("busy-feed")).toMatchObject({ health: "FAILING" });
    });

    it("keeps a source whose only run is still in flight UNKNOWN", async () => {
      // The case the pure classifier cannot express: in-flight is decided
      // entirely in SQL. One row, no error and no finish time, so there are no
      // completed runs and the source has not yet told us anything.
      const id = await source("just-started");
      await run(id, "2026-09-16T09:00:00Z", "in-flight");
      expect(await healthOf("just-started")).toMatchObject({
        health: "UNKNOWN",
        consecutiveFailures: 0,
      });
    });

    it("does not let a run that has only started clear the count", async () => {
      // An in-flight row has no error and no finish time. Treating it as a
      // success would mark a failing source healthy the moment the next pass
      // began — and the next pass begins on the hosted schedule, which is
      // declared half-hourly and measured at about 7 a day (#139).
      const id = await source("mid-run");
      await run(id, "2026-09-16T08:00:00Z", "failed");
      await run(id, "2026-09-16T08:30:00Z", "failed");
      await run(id, "2026-09-16T09:00:00Z", "failed");
      await run(id, "2026-09-16T09:30:00Z", "in-flight");
      expect(await healthOf("mid-run")).toMatchObject({
        health: "FAILING",
        consecutiveFailures: 3,
      });
    });
  });

  describe("PUT /api/internal/sources/:key", () => {
    it("switches a source off", async () => {
      await source("verge-ai");
      const { PUT } = await import("@/app/api/internal/sources/[key]/route");
      const request = new Request(`${BASE}/api/internal/sources/verge-ai`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
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
      const { PUT } = await import("@/app/api/internal/sources/[key]/route");
      const request = new Request(`${BASE}/api/internal/sources/verge-ai`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
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
      const { PUT } = await import("@/app/api/internal/sources/[key]/route");
      const request = new Request(`${BASE}/api/internal/sources/nope`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify({ enabled: false }),
      });
      const res = await PUT(
        request as never,
        { params: Promise.resolve({ key: "nope" }) } as never,
      );
      expect(res.status).toBe(404);
      expect((await body(res)).error).toMatchObject({ code: "NOT_FOUND" });
    });

    // ── #103: the guard ──────────────────────────────────────────────────────
    // This route used to live at /api/sources/[key] with no guard at all, so
    // anyone who could reach the port could disable every source by key — and
    // the keys are in seed-data.ts, in a public repository.
    it("refuses an unauthenticated write AND LEAVES THE ROW UNCHANGED", async () => {
      await source("verge-ai"); // enabled: true

      const { PUT } = await import("@/app/api/internal/sources/[key]/route");
      const request = new Request(`${BASE}/api/internal/sources/verge-ai`, {
        method: "PUT",
        headers: { "content-type": "application/json" }, // no x-internal-secret
        body: JSON.stringify({ enabled: false }),
      });
      const res = await PUT(
        request as never,
        { params: Promise.resolve({ key: "verge-ai" }) } as never,
      );

      expect(res.status).toBe(401);

      // THE ROW IS THE ASSERTION, not the status. A route that returns 401 and
      // writes anyway passes a status-only check, and the write is the harm.
      const [row] = await sql.unsafe(`select enabled from sources where key = 'verge-ai'`);
      expect(row.enabled).toBe(true);
    });

    it("refuses a WRONG secret and leaves the row unchanged", async () => {
      await source("verge-ai");
      const { PUT } = await import("@/app/api/internal/sources/[key]/route");
      const request = new Request(`${BASE}/api/internal/sources/verge-ai`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-internal-secret": `${SECRET}x` },
        body: JSON.stringify({ enabled: false }),
      });
      const res = await PUT(
        request as never,
        { params: Promise.resolve({ key: "verge-ai" }) } as never,
      );
      expect(res.status).toBe(401);
      const [row] = await sql.unsafe(`select enabled from sources where key = 'verge-ai'`);
      expect(row.enabled).toBe(true);
    });

    /**
     * The OTHER internal route, covered here because #103's claim is about the
     * boundary rather than about one route.
     *
     * src/worker/trigger.test.ts already tests handleIngestTrigger deeply — it
     * asserts 401 AND that no ingest_runs row appeared, on every refusal path.
     * But it tests the FUNCTION. Nothing imported the ROUTE MODULE, whose whole
     * body is `return handleIngestTrigger(request, ...)`. If that wrapper ever
     * stopped delegating, every existing test stayed green.
     *
     * That is the same import-versus-call gap that internal-guard.test.ts
     * documents about itself, one level up: the reachability check proves the
     * route imports the trigger, not that it calls it. This closes it for the
     * refusal path, which is the path the guard claim rests on.
     *
     * Only the refusal is exercised. A request WITH the secret would run a real
     * ingestion pass over the network, which is not this suite's job.
     */
    it("the ingest route module refuses an unauthenticated POST and records no run", async () => {
      const { POST } = await import("@/app/api/internal/ingest/route");
      const before = await sql.unsafe(`select count(*)::int as n from ingest_runs`);

      const res = await POST(
        new Request(`${BASE}/api/internal/ingest`, { method: "POST" }) as never,
      );

      expect(res.status).toBe(401);
      // The effect, not the status. A wrapper that 401s and ingests anyway
      // passes a status-only check.
      const after = await sql.unsafe(`select count(*)::int as n from ingest_runs`);
      expect(after[0].n).toBe(before[0].n);
    });

    /**
     * The positive for the wrapper, and it closes a mode the refusal test
     * cannot see.
     *
     *   wrapper stops refusing (200, or bypasses the guard) -> refusal test RED
     *   wrapper ALWAYS refuses (401 regardless of secret)   -> refusal test GREEN
     *
     * The second is not harmless: a permanently-401 ingest trigger means
     * ingestion never runs, nothing reports a failure, and the news quietly
     * stops. That is #104's shape one layer up — "collected nothing" and "had
     * nothing to collect" being indistinguishable — so the two tickets are
     * related rather than merely adjacent.
     *
     * This runs a REAL pass, and it costs nothing because the catalogue is
     * empty: runIngest selects enabled sources, finds none, and never enters
     * its loop, so no request leaves the machine. (trigger.test.ts takes the
     * other approach for the function — one source pointed at a closed port.)
     *
     * WHAT "NO REQUEST LEAVES THE MACHINE" ACTUALLY RESTS ON, because it is
     * not the beforeEach. It is that TRUNCATE_ALL is DERIVED rather than
     * enumerated: src/db/tables.ts reads the schema module's own exports and
     * filters for PgTable, so `sources` is covered by construction. A
     * hand-written truncate list that happened to omit it would leave a seeded
     * catalogue standing, and this test would fetch every feed over the
     * network — surfacing later as an order-dependent flake rather than as an
     * error. That file's own comment records three test files each carrying
     * their own list and each missing a DIFFERENT table, so it is the defect
     * it was written to retire rather than a hypothetical.
     *
     * The floor below is what keeps this true as the suite changes: it asserts
     * the catalogue is empty BEFORE the POST, so a future change that seeds
     * sources fails here loudly instead of quietly turning this into a
     * network test.
     *
     * What it still does not prove: that the guard runs BEFORE any work. That
     * is trigger.test.ts's job and it asserts it directly — every refusal path
     * leaves runCount() at zero.
     */
    it("the ingest route module ACCEPTS a correct secret, so it does not simply refuse everything", async () => {
      const { POST } = await import("@/app/api/internal/ingest/route");
      const sources0 = await sql.unsafe(`select count(*)::int as n from sources`);
      expect(sources0[0].n).toBe(0); // the floor: an empty catalogue is why this is free

      const res = await POST(
        new Request(`${BASE}/api/internal/ingest`, {
          method: "POST",
          headers: { "x-internal-secret": SECRET },
        }) as never,
      );

      expect(res.status).toBe(200);
      const payload = await body(res);
      expect(payload.ran).toBe(true);
      expect(payload.sources).toBe(0);
    });

    // The positive beside the negatives. Without it, a route that refused
    // EVERYTHING — a guard that never lets anyone through, or a handler that
    // 401s unconditionally — would satisfy both tests above.
    it("allows the write when the secret is correct, so the guard discriminates", async () => {
      await source("verge-ai");
      const { PUT } = await import("@/app/api/internal/sources/[key]/route");
      const request = new Request(`${BASE}/api/internal/sources/verge-ai`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify({ enabled: false }),
      });
      const res = await PUT(
        request as never,
        { params: Promise.resolve({ key: "verge-ai" }) } as never,
      );
      expect(res.status).toBe(200);
      const [row] = await sql.unsafe(`select enabled from sources where key = 'verge-ai'`);
      expect(row.enabled).toBe(false);
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

  describe("adjacent tech is kept and not shown by default", () => {
    /**
     * The second half of #71's acceptance. The first half — that the item is
     * STORED rather than discarded — is in run.test.ts against a real ingest,
     * because a filter test over a planted row cannot tell a working filter
     * from an item that was never kept.
     */
    async function twoStories() {
      const id = await source("verge-ai");
      await story({ slug: "an-ai-story", sourceIds: [id], score: 10 });
      await story({ slug: "a-dev-tool", sourceIds: [id], score: 20, adjacentTech: true });
    }

    it("leaves adjacent tech out of the brief", async () => {
      await twoStories();
      const { GET } = await import("@/app/api/brief/route");
      const data = await body(await GET(req("/api/brief")));
      const slugs = (data.stories as { slug: string }[]).map((s) => s.slug);
      expect(slugs).toContain("an-ai-story");
      expect(slugs).not.toContain("a-dev-tool");
    });

    it("leaves it out of Radar, and shows it when the reader asks", async () => {
      await twoStories();
      const { GET } = await import("@/app/api/radar/route");

      const def = await body(await GET(req("/api/radar")));
      const defaultSlugs = (def.stories as { slug: string }[]).map((s) => s.slug);
      expect(defaultSlugs).toEqual(["an-ai-story"]);

      const all = await body(await GET(req("/api/radar?view=everything")));
      const everySlug = (all.stories as { slug: string }[]).map((s) => s.slug);
      // Both halves asserted in one call: the adjacent story appears AND the
      // AI one is still there. A widened view that swapped the set rather than
      // extending it would pass a test that only looked for the new row.
      expect(everySlug).toContain("a-dev-tool");
      expect(everySlug).toContain("an-ai-story");
    });

    it("refuses an unrecognised view rather than guessing", async () => {
      // Ruled for the project: an unknown value never widens — the API refuses
      // it, the page narrows. Refusing is the strict form, and it is what
      // every other enum parameter in params.ts already does.
      await twoStories();
      const { GET } = await import("@/app/api/radar/route");
      const res = await GET(req("/api/radar?view=evrything"));
      expect(res.status).toBe(400);
      expect((await body(res)).error).toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("treats an ABSENT view as no preference, not as an error", async () => {
      // Absent and unrecognised are different answers. Silence is the case
      // that has to stay backwards compatible: a caller from before any of
      // this gets what the route answered then.
      await twoStories();
      const { GET } = await import("@/app/api/radar/route");
      const res = await GET(req("/api/radar"));
      expect(res.status).toBe(200);
      expect((await body(res)).stories).toHaveLength(1);
    });
  });

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
      expect(data).toMatchObject({ briefTime: "07:30", timezone: "UTC" });
      expect(data.topicKeys).toEqual([]);

      // #94: what this row must NO LONGER carry. These are the reader's, not
      // the instance's, and one shared row served them to every reader of it —
      // the email being personal data collected for a feature that does not
      // exist. Asserting their ABSENCE is the guard: without it, putting any of
      // them back would ship silently and this test would still pass.
      for (const gone of ["email", "briefLength", "theme", "onboardedAt"]) {
        expect(data, `${gone} is back in the shared preferences row`).not.toHaveProperty(gone);
      }
    });

    it("updates only the fields it is given", async () => {
      await topic("openai", "OpenAI");
      const { GET, PUT } = await import("@/app/api/preferences/route");
      await GET();
      const res = await PUT(
        new Request(`${BASE}/api/preferences`, {
          method: "PUT",
          body: JSON.stringify({ timezone: "Europe/Lisbon", topicKeys: ["openai"] }),
        }) as never,
      );
      expect(res.status).toBe(200);
      const data = await body(res);
      // The one it was given changed; the one it was not kept its default.
      expect(data).toMatchObject({ timezone: "Europe/Lisbon", briefTime: "07:30" });
      expect(data.topicKeys).toEqual(["openai"]);

      // And a field that moved to the device is REFUSED rather than ignored.
      // preferencesPatchSchema is .strict(), so this is the difference between
      // the column being gone and the write being quietly dropped — a dropped
      // write is a preference the reader believes they set.
      const refused = await PUT(
        new Request(`${BASE}/api/preferences`, {
          method: "PUT",
          body: JSON.stringify({ briefLength: "5" }),
        }) as never,
      );
      expect(refused.status).toBe(400);
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

  /**
   * #84 — A SHOW HN LAUNCH HAS TWO LINKS AND THE CONTRACT CARRIED ONE.
   *
   * The adapter built both and kept one: `url: it.url ?? hnUrl`, with the
   * thread going into `metadata`, which was never selected by buildCards and
   * so never left the server. The `??` did the damage in the harmful
   * direction — a post WITH a project link lost its discussion, and a post
   * WITHOUT one lost nothing, because there was nothing else. The interesting
   * case was exactly the broken one.
   *
   * THESE TESTS DRIVE THE REAL ADAPTER AND THE REAL ROUTE. The rows below are
   * built from the adapter's OWN OUTPUT — `item.url` and `item.metadata`, not
   * values typed here — so if the adapter stops writing the thread link, the
   * input to this test changes and the assertions fail. A test that wrote the
   * metadata by hand would prove the route can carry a field, which was never
   * in doubt; the defect was whether this path carries THIS value.
   */
  describe("a Show HN launch carries both of its links (#84)", () => {
    /** The real adapter, over an injected fetch. No network, no fixtures. */
    async function showHnItems() {
      const { hackerNewsAdapter } = await import("@/sources/hackernews/adapter");
      const now = Math.floor(Date.now() / 1000) - 600;
      const ITEMS: Record<string, unknown> = {
        // WITH a project link: the case that was broken.
        "111": {
          id: 111,
          type: "story",
          title: "Show HN: an AI radar that reads your sources for you",
          by: "builder",
          time: now,
          score: 140,
          descendants: 62,
          url: "https://example.com/ai-radar",
        },
        // WITHOUT one: today's correct behaviour, which must not regress.
        "222": {
          id: 222,
          type: "story",
          title: "Show HN: I trained a small model on my own notes",
          by: "another",
          time: now,
          score: 95,
          descendants: 18,
        },
      };
      const fetchImpl = (async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.endsWith("showstories.json")) return Response.json([111, 222]);
        const m = u.match(/item\/(\d+)\.json/);
        if (m) return Response.json(ITEMS[m[1]] ?? null);
        throw new Error(`unexpected fetch: ${u}`);
      }) as unknown as typeof fetch;

      return hackerNewsAdapter.fetch(
        { config: { list: "show", minPoints: 1, keywordPolicy: "label" } } as never,
        { fetch: fetchImpl, log: () => {} } as never,
      );
    }

    /** Files one adapter item as a story, using ITS values rather than mine. */
    async function fileAsStory(
      item: Awaited<ReturnType<typeof showHnItems>>[number],
      slug: string,
    ) {
      const hn = await source(`hn-${slug}`, { name: "Hacker News", kind: "hackernews" });
      const when = new Date(Date.now() - 600_000).toISOString();
      const [st] = await sql.unsafe(
        `insert into stories (slug,title,content_type,verification,verification_note,first_seen_at,last_activity_at,source_count,score,adjacent_tech)
         values ($1,$2,'RELEASE','PRIMARY_SOURCE','graded',$3,$3,1,10,false) returning id`,
        [slug, item.title, when],
      );
      const storyId = Number(st.id);
      const [ri] = await sql.unsafe(
        `insert into raw_items (source_id,external_id,url,canonical_url,title,excerpt,published_at,fetched_at,content_type,metadata,fingerprint,story_id,role)
         values ($1,$2,$3,$3,$4,$5,$6,$6,'RELEASE',$7,$8,$9,'primary') returning id`,
        [
          hn,
          item.externalId,
          item.url,
          item.title,
          item.excerpt ?? "a launch",
          when,
          JSON.stringify(item.metadata ?? {}),
          `${slug}-fp`,
          storyId,
        ],
      );
      await sql.unsafe(`update stories set primary_item_id = $1 where id = $2`, [
        Number(ri.id),
        storyId,
      ]);
      return slug;
    }

    async function read(slug: string) {
      const { GET } = await import("@/app/api/stories/[slug]/route");
      const res = await GET(req(`/api/stories/${slug}`), {
        params: Promise.resolve({ slug }),
      } as never);
      expect(res.status).toBe(200);
      return body(res);
    }

    it("serves the project link AND the discussion link, distinctly", async () => {
      const items = await showHnItems();
      const withProject = items.find((i) => i.externalId === "111");
      // THE FLOOR. If the adapter stopped returning this item the assertions
      // below would vacuously pass on `undefined`, and the test would report a
      // healthy contract over an adapter that had stopped producing input.
      expect(
        withProject,
        "the adapter returned no item for the Show HN post with a project link",
      ).toBeDefined();

      const d = await read(await fileAsStory(withProject!, "show-hn-with-project"));

      expect(d.url).toBe("https://example.com/ai-radar");
      expect(d.discussionUrl).toBe("https://news.ycombinator.com/item?id=111");
      // The point of the ticket: two links, and they are not the same link.
      expect(d.discussionUrl).not.toBe(d.url);
    });

    it("leaves no second link when the launch has only a thread, and does not repeat the first", async () => {
      const items = await showHnItems();
      const threadOnly = items.find((i) => i.externalId === "222");
      expect(
        threadOnly,
        "the adapter returned no item for the Show HN post without a project link",
      ).toBeDefined();

      const d = await read(await fileAsStory(threadOnly!, "show-hn-thread-only"));

      // Today's correct behaviour, asserted so the fix cannot regress it: the
      // thread IS the story's link, and there is no second one.
      expect(d.url).toBe("https://news.ycombinator.com/item?id=222");
      expect(d.discussionUrl).toBeNull();
    });
  });

  /**
   * #15 / #138 — "NO SUMMARY" IS THREE FACTS AND THE CONTRACT CARRIES WHICH.
   *
   * The summariser ships OFF, so almost every story has no summary. But
   *
   *   summarizedAt null                  nobody tried — no provider configured
   *   summarizedAt set, summary null     tried, and produced nothing
   *   summarizedAt set, summary present  done
   *
   * are different answers, and only the middle one is a reason to distrust the
   * page. Collapsing the first two is the absence-versus-failure defect, so the
   * route has to expose enough to tell them apart — which it did not until the
   * story page needed it.
   */
  describe("the story contract distinguishes never-summarised from summarised-and-empty (#15)", () => {
    async function detailFor(slug: string, summary: string | null, summarizedAt: Date | null) {
      const src = await source(`sum-${slug}`);
      const at = new Date(Date.now() - 3_600_000);
      const [st] = await sql.unsafe(
        `insert into stories (slug,title,summary,summarized_at,summary_provider,content_type,verification,verification_note,first_seen_at,last_activity_at,source_count,score,adjacent_tech)
         values ($1,$2,$3,$4,$5,'NEWS','CORROBORATED','graded',$6,$6,1,5,false) returning id`,
        [
          slug,
          `story ${slug}`,
          summary,
          summarizedAt?.toISOString() ?? null,
          summary ? "test-provider" : null,
          at.toISOString(),
        ],
      );
      const storyId = Number(st.id);
      const [ri] = await sql.unsafe(
        `insert into raw_items (source_id,external_id,url,canonical_url,title,excerpt,published_at,fetched_at,content_type,metadata,fingerprint,story_id,role)
         values ($1,$2,$3,$3,$4,'the source own excerpt',$5,$5,'NEWS','{}',$6,$7,'primary') returning id`,
        [
          src,
          `${slug}-x`,
          `https://example.com/${slug}`,
          `story ${slug}`,
          at.toISOString(),
          `${slug}-fp`,
          storyId,
        ],
      );
      await sql.unsafe(`update stories set primary_item_id = $1 where id = $2`, [
        Number(ri.id),
        storyId,
      ]);
      const { GET } = await import("@/app/api/stories/[slug]/route");
      const res = await GET(req(`/api/stories/${slug}`), {
        params: Promise.resolve({ slug }),
      } as never);
      expect(res.status).toBe(200);
      return body(res);
    }

    it("reports never-tried as summarizedAt null, with the excerpt still carrying the page", async () => {
      const d = await detailFor("never-tried", null, null);
      expect(d.summary).toBeNull();
      expect(d.summarizedAt).toBeNull();
      expect(d.summaryProvider).toBeNull();
      // The fallback the page renders. Without it a never-summarised story
      // would be a blank screen rather than a thinner one.
      expect(d.excerpt).toBe("the source own excerpt");
    });

    it("reports tried-and-empty as summarizedAt SET with summary still null", async () => {
      const when = new Date(Date.now() - 600_000);
      const d = await detailFor("tried-and-empty", null, when);
      expect(d.summary).toBeNull();
      // THE DISTINCTION. Same null summary as above, different fact, and the
      // only thing that tells them apart is this field being present.
      expect(d.summarizedAt).not.toBeNull();
      expect(new Date(d.summarizedAt as string).toISOString()).toBe(when.toISOString());
    });

    it("reports a real summary with the provider that wrote it", async () => {
      const d = await detailFor("summarised", "a real summary", new Date());
      expect(d.summary).toBe("a real summary");
      expect(d.summarizedAt).not.toBeNull();
      expect(d.summaryProvider).toBe("test-provider");
    });
  });

  /**
   * #148 — A BRIEF IS WHAT ARRIVED FOR YOU, NOT WHAT WAS PUBLISHED TODAY.
   *
   * The owner opened the live site at a 07:30 window and read "nothing has
   * arrived since your brief window opened — the database answered, so this is
   * a quiet morning rather than a fault." The collector had written 64 stories
   * that day and 13 more at 12:17.
   *
   * Admission keyed on stories.lastActivityAt, which is the newest PUBLISHED
   * time of a story's items. Publishers file overnight and we sweep in the
   * morning, so a story published at 02:00 and fetched at 12:17 sat outside a
   * 07:30 window for the whole day it arrived in. Which is most stories.
   */
  describe("the brief admits by ARRIVAL, not by publication (#148)", () => {
    /** Files one story with publication and arrival set independently. */
    async function fileStory(slug: string, publishedAt: Date, fetchedAt: Date) {
      const src = await source(`arr-${slug}`);
      const [st] = await sql.unsafe(
        `insert into stories (slug,title,content_type,verification,verification_note,first_seen_at,last_activity_at,source_count,score,adjacent_tech)
         values ($1,$2,'NEWS','CORROBORATED','graded',$3,$3,1,5,false) returning id`,
        [slug, `story ${slug}`, publishedAt.toISOString()],
      );
      const storyId = Number(st.id);
      const [ri] = await sql.unsafe(
        `insert into raw_items (source_id,external_id,url,canonical_url,title,excerpt,published_at,fetched_at,content_type,metadata,fingerprint,story_id,role)
         values ($1,$2,$3,$3,$4,'an excerpt',$5,$6,'NEWS','{}',$7,$8,'primary') returning id`,
        [
          src,
          `${slug}-x`,
          `https://example.com/${slug}`,
          `story ${slug}`,
          publishedAt.toISOString(),
          fetchedAt.toISOString(),
          `${slug}-fp`,
          storyId,
        ],
      );
      await sql.unsafe(`update stories set primary_item_id = $1 where id = $2`, [
        Number(ri.id),
        storyId,
      ]);
      return slug;
    }

    async function briefSlugs() {
      const { GET } = await import("@/app/api/brief/route");
      const res = await GET(req("/api/brief?view=all&length=all"));
      expect(res.status).toBe(200);
      const d = await body(res);
      return (d.stories as { slug: string }[]).map((s) => s.slug);
    }

    it("includes a story PUBLISHED before the window but FETCHED inside it", async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3_600_000);
      await fileStory("overnight-but-fetched-today", threeDaysAgo, new Date());

      // THE ASSERTION THE OWNER'S MORNING NEEDED. Under the old rule this was
      // absent, and the screen called it a quiet morning.
      expect(await briefSlugs()).toContain("overnight-but-fetched-today");
    });

    it("still excludes a story that arrived before the window, so the window means something", async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3_600_000);
      await fileStory("old-and-already-seen", threeDaysAgo, threeDaysAgo);

      // The control. Without this, "admit everything" would pass the test
      // above and the window would have stopped meaning anything at all.
      expect(await briefSlugs()).not.toContain("old-and-already-seen");
    });

    it("reports what the collector has done, so an empty brief can say why", async () => {
      const { GET } = await import("@/app/api/brief/route");
      const res = await GET(req("/api/brief?view=all&length=all"));
      const d = await body(res);
      expect(d.sweep).toBeDefined();
      expect(d.sweep).toHaveProperty("lastFinishedAt");
      expect(d.sweep).toHaveProperty("itemsSinceWindowOpened");
    });
  });

  /**
   * unknownKeys, pinned directly rather than incidentally (#154 review).
   *
   * The review flagged the old implementation — a JS array interpolated into a
   * raw `sql` template — as the same shape as the Date that would have made
   * every brief request a 500, and as untested.
   *
   * THE SHAPE IS RIGHT AND THE CONCLUSION WAS NOT: the old code worked, and it
   * WAS covered — "/api/radar?topic=does-not-exist" above reaches it with a
   * non-empty array and gets its 400. The whole file passed against it. So the
   * change to `inArray` is HARDENING, not a bug fix: it stops the behaviour
   * depending on how a raw template happens to expand an array, and types the
   * comparison against the column.
   *
   * These two pin it directly, because the existing coverage proves the
   * ROUTE's verdict and never states what unknownKeys itself returns — which
   * is the thing a future refactor would change.
   */
  describe("unknownKeys names exactly the keys that are missing", () => {
    it("separates present keys from absent ones rather than answering all-or-nothing", async () => {
      await topic("openai", "OpenAI");
      await topic("anthropic", "Anthropic");
      const { unknownKeys } = await import("@/api/radar");
      const { getDb } = await import("@/db/client");

      expect(await unknownKeys(getDb(), "topic", ["openai", "anthropic"])).toEqual([]);
      // THE MIXED CASE. An implementation that returned everything, or nothing,
      // whenever any key was missing would satisfy a test that only ever asked
      // about one key at a time.
      expect(await unknownKeys(getDb(), "topic", ["openai", "ghost", "anthropic"])).toEqual([
        "ghost",
      ]);
    });

    it("answers for sources too, on the same shape", async () => {
      await source("a-real-source");
      const { unknownKeys } = await import("@/api/radar");
      const { getDb } = await import("@/db/client");
      expect(await unknownKeys(getDb(), "source", ["a-real-source", "nope"])).toEqual(["nope"]);
    });
  });
});
