import "dotenv/config";
import { afterAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { spawn } from "node:child_process";
import { INGEST_LOCK_KEY, withIngestLock } from "./lock";

/**
 * These run against a real Postgres. They take and release advisory locks and
 * touch no table, so they are safe against the configured database.
 */
const configured = process.env.DATABASE_URL;

// A skip CI can reach is a suite that agrees with itself while running nothing.
if (!configured && process.env.CI) {
  throw new Error("CI must set DATABASE_URL; refusing to skip the worker lock tests silently");
}
if (!configured) {
  console.warn(
    "\n!! DATABASE_URL is not set: the worker lock tests did NOT run.\n" +
      "!! Copy .env.example to .env and point DATABASE_URL at a local Postgres.\n",
  );
}

const withDb = configured ? describe : describe.skip;

/** One client stands for one worker process. */
const clients: postgres.Sql[] = [];
function worker(): postgres.Sql {
  const sql = postgres(configured!, { max: 5, prepare: false, onnotice: () => {} });
  clients.push(sql);
  return sql;
}

/**
 * How many sessions hold OUR lock right now, read from Postgres itself rather
 * than from the module under test — a count the module reports about itself
 * would pass whether or not a lock was ever taken.
 */
async function heldCount(sql: postgres.Sql): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from pg_locks
    where locktype = 'advisory' and classid = 0 and objid = ${INGEST_LOCK_KEY} and granted
  `;
  return rows[0].n;
}

async function openTransactions(sql: postgres.Sql): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from pg_stat_activity
    where datname = current_database() and state = 'idle in transaction'
  `;
  return rows[0].n;
}

async function waitUntil(check: () => Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end({ timeout: 5 })));
});

/**
 * A reserved connection whose unlock fails. Needs no database: what is under
 * test is which error survives, and forcing a real `pg_advisory_unlock` to
 * fail against live Postgres is not something a test can arrange reliably.
 */
function sqlWhoseUnlockFails(): postgres.Sql {
  const reserved = ((strings: TemplateStringsArray) => {
    const text = strings.join("");
    if (text.includes("pg_try_advisory_lock")) return Promise.resolve([{ locked: true }]);
    if (text.includes("pg_advisory_unlock")) {
      return Promise.reject(new Error("connection reset while unlocking"));
    }
    return Promise.resolve([]);
  }) as unknown as postgres.ReservedSql;
  (reserved as unknown as { release: () => void }).release = () => {};
  return { reserve: async () => reserved } as unknown as postgres.Sql;
}

describe("withIngestLock when releasing the lock fails", () => {
  it("propagates the failure from the work, not the one from the unlock", async () => {
    // The unlock runs in a finally. A throw there replaces whatever brought us
    // out of the run — losing the real cause exactly when someone is reading
    // the log to find it.
    const errors: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...a) => void errors.push(a.join(" ")));
    try {
      await expect(
        withIngestLock(sqlWhoseUnlockFails(), async () => {
          throw new Error("the ingest itself failed");
        }),
      ).rejects.toThrow("the ingest itself failed");

      // And the unlock failure is still reported rather than swallowed: a lock
      // that would not release is worth an operator's attention.
      expect(errors.join("\n")).toContain("connection reset while unlocking");
    } finally {
      spy.mockRestore();
    }
  });

  it("still reports a completed run whose unlock failed, rather than calling it a failure", async () => {
    // The work happened. Reporting it as failed because cleanup went wrong
    // would be a false negative, and the connection closing releases the lock.
    const errors: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...a) => void errors.push(a.join(" ")));
    try {
      const outcome = await withIngestLock(sqlWhoseUnlockFails(), async () => "finished");
      expect(outcome).toEqual({ ran: true, result: "finished" });
      expect(errors.join("\n")).toContain("connection reset while unlocking");
    } finally {
      spy.mockRestore();
    }
  });
});

withDb("withIngestLock", () => {
  it("runs the work and reports that it ran", async () => {
    const outcome = await withIngestLock(worker(), async () => "done");
    // Asserted structurally: with LockOutcome a union, "ran with a result" is
    // one shape rather than two fields that could disagree.
    expect(outcome).toEqual({ ran: true, result: "done" });
  });

  it("declines a second worker while the first is still running, without running its work", async () => {
    const first = worker();
    const second = worker();
    const probe = worker();

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const firstRun = withIngestLock(first, async () => {
      await held;
      return "first";
    });

    await waitUntil(
      async () => (await heldCount(probe)) === 1,
      "the first worker to take the lock",
    );

    let secondWorked = false;
    const secondRun = await withIngestLock(second, async () => {
      secondWorked = true;
      return "second";
    });

    // The decline is the point: not merely a different return value, but work
    // that never happened.
    // A declined outcome carries no result at all now — not an undefined one.
    expect(secondRun).toEqual({ ran: false });
    expect(secondWorked).toBe(false);

    release();
    expect((await firstRun).ran).toBe(true);
  });

  it("releases the lock when the run finishes, so the next tick can take it", async () => {
    const a = worker();
    const probe = worker();
    await withIngestLock(a, async () => "one");
    expect(await heldCount(probe)).toBe(0);

    const again = await withIngestLock(a, async () => "two");
    expect(again.ran).toBe(true);
  });

  it("releases the lock when the work throws, and the failure reaches the caller", async () => {
    const a = worker();
    const probe = worker();
    await expect(
      withIngestLock(a, async () => {
        throw new Error("ingest blew up");
      }),
    ).rejects.toThrow("ingest blew up");

    // A lock leaked by a crashing run wedges every later tick until restart.
    expect(await heldCount(probe)).toBe(0);
    const after = await withIngestLock(a, async () => "recovered");
    expect(after.ran).toBe(true);
  });

  it("holds and releases on one connection even when the pool frees others mid-run", async () => {
    // An advisory lock belongs to the session that took it. postgres.js keeps
    // pipelining onto one connection until something pins the others, so the
    // only arrangement that exposes an unlock sent to the wrong connection is
    // this one: occupy the pool with open transactions while the lock is
    // taken, then free them before the run ends. Without the reservation the
    // unlock returns false here and the lock is still held afterwards.
    const a = worker();
    const probe = worker();

    let releaseTx!: () => void;
    const gate = new Promise<void>((r) => (releaseTx = r));
    const txs = Array.from({ length: 4 }, () =>
      a.begin(async (tx) => {
        await tx`select 1`;
        await gate;
      }),
    );
    await waitUntil(
      async () => (await openTransactions(probe)) >= 4,
      "four connections to be pinned",
    );

    const outcome = await withIngestLock(a, async () => {
      expect(await heldCount(probe)).toBe(1);
      releaseTx();
      await Promise.all(txs);
      await waitUntil(
        async () => (await openTransactions(probe)) === 0,
        "the pinned connections to go idle",
      );
      // One ordinary query on the pool before the run ends: this is what makes
      // the pool hand the unlock a different connection than the lock.
      await a`select 1`;
      return "busy";
    });

    expect(outcome.ran).toBe(true);
    expect(await heldCount(probe)).toBe(0);
  });

  it("does not leak the lock when the worker is killed before the finally runs", async () => {
    // pg_try_advisory_lock is session-level, so the claim to prove is that the
    // session dying is itself the release — SIGKILL never reaches the finally.
    // The child takes the lock with the raw call rather than withIngestLock:
    // the property belongs to the Postgres session, not to the wrapper, and a
    // child that had to compile TypeScript would be testing the toolchain.
    const probe = worker();
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const postgres = require("postgres");
         const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
         sql\`select pg_advisory_lock(${INGEST_LOCK_KEY})\`.then(() => {
           console.log("LOCKED");
           setInterval(() => {}, 1000);
         });`,
      ],
      { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: configured! } },
    );

    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (b: Buffer) => b.toString().includes("LOCKED") && resolve());
        child.stderr.on("data", (b: Buffer) => reject(new Error(b.toString())));
        child.on("exit", (code) => reject(new Error(`child exited early with ${code}`)));
        setTimeout(() => reject(new Error("child never reported the lock")), 15_000);
      });

      // Positive first: without it, a child that silently failed to connect
      // would make the release assertion below pass for the wrong reason.
      expect(await heldCount(probe)).toBe(1);

      child.kill("SIGKILL");
      await waitUntil(
        async () => (await heldCount(probe)) === 0,
        "the killed session to be reaped",
      );

      // And the next run can take it, which is what an operator actually needs.
      const after = await withIngestLock(worker(), async () => "recovered");
      expect(after.ran).toBe(true);
    } finally {
      child.kill("SIGKILL");
    }
  }, 30_000);
});
