import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { IngestResult, SourceRunResult } from "@/pipeline/run";
import {
  exitCodeFor,
  formatSourceLine,
  formatTotalLine,
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
  const result = (bySource: SourceRunResult[]): IngestResult => ({
    bySource,
    itemsInserted: 0,
    storiesCreated: 0,
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

  it("succeeds when there were no sources to run", () => {
    // An empty catalogue is a seeding question, not a failed run, and dividing
    // by zero here would report every empty database as broken.
    expect(exitCodeFor(result([]))).toBe(0);
  });
});
