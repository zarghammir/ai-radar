import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { briefSends, pushSubscriptions, stories, userPreferences } from "@/db/schema";
import { runBriefDelivery } from "./run-brief";

/**
 * A database stand-in, so the ledger is tested by a test that always runs.
 *
 * #72 asks for a broken delivery to be VISIBLE rather than a brief that
 * silently never arrives. That property is worth more than most of this file,
 * and a test that skips itself without DATABASE_URL would report it as
 * satisfied by not running — which is the same failure shape one level up.
 */
interface FakeState {
  prefs: Record<string, unknown> | null;
  lastDay: string | null;
  subscriptions: { id: number; endpoint: string }[];
  storyCount: number;
  inserted: Record<string, unknown>[];
  deleted: number;
  updated: number;
  selectThrows: boolean;
}

function fakeDb(overrides: Partial<FakeState> = {}): { db: Db; state: FakeState } {
  const state: FakeState = {
    prefs: { briefTime: "07:30", timezone: "UTC", notificationChannel: "push" },
    lastDay: null,
    subscriptions: [{ id: 1, endpoint: "https://push.example/abc" }],
    storyCount: 3,
    inserted: [],
    deleted: 0,
    updated: 0,
    selectThrows: false,
    ...overrides,
  };

  const builder = () => {
    let table: unknown = null;
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["where", "orderBy", "limit", "innerJoin", "for"]) chain[m] = () => self();
    chain.from = (t: unknown) => {
      table = t;
      return self();
    };
    chain.then = (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) => {
      if (state.selectThrows) return reject?.(new Error("database is unavailable"));
      if (table === userPreferences) return resolve(state.prefs ? [state.prefs] : []);
      if (table === briefSends) return resolve(state.lastDay ? [{ day: state.lastDay }] : []);
      if (table === pushSubscriptions) return resolve(state.subscriptions);
      if (table === stories) return resolve([{ count: String(state.storyCount) }]);
      return resolve([]);
    };
    return chain;
  };

  const db = {
    select: () => builder(),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        state.inserted.push(v);
      },
    }),
    update: () => ({ set: () => ({ where: async () => void state.updated++ }) }),
    delete: () => ({ where: async () => void state.deleted++ }),
  } as unknown as Db;

  return { db, state };
}

const ENV = {
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 1)]).toString(
    "base64url",
  ),
  VAPID_PRIVATE_KEY: Buffer.alloc(32, 2).toString("base64url"),
  VAPID_SUBJECT: "mailto:o@example.com",
};
const DUE = new Date("2026-09-22T09:00:00Z");
const EARLY = new Date("2026-09-22T06:00:00Z");
const silent = () => {};
const reply = (status: number) =>
  vi.fn(async () => new Response("", { status })) as unknown as typeof globalThis.fetch;

describe("runBriefDelivery — when it does not send", () => {
  it("writes no row before the brief time, because that is not a delivery", async () => {
    const { db, state } = fakeDb();
    const result = await runBriefDelivery(db, {
      env: ENV,
      now: EARLY,
      fetchImpl: reply(201),
      log: silent,
    });
    expect(result.outcome).toBe("not-due");
    // Seven rows a day of "not yet" would bury the rows that matter.
    expect(state.inserted).toHaveLength(0);
  });

  it("names the missing variable when the instance has no keys", async () => {
    const { db } = fakeDb();
    const result = await runBriefDelivery(db, { env: {}, now: DUE, log: silent });
    expect(result.outcome).toBe("not-due");
    expect(result.detail).toContain("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  });

  it("does not send when the reader asked for something other than push", async () => {
    const { db, state } = fakeDb({
      prefs: { briefTime: "07:30", timezone: "UTC", notificationChannel: "email" },
    });
    const result = await runBriefDelivery(db, { env: ENV, now: DUE, log: silent });
    expect(result.outcome).toBe("not-due");
    expect(state.inserted).toHaveLength(0);
  });

  it("sends only once a day", async () => {
    const { db, state } = fakeDb({ lastDay: "2026-09-22" });
    await runBriefDelivery(db, { env: ENV, now: DUE, fetchImpl: reply(201), log: silent });
    expect(state.inserted).toHaveLength(0);
  });
});

describe("runBriefDelivery — the silence that must not be silent", () => {
  /**
   * THE ROW IS THE POINT. "Nobody has ever subscribed" and "the sender is
   * broken" are one observable from outside — no notification — and that is
   * exactly the shape that hid the collector outage for three days.
   */
  it("records a row when it is due and nobody is subscribed", async () => {
    const { db, state } = fakeDb({ subscriptions: [] });
    await runBriefDelivery(db, { env: ENV, now: DUE, log: silent });

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].outcome).toBe("skipped");
    expect(String(state.inserted[0].detail)).toContain("subscribed");
  });

  it("records a failure with the reason when the push service refuses", async () => {
    const { db, state } = fakeDb();
    const result = await runBriefDelivery(db, {
      env: ENV,
      now: DUE,
      fetchImpl: reply(500),
      log: silent,
    });

    expect(result.outcome).toBe("failed");
    expect(state.inserted[0].outcome).toBe("failed");
    expect(String(state.inserted[0].detail)).toContain("500");
    expect(state.inserted[0].failed).toBe(1);
  });

  it("records the send, with what there was to say", async () => {
    const { db, state } = fakeDb({ storyCount: 6 });
    const result = await runBriefDelivery(db, {
      env: ENV,
      now: DUE,
      fetchImpl: reply(201),
      log: silent,
    });

    expect(result.outcome).toBe("sent");
    expect(state.inserted[0].delivered).toBe(1);
    expect(state.inserted[0].storyCount).toBe(6);
    expect(state.inserted[0].localDay).toBe("2026-09-22");
  });

  // A quiet day is still a delivery. If it sent nothing, a quiet week and a
  // broken sender would be the same experience for the reader.
  it("still sends on a morning with nothing new", async () => {
    const { db, state } = fakeDb({ storyCount: 0 });
    const result = await runBriefDelivery(db, {
      env: ENV,
      now: DUE,
      fetchImpl: reply(201),
      log: silent,
    });
    expect(result.outcome).toBe("sent");
    expect(state.inserted[0].storyCount).toBe(0);
  });
});

describe("runBriefDelivery — housekeeping and safety", () => {
  it("drops a subscription the push service has retired", async () => {
    const { db, state } = fakeDb();
    await runBriefDelivery(db, { env: ENV, now: DUE, fetchImpl: reply(410), log: silent });
    expect(state.deleted).toBe(1);
  });

  it("keeps a subscription that merely failed", async () => {
    const { db, state } = fakeDb();
    await runBriefDelivery(db, { env: ENV, now: DUE, fetchImpl: reply(503), log: silent });
    expect(state.deleted).toBe(0);
    expect(state.updated).toBe(1);
  });

  // #137 files a GitHub issue on a red run. A push service having a bad
  // morning is not a collector outage.
  it("resolves rather than throwing when the database is unavailable", async () => {
    const { db } = fakeDb({ selectThrows: true });
    const result = await runBriefDelivery(db, { env: ENV, now: DUE, log: silent });
    expect(result.detail).toContain("stopped after an error");
  });
});
