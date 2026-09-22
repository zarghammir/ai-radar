import { desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { briefSends, pushSubscriptions, userPreferences } from "@/db/schema";
import { briefWindow } from "@/api/brief";
import { stories } from "@/db/schema";
import { decideSend, localDay } from "./window";
import { sendPush, type FetchLike } from "./push";
import { readVapidSettings, type VapidEnv } from "./vapid";

/**
 * Deciding, every pass, whether the brief goes out — and writing down the
 * decision either way.
 *
 * THE LEDGER IS THE FEATURE, as much as the sending is. "Not yet", "nobody is
 * subscribed", "the push service refused us" and "it went" are one observable
 * from outside: no notification arrived. #72 asks for a failed delivery to be
 * VISIBLE, and the collector outage is the standing example of what the
 * alternative costs — three days of nothing, indistinguishable from a quiet
 * week.
 *
 * DOES NOT THROW, by shape rather than by promise, and the worker guards the
 * call site anyway. #137 opens a GitHub issue on a red run, so a push service
 * having a bad morning must not file an outage for a collector that worked.
 */

export interface BriefRunResult {
  outcome: "sent" | "skipped" | "failed" | "not-due";
  detail: string | null;
  localDay: string;
  storyCount: number;
  attempted: number;
  delivered: number;
  failed: number;
}

const NOT_DUE = (day: string, detail: string): BriefRunResult => ({
  outcome: "not-due",
  detail,
  localDay: day,
  storyCount: 0,
  attempted: 0,
  delivered: 0,
  failed: 0,
});

export interface RunBriefOptions {
  env?: VapidEnv;
  now?: Date;
  fetchImpl?: FetchLike;
  log?: (line: string) => void;
}

/** The most recent day a delivery was DECIDED for, sent or not. */
async function lastDecidedDay(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ day: briefSends.localDay })
    .from(briefSends)
    .orderBy(desc(briefSends.decidedAt))
    .limit(1);
  return row?.day ?? null;
}

export async function runBriefDelivery(
  db: Db,
  options: RunBriefOptions = {},
): Promise<BriefRunResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const log = options.log ?? ((line: string) => console.log(line));

  try {
    const [prefs] = await db.select().from(userPreferences).limit(1);
    if (!prefs) return NOT_DUE("", "no preferences row exists yet");

    // Checked BEFORE the window, so an operator who has not generated keys is
    // told that rather than being told it is not seven o'clock.
    const vapid = readVapidSettings(env);
    if (!vapid.enabled) return NOT_DUE(localDay(now, "UTC"), vapid.reason);

    if (prefs.notificationChannel !== "push") {
      return NOT_DUE(
        localDay(now, "UTC"),
        `the reader's channel is "${prefs.notificationChannel}", not push`,
      );
    }

    const decision = decideSend({
      now,
      briefTime: prefs.briefTime,
      timezone: prefs.timezone,
      lastSentDay: await lastDecidedDay(db),
    });
    if (!decision.send) return NOT_DUE(decision.localDay, decision.reason);

    const day = decision.localDay;
    const subscriptions = await db
      .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint })
      .from(pushSubscriptions);

    // A row, not a silence. Without it "nobody has ever subscribed" looks
    // exactly like "the sender is broken" from the outside.
    if (subscriptions.length === 0) {
      await record(db, day, "skipped", "nobody is subscribed to push on this instance", 0, 0, 0, 0);
      return { ...NOT_DUE(day, "nobody is subscribed"), outcome: "skipped" };
    }

    // A COUNT, not the brief itself. The service worker fetches the brief when
    // the notification arrives, so building it here would be work thrown away
    // — and the count is what the ledger needs to answer "was there anything
    // to say that morning" six weeks later.
    const window = briefWindow(now, prefs.briefTime, prefs.timezone);
    const [counted] = await db
      .select({ count: sql<string>`count(*)` })
      .from(stories)
      .where(gte(stories.lastActivityAt, window.from));
    const storyCount = Number(counted?.count ?? 0);

    // A QUIET MORNING IS STILL SENT, and this is a product decision rather
    // than an oversight. #72 requires the reader to be able to tell "nothing
    // happened" from "it stopped working"; if a quiet day sends nothing, those
    // two are the same experience for as long as the outage lasts. One
    // notification a day at a time the reader chose is what they asked for,
    // and "nothing new today" is a true brief.

    let delivered = 0;
    let failed = 0;
    const reasons: string[] = [];

    for (const subscription of subscriptions) {
      const outcome = await sendPush(vapid.keys, subscription.endpoint, now, options.fetchImpl);

      if (outcome.kind === "delivered") {
        delivered++;
        await db
          .update(pushSubscriptions)
          .set({ lastSuccessAt: now, lastError: null, failureCount: 0 })
          .where(eq(pushSubscriptions.id, subscription.id));
        continue;
      }

      if (outcome.kind === "gone") {
        // The push service says this browser is finished with us. Keeping it
        // would fail forever and make every future run look degraded.
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
        log(`[brief] dropped a retired subscription (${outcome.detail}).`);
        continue;
      }

      failed++;
      reasons.push(outcome.detail);
      await db
        .update(pushSubscriptions)
        .set({
          lastError: outcome.detail,
          failureCount: sql`${pushSubscriptions.failureCount} + 1`,
        })
        .where(eq(pushSubscriptions.id, subscription.id));
    }

    const attempted = subscriptions.length;
    const outcome = delivered > 0 ? "sent" : failed > 0 ? "failed" : "skipped";
    const detail =
      outcome === "sent"
        ? null
        : failed > 0
          ? reasons[0]
          : "every subscription had been retired by its push service";

    await record(db, day, outcome, detail, storyCount, attempted, delivered, failed);
    log(`[brief] ${outcome}: ${delivered} delivered, ${failed} failed, ${storyCount} stories.`);

    return { outcome, detail, localDay: day, storyCount, attempted, delivered, failed };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    log(`[brief] stopped after an error: ${why}`);
    return NOT_DUE("", `stopped after an error: ${why}`);
  }
}

async function record(
  db: Db,
  day: string,
  outcome: string,
  detail: string | null,
  storyCount: number,
  attempted: number,
  delivered: number,
  failed: number,
): Promise<void> {
  await db.insert(briefSends).values({
    localDay: day,
    channel: "push",
    outcome,
    detail,
    storyCount,
    attempted,
    delivered,
    failed,
  });
}
