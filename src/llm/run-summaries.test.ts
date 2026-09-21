import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { llmUsage, rawItems, stories } from "@/db/schema";
import type { LlmClient } from "./client";
import { runSummaries } from "./run-summaries";

/**
 * A database stand-in, so the guard that protects the owner's money is tested
 * by a test that always runs.
 *
 * This suite deliberately needs no DATABASE_URL. The cap is the one thing here
 * that costs real money when it is wrong, and a test that skips itself on a
 * machine without a database is exactly the shape of instrument this project
 * keeps deleting: it reports success by not running.
 */
interface FakeState {
  usedToday: number;
  storyRows: { id: number; title: string }[];
  itemRows: { title: string; excerpt: string | null; sourceName: string }[];
  updates: { id: number; set: Record<string, unknown> }[];
  usageWrites: number;
  /** Simulates the database being the broken thing during bookkeeping. */
  transactionThrows: boolean;
  /** Simulates the database being unreachable before any spending starts. */
  selectThrows: boolean;
}

function fakeDb(overrides: Partial<FakeState> = {}): { db: Db; state: FakeState } {
  const state: FakeState = {
    usedToday: 0,
    storyRows: [],
    itemRows: [{ title: "report", excerpt: "text", sourceName: "Source" }],
    updates: [],
    usageWrites: 0,
    transactionThrows: false,
    selectThrows: false,
    ...overrides,
  };

  const builder = () => {
    let table: unknown = null;
    let take: number | null = null;
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const method of ["where", "orderBy", "innerJoin", "for"]) {
      chain[method] = () => self();
    }
    chain.limit = (n: number) => {
      take = n;
      return self();
    };
    chain.from = (t: unknown) => {
      table = t;
      return self();
    };
    chain.then = (resolve: (value: unknown[]) => unknown, reject?: (e: unknown) => unknown) => {
      if (state.selectThrows) return reject?.(new Error("database is unavailable"));
      // One row shape serves both readers of this table: the ledger sum reads
      // `total`, the upsert reads `id`.
      if (table === llmUsage) return resolve([{ id: 1, total: String(state.usedToday) }]);
      // `limit` is honoured, because the slice it applies IS the cap for the
      // pass. A fake that ignored it would let this suite pass for a version
      // that selected every story and spent the whole catalogue.
      if (table === stories) {
        return resolve(take === null ? state.storyRows : state.storyRows.slice(0, take));
      }
      if (table === rawItems) return resolve(state.itemRows);
      return resolve([]);
    };
    return chain;
  };

  const recorder = () => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        // Only the story write is interesting to these tests; the ledger's own
        // update carries SQL fragments rather than values.
        if ("summary" in values || "summarizedAt" in values) {
          state.updates.push({ id: state.updates.length, set: values });
        }
      },
    }),
  });

  const db = {
    select: () => builder(),
    update: () => recorder(),
    insert: () => ({ values: async () => {} }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      if (state.transactionThrows) throw new Error("database is unavailable");
      state.usageWrites++;
      // The ledger actually moves, so the re-read inside the loop is a live
      // quantity. Held constant, that guard would be untestable from here.
      state.usedToday++;
      await fn({
        select: () => builder(),
        insert: () => ({ values: async () => {} }),
        update: () => recorder(),
      });
    },
  } as unknown as Db;

  return { db, state };
}

function fakeClient(reply = '{"summary":"s","whyItMatters":"w","keyPoints":["k"]}'): LlmClient & {
  complete: ReturnType<typeof vi.fn>;
} {
  const complete = vi.fn(async () => ({ text: reply, inputTokens: 100, outputTokens: 50 }));
  return { provider: "anthropic", model: "test-model", complete } as LlmClient & {
    complete: ReturnType<typeof vi.fn>;
  };
}

const ENV = { LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" };
const NOW = new Date("2026-09-21T12:00:00Z");
const silent = () => {};

describe("runSummaries — the cap", () => {
  // docs/cost-protection.md rule 3: the cap refuses the call. It does not log
  // a warning and proceed. This asserts the PROVIDER WAS NEVER CALLED, not
  // that a message was printed — a test on the message passes for the version
  // that spends the money anyway.
  it("makes no call at all once the day's allowance is spent", async () => {
    const { db } = fakeDb({ usedToday: 20, storyRows: [{ id: 1, title: "t" }] });
    const client = fakeClient();

    const result = await runSummaries(db, {
      env: { ...ENV, LLM_MAX_STORIES_PER_DAY: "20" },
      now: NOW,
      client,
      log: silent,
    });

    expect(client.complete).not.toHaveBeenCalled();
    expect(result.attempted).toBe(0);
    expect(result.skipped).toContain("cap");
  });

  it("spends only what is left, not the whole cap", async () => {
    const { db } = fakeDb({
      usedToday: 19,
      storyRows: [
        { id: 1, title: "a" },
        { id: 2, title: "b" },
        { id: 3, title: "c" },
      ],
    });
    const client = fakeClient();

    const result = await runSummaries(db, {
      env: { ...ENV, LLM_MAX_STORIES_PER_DAY: "20" },
      now: NOW,
      client,
      log: silent,
    });

    expect(client.complete).toHaveBeenCalledTimes(1);
    expect(result.budgetAtStart).toBe(1);
  });

  it("makes no call when the cap is zero", async () => {
    const { db } = fakeDb({ storyRows: [{ id: 1, title: "t" }] });
    const client = fakeClient();

    await runSummaries(db, {
      env: { ...ENV, LLM_MAX_STORIES_PER_DAY: "0" },
      now: NOW,
      client,
      log: silent,
    });

    expect(client.complete).not.toHaveBeenCalled();
  });

  // A misspelled cap fails closed, and the proof is the absence of a call
  // rather than the parsed number.
  it("makes no call when the cap is unreadable", async () => {
    const { db } = fakeDb({ storyRows: [{ id: 1, title: "t" }] });
    const client = fakeClient();

    await runSummaries(db, {
      env: { ...ENV, LLM_MAX_STORIES_PER_DAY: "twenty" },
      now: NOW,
      client,
      log: silent,
    });

    expect(client.complete).not.toHaveBeenCalled();
  });
});

describe("runSummaries — degrading without a provider", () => {
  it("makes no call and names the reason when no provider is configured", async () => {
    const { db } = fakeDb({ storyRows: [{ id: 1, title: "t" }] });
    const client = fakeClient();

    const result = await runSummaries(db, {
      env: { LLM_PROVIDER: "none" },
      now: NOW,
      client,
      log: silent,
    });

    expect(client.complete).not.toHaveBeenCalled();
    expect(result.skipped).toContain("LLM_PROVIDER");
  });

  it("makes no call when the key is missing", async () => {
    const { db } = fakeDb({ storyRows: [{ id: 1, title: "t" }] });
    const client = fakeClient();

    const result = await runSummaries(db, {
      env: { LLM_PROVIDER: "anthropic" },
      now: NOW,
      client,
      log: silent,
    });

    expect(client.complete).not.toHaveBeenCalled();
    expect(result.skipped).toContain("ANTHROPIC_API_KEY");
  });
});

describe("runSummaries — a failure is not an absence", () => {
  it("writes the summary on success", async () => {
    const { db, state } = fakeDb({ storyRows: [{ id: 1, title: "t" }] });

    const result = await runSummaries(db, {
      env: ENV,
      now: NOW,
      client: fakeClient(),
      log: silent,
    });

    expect(result.succeeded).toBe(1);
    expect(state.updates[0].set.summary).toBe("s");
    expect(state.updates[0].set.summarizedAt).toBe(NOW);
  });

  // The middle state: attempted and failed. summarizedAt is stamped while
  // summary stays null, so the row is distinguishable from one nobody has
  // reached yet — and the retry rule has something to read.
  it("stamps the attempt but leaves the summary null when the reply is rubbish", async () => {
    const { db, state } = fakeDb({ storyRows: [{ id: 1, title: "t" }] });

    const result = await runSummaries(db, {
      env: ENV,
      now: NOW,
      client: fakeClient("I cannot help with that."),
      log: silent,
    });

    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(state.updates[0].set.summary).toBeNull();
    expect(state.updates[0].set.summarizedAt).toBe(NOW);
  });

  it("does not throw when the provider is down, so the pass stays green", async () => {
    const { db } = fakeDb({ storyRows: [{ id: 1, title: "t" }] });
    const client = {
      provider: "anthropic",
      model: "m",
      complete: vi.fn(async () => {
        throw new Error("HTTP 529: overloaded");
      }),
    } as unknown as LlmClient;

    const result = await runSummaries(db, { env: ENV, now: NOW, client, log: silent });
    expect(result.failed).toBe(1);
  });

  // The expensive failure is still a charge. A ledger that only counted
  // successes would under-report the bill in the exact case somebody is
  // watching it.
  it("charges an unusable reply to the ledger", async () => {
    const { db, state } = fakeDb({ storyRows: [{ id: 1, title: "t" }] });

    await runSummaries(db, {
      env: ENV,
      now: NOW,
      client: fakeClient("nonsense"),
      log: silent,
    });

    expect(state.usageWrites).toBe(1);
  });
});

describe("runSummaries — the database being the broken thing", () => {
  // The module used to promise "NEVER THROWS" in a comment while making
  // unguarded database calls, and the worker called it with no try/catch. The
  // cost of that went up when #137 started opening a GitHub issue on a failed
  // run: a transient hiccup in an OPTIONAL enhancement would file an outage,
  // and an alarm that cries wolf trains its reader to ignore it.
  it("resolves rather than throwing when the ledger cannot be read", async () => {
    const { db } = fakeDb({ selectThrows: true, storyRows: [{ id: 1, title: "t" }] });

    const result = await runSummaries(db, {
      env: ENV,
      now: NOW,
      client: fakeClient(),
      log: silent,
    });

    expect(result.skipped).toContain("stopped after an error");
  });

  it("resolves rather than throwing when the bookkeeping transaction fails", async () => {
    const { db } = fakeDb({ transactionThrows: true, storyRows: [{ id: 1, title: "t" }] });

    const result = await runSummaries(db, {
      env: ENV,
      now: NOW,
      client: fakeClient(),
      log: silent,
    });

    expect(result.skipped).toContain("stopped after an error");
  });

  /**
   * THE DATA-LOSS PATH THAT USED TO EXIST.
   *
   * The summary was written first and the charge second. When the charge threw,
   * control fell into the failure branch, which called the story write AGAIN
   * with null — erasing a summary that had already been paid for and leaving
   * the row eligible to be paid for a second time.
   *
   * Both writes now commit in one transaction, so a bookkeeping failure leaves
   * NOTHING written. The assertion is on the absence of a null-summary write,
   * which is the thing that destroyed the paid work.
   */
  it("never overwrites a paid summary with null when the bookkeeping fails", async () => {
    const { db, state } = fakeDb({ transactionThrows: true, storyRows: [{ id: 1, title: "t" }] });

    const result = await runSummaries(db, {
      env: ENV,
      now: NOW,
      client: fakeClient(),
      log: silent,
    });

    expect(state.updates.filter((u) => u.set.summary === null)).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
    // Attempted but neither counted: the discrepancy IS the signal that a call
    // was paid for and its result never committed.
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
  });
});
