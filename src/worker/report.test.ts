import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IngestResult, SourceRunResult } from "@/pipeline/run";
import {
  describeEmptyPass,
  exitCodeFor,
  formatSourceLine,
  formatTotalLine,
  formatWorkerFailure,
  MINIMUM_INTERVAL_MINUTES,
  readIntervalMinutes,
} from "./report";

const ok = (over: Partial<SourceRunResult> = {}): SourceRunResult => ({
  sourceKey: "arxiv",
  fetched: 25,
  inserted: 4,
  error: null,
  ...over,
});

describe("formatSourceLine", () => {
  it("reports both counts for a source that worked", () => {
    expect(formatSourceLine(ok())).toBe("  arxiv: 25 fetched, 4 new");
  });

  it("says a source failed and why", () => {
    const line = formatSourceLine(ok({ error: "connect ECONNREFUSED" }));
    expect(line).toContain("arxiv");
    expect(line).toContain("FAILED");
    expect(line).toContain("connect ECONNREFUSED");
  });

  it("keeps a multi-line error on one line", () => {
    // runIngest stores the error with the source's log lines appended, so the
    // stored value is routinely several lines. The summary promises one line
    // per source; the full text is in ingest_runs.error.
    const line = formatSourceLine(
      ok({ error: "relation does not exist\n[arxiv] fetching page 1\n[arxiv] gave up" }),
    );
    expect(line).not.toContain("\n");
    expect(line).toContain("relation does not exist");
  });

  it("still reports the counts a failing source managed before it failed", () => {
    const line = formatSourceLine(ok({ fetched: 10, inserted: 3, error: "boom" }));
    expect(line).toContain("10 fetched");
    expect(line).toContain("3 new");
  });
});

describe("formatTotalLine", () => {
  const result: IngestResult = {
    bySource: [ok(), ok({ sourceKey: "hackernews", fetched: 30, inserted: 0 })],
    itemsInserted: 4,
    storiesCreated: 2,
    sourcesConfigured: 2,
    sourcesEnabled: 2,
  };

  it("totals the sources, the items and the stories", () => {
    const line = formatTotalLine(result, 2_300);
    expect(line).toContain("2 sources");
    expect(line).toContain("55 fetched");
    expect(line).toContain("4 new");
    expect(line).toContain("2 stories");
  });

  it("names how many sources failed so a failure cannot hide in a green total", () => {
    const withFailure: IngestResult = {
      ...result,
      bySource: [ok(), ok({ sourceKey: "verge", error: "boom" })],
    };
    expect(formatTotalLine(withFailure, 10)).toContain("1 failed");
  });

  it("says nothing about failures when every source worked", () => {
    expect(formatTotalLine(result, 10)).not.toContain("failed");
  });

  it("reports how long the run took", () => {
    expect(formatTotalLine(result, 2_300)).toContain("2.3s");
  });
});

describe("formatWorkerFailure", () => {
  /**
   * #92. This is the worker's last line before it exits non-zero, printed by
   * a schedule that runs against the real DATABASE_URL in a public repository.
   * It used to print `error.message`, and `npm run worker:once` against an
   * unreachable host put `getaddrinfo ENOTFOUND <host>` in the clear.
   *
   * Every message below was CAPTURED from that probe, not invented.
   */
  const URL_ =
    "postgres://UsrSweep9q7x:PwSweep9q7x@zz-sweep-9q7x.example.invalid:59999/DbSweep9q7x";
  const FRAGMENTS = [
    "zz-sweep-9q7x.example.invalid",
    "59999",
    "UsrSweep9q7x",
    "PwSweep9q7x",
    "DbSweep9q7x",
  ];

  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = URL_;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  });

  for (const [shape, message, keeps] of [
    ["ENOTFOUND", "getaddrinfo ENOTFOUND zz-sweep-9q7x.example.invalid", "ENOTFOUND"],
    [
      "CONNECT_TIMEOUT",
      "write CONNECT_TIMEOUT zz-sweep-9q7x.example.invalid:59999",
      "CONNECT_TIMEOUT",
    ],
    ["the server's own sentence", 'role "UsrSweep9q7x" does not exist', "does not exist"],
  ] as const) {
    it(`redacts every credential fragment: ${shape}`, () => {
      // The fixture must carry something worth redacting, or a clean result
      // below proves nothing.
      expect(FRAGMENTS.some((f) => message.includes(f))).toBe(true);

      const line = formatWorkerFailure(new Error(message));
      for (const fragment of FRAGMENTS) expect(line).not.toContain(fragment);

      // The positive beside the negatives: an operator still learns what broke.
      expect(line).toContain(keeps);
      expect(line).toContain("[worker]");
    });
  }

  it("leaves an ordinary failure untouched", () => {
    // Most worker failures are not database failures. This is the case that
    // would notice a redaction aggressive enough to mangle unrelated text.
    expect(formatWorkerFailure(new Error("HTTP 403 from the publisher"))).toBe(
      "[worker] HTTP 403 from the publisher",
    );
  });

  it("handles a non-Error without throwing, because the catch takes unknown", () => {
    expect(formatWorkerFailure("plain string")).toBe("[worker] plain string");
  });
});

describe("readIntervalMinutes", () => {
  it("defaults to the interval .env.example ships with", () => {
    // Read from the file rather than repeated here, so the default and the
    // documented value cannot drift apart without this failing.
    const text = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
    const documented = Number(/^INGEST_INTERVAL_MINUTES=(.*)$/m.exec(text)?.[1]?.trim());
    expect(documented).toBeGreaterThan(0);
    expect(readIntervalMinutes({})).toBe(documented);
    expect(readIntervalMinutes({ INGEST_INTERVAL_MINUTES: "" })).toBe(documented);
  });

  it("uses the configured interval", () => {
    expect(readIntervalMinutes({ INGEST_INTERVAL_MINUTES: "15" })).toBe(15);
  });

  it("refuses an interval of zero, which would busy-loop", () => {
    expect(() => readIntervalMinutes({ INGEST_INTERVAL_MINUTES: "0" })).toThrow(
      /INGEST_INTERVAL_MINUTES/,
    );
  });

  it("refuses a negative interval", () => {
    expect(() => readIntervalMinutes({ INGEST_INTERVAL_MINUTES: "-5" })).toThrow(
      /INGEST_INTERVAL_MINUTES/,
    );
  });

  it("refuses an interval below the floor, which would hammer other people's feeds", () => {
    // 0.01 is a pass every 0.6 seconds across every configured source. The
    // function already refuses a value it cannot parse because a schedule
    // nobody chose is a bug; a schedule nobody could have wanted is worse.
    expect(() => readIntervalMinutes({ INGEST_INTERVAL_MINUTES: "0.01" })).toThrow(
      /INGEST_INTERVAL_MINUTES/,
    );
    expect(() => readIntervalMinutes({ INGEST_INTERVAL_MINUTES: "0.5" })).toThrow(
      /INGEST_INTERVAL_MINUTES/,
    );
  });

  it("names the floor in the message, so the fix is obvious", () => {
    expect(() => readIntervalMinutes({ INGEST_INTERVAL_MINUTES: "0.01" })).toThrow(
      new RegExp(String(MINIMUM_INTERVAL_MINUTES)),
    );
  });

  it("accepts the floor itself", () => {
    // The boundary belongs in the test: a floor written with the wrong
    // comparison refuses the value it is meant to allow.
    expect(readIntervalMinutes({ INGEST_INTERVAL_MINUTES: String(MINIMUM_INTERVAL_MINUTES) })).toBe(
      MINIMUM_INTERVAL_MINUTES,
    );
  });

  it("refuses a value that is not a number, rather than silently falling back", () => {
    // A typo that quietly becomes the default is how a worker ends up running
    // on a schedule nobody chose.
    expect(() => readIntervalMinutes({ INGEST_INTERVAL_MINUTES: "half an hour" })).toThrow(
      /INGEST_INTERVAL_MINUTES/,
    );
  });
});

describe("exitCodeFor", () => {
  /**
   * Defaults describe a HEALTHY catalogue that ran, so a test about failing
   * sources is not accidentally also a test about an empty catalogue. #104's
   * cases pass their counts explicitly.
   */
  const result = (
    bySource: SourceRunResult[],
    catalogue: { configured?: number; enabled?: number } = {},
  ): IngestResult => ({
    bySource,
    itemsInserted: 0,
    storiesCreated: 0,
    sourcesConfigured: catalogue.configured ?? Math.max(bySource.length, 1),
    sourcesEnabled: catalogue.enabled ?? Math.max(bySource.length, 1),
  });

  it("succeeds when every source worked", () => {
    expect(exitCodeFor(result([ok(), ok({ sourceKey: "hn" })]))).toBe(0);
  });

  it("still succeeds when only some sources failed", () => {
    // One dead feed must not turn a scheduled run red, or the schedule gets
    // muted and a real outage goes unnoticed.
    expect(exitCodeFor(result([ok(), ok({ sourceKey: "hn", error: "boom" })]))).toBe(0);
  });

  it("fails when every source failed", () => {
    // All of them failing is not a feed problem, it is a worker, network or
    // database problem, and the schedule should say so.
    expect(
      exitCodeFor(result([ok({ error: "boom" }), ok({ sourceKey: "hn", error: "boom" })])),
    ).toBe(1);
  });

  /**
   * #104. An empty `bySource` has THREE causes and the old docblock named one.
   * These four cases are the whole contract, kept together so the next person
   * changing one sees what the others cost.
   */
  it("succeeds on a FRESH database, where nothing is seeded yet", () => {
    // Nothing is wrong. This is the case that gets a check deleted rather than
    // fixed if it goes red on first boot.
    expect(exitCodeFor(result([], { configured: 0, enabled: 0 }))).toBe(0);
  });

  it("FAILS when the catalogue exists and every source is switched off", () => {
    // The one the old code could not see. Until #110 this did not need an
    // operator: the route was unauthenticated and the keys are public.
    expect(exitCodeFor(result([], { configured: 17, enabled: 0 }))).toBe(1);
  });

  it("succeeds when a FILTER matched nothing, though sources are enabled", () => {
    // runIngest(db, sourceIds) with ids matching no enabled source. The caller
    // asked for a subset and got it. This is why the counts are UNFILTERED.
    expect(exitCodeFor(result([], { configured: 17, enabled: 17 }))).toBe(0);
  });

  it("re-enabling one source returns the run to green", () => {
    // The control as a test rather than a manual step: the same empty pass
    // that fails with 0 enabled passes with 1, so the red is caused by the
    // COUNT and not by the emptiness.
    expect(exitCodeFor(result([], { configured: 17, enabled: 0 }))).toBe(1);
    expect(exitCodeFor(result([], { configured: 17, enabled: 1 }))).toBe(0);
  });
});

describe("describeEmptyPass", () => {
  const result = (
    bySource: SourceRunResult[],
    catalogue: { configured?: number; enabled?: number } = {},
  ): IngestResult => ({
    bySource,
    itemsInserted: 0,
    storiesCreated: 0,
    sourcesConfigured: catalogue.configured ?? Math.max(bySource.length, 1),
    sourcesEnabled: catalogue.enabled ?? Math.max(bySource.length, 1),
  });

  it("says nothing at all when the pass actually ran sources", () => {
    expect(
      describeEmptyPass(result([{ sourceKey: "a", fetched: 1, inserted: 1, error: null }])),
    ).toBeNull();
  });

  it("names seeding when the catalogue is empty", () => {
    const why = describeEmptyPass(result([], { configured: 0, enabled: 0 }))!;
    expect(why).toContain("no sources are seeded");
    expect(why).toContain("db:seed");
  });

  it("names the switch-off, with the count, when everything is disabled", () => {
    const why = describeEmptyPass(result([], { configured: 17, enabled: 0 }))!;
    expect(why).toContain("0 of 17");
    expect(why).toContain("switched off");
    // The consequence, not only the state — that is what a reader notices.
    expect(why).toContain("stop growing");
  });

  it("distinguishes a filter that matched nothing from both of those", () => {
    const why = describeEmptyPass(result([], { configured: 17, enabled: 17 }))!;
    expect(why).toContain("no source matched this pass");
    expect(why).not.toContain("switched off");
    expect(why).not.toContain("seeded");
  });
});
