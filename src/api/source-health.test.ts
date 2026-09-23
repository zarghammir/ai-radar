import { describe, expect, it } from "vitest";
import {
  UNHEALTHY_AFTER_CONSECUTIVE_FAILURES,
  classifySourceHealth,
  summariseSourceHealth,
  type SourceHealth,
} from "./source-health";

describe("classifySourceHealth", () => {
  it("calls a source that has never completed a run UNKNOWN, not healthy", () => {
    // The whole ticket is that a dead source and a quiet one look the same.
    // Reporting a source nobody has ever fetched as OK is that same defect
    // moved into the reporting layer.
    expect(classifySourceHealth({ completedRuns: 0, consecutiveFailures: 0 })).toBe("UNKNOWN");
  });

  // REMOVED: a test named "does not let an in-flight run make an unknown source
  // look healthy", which passed the same input as the test above and asserted
  // something weaker. This function has no notion of an in-flight run — that
  // distinction is made entirely in SQL, by counting only runs that finished
  // either way — so the name described a path the body could not reach, and
  // the real case went untested behind it.
  //
  // It is covered where it can actually be exercised: "keeps a source whose
  // only run is still in flight UNKNOWN", in api.test.ts, against a database.

  it("is OK below the threshold and FAILING at it", () => {
    const N = UNHEALTHY_AFTER_CONSECUTIVE_FAILURES;
    expect(classifySourceHealth({ completedRuns: 10, consecutiveFailures: N - 1 })).toBe("OK");
    expect(classifySourceHealth({ completedRuns: 10, consecutiveFailures: N })).toBe("FAILING");
    expect(classifySourceHealth({ completedRuns: 10, consecutiveFailures: N + 1 })).toBe("FAILING");
  });

  it("is OK when the source is working", () => {
    expect(classifySourceHealth({ completedRuns: 100, consecutiveFailures: 0 })).toBe("OK");
  });

  it("keeps the threshold above one, so a single blip cannot flag a feed", () => {
    // Not a style preference. The exit code is deliberately left green so the
    // schedule is not a notification people mute; a threshold of one would
    // reintroduce exactly that noise one layer up, with eighteen feeds polled
    // on the hosted schedule.
    //
    // NOT "every half hour". ingest.yml DECLARES that and GitHub does not keep
    // it: measured 09-18 to 09-21, 8/8/7/5 passes a day — a mean of 7 against
    // 48 declared. The threshold counts PASSES rather than minutes, which is
    // what makes it survive the difference. Noted here because a constant's
    // TEST is where the next reader goes to learn what it means, and
    // source-health.ts carries this warning while its own test did not.
    expect(UNHEALTHY_AFTER_CONSECUTIVE_FAILURES).toBeGreaterThan(1);
  });
});

describe("summariseSourceHealth", () => {
  it("cannot report zero failures when it examined nothing", () => {
    // The floor. `{ failing: 0 }` over an empty catalogue is arithmetically
    // true and reads as a clean bill of health, which is the shape that has
    // bitten this repo repeatedly. The empty case is a different variant, so a
    // caller has to pass through it before it can reach a count at all.
    const summary = summariseSourceHealth([]);
    expect(summary.kind).toBe("nothing-examined");
    expect(summary).not.toHaveProperty("failing");
  });

  it("counts each state separately over a real catalogue", () => {
    const states: SourceHealth[] = ["OK", "OK", "FAILING", "UNKNOWN"];
    const summary = summariseSourceHealth(states);
    expect(summary).toEqual({ kind: "examined", examined: 4, ok: 2, failing: 1, unknown: 1 });
    // A floor on this test rather than on the code: if the fixture is ever
    // trimmed to nothing, the assertion above would still pass against the
    // empty variant and prove nothing.
    expect(states.length).toBeGreaterThanOrEqual(3);
  });

  it("does not fold UNKNOWN into either healthy or failing", () => {
    const summary = summariseSourceHealth(["UNKNOWN", "UNKNOWN"]);
    expect(summary).toEqual({ kind: "examined", examined: 2, ok: 0, failing: 0, unknown: 2 });
  });
});
