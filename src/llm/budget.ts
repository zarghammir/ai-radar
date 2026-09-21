import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { llmUsage } from "@/db/schema";
import type { LlmEnv } from "./config";

/**
 * The cost cap, in code — issue #35.
 *
 * `LLM_MAX_STORIES_PER_DAY` and `llm_usage` have existed since the first
 * schema and NOTHING READ EITHER. That was safe only while the number of paid
 * calls was zero; this module is the first paid call, so it arrives with the
 * cap or it does not arrive. See docs/cost-protection.md rule 3.
 *
 * THE CAP REFUSES. It does not warn and proceed. A guard whose failure path
 * logs and continues is indistinguishable from no guard on the one day it
 * matters, and the bill is what tells you which one you had.
 */

/** Matches LLM_MAX_STORIES_PER_DAY in .env.example; budget.test.ts pins the two together. */
export const DEFAULT_MAX_STORIES_PER_DAY = 20;

/**
 * The day a usage row belongs to, in UTC.
 *
 * UTC rather than the operator's timezone on purpose: `user_preferences.timezone`
 * is a reader-facing setting that can be edited between two passes, and a cap
 * whose window moves when somebody changes a dropdown can be made to spend
 * twice in one day by doing so. The ledger's day is a fixed property of the
 * clock, not a preference.
 */
export function usageDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The cap for this deployment.
 *
 * A missing variable takes the documented default. A value that is not a
 * non-negative integer takes ZERO, not the default: an operator who wrote
 * `LLM_MAX_STORIES_PER_DAY=twenty` has said something about their intent to
 * limit spending, and reading that as the default twenty is the one
 * interpretation that spends money they did not authorise. Zero is the answer
 * that cannot be wrong in the expensive direction.
 */
export function readDailyCap(env: LlmEnv = process.env): number {
  const raw = (env.LLM_MAX_STORIES_PER_DAY ?? "").trim();
  if (raw === "") return DEFAULT_MAX_STORIES_PER_DAY;
  if (!/^\d+$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

/** What the ledger says has already been spent today, across every provider. */
export async function storiesSummarizedToday(db: Db, day: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${llmUsage.storiesSummarized}), 0)` })
    .from(llmUsage)
    .where(eq(llmUsage.day, day));
  return Number(row?.total ?? 0);
}

/**
 * How many more stories today's budget allows. Never negative.
 *
 * Summed across providers rather than per provider: the cap is the owner's
 * daily spend, and a per-provider reading would let switching provider
 * mid-day spend the whole allowance a second time.
 */
export async function remainingToday(db: Db, day: string, cap: number): Promise<number> {
  if (cap <= 0) return 0;
  const used = await storiesSummarizedToday(db, day);
  return Math.max(0, cap - used);
}

export interface UsageRecord {
  day: string;
  provider: string;
  model: string;
  stories: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Add one call's usage to today's ledger.
 *
 * Read-modify-write inside a transaction, because `llm_usage` has no unique
 * key on (day, provider, model) and adding one would mean a migration — which
 * this change deliberately does not carry. The worker is the only writer and
 * holds the single-writer advisory lock while it runs, so the transaction is
 * belt and braces rather than the thing that makes this correct.
 *
 * WRITTEN AFTER EVERY ATTEMPT THAT REACHED THE PROVIDER, including one that
 * came back as rubbish. The tokens were spent whether or not the answer was
 * usable, and a ledger that only records successes under-reports the bill in
 * exactly the situation where somebody is watching it.
 */
export async function recordUsage(db: Db, usage: UsageRecord): Promise<void> {
  await db.transaction(async (tx) => {
    await applyUsage(tx, usage);
  });
}

/** A transaction handle, taken from the db type so it cannot drift from it. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The ledger write, inside a transaction the caller already owns.
 *
 * Exported so the story row and its charge can be committed TOGETHER. They are
 * two halves of one fact — "this story was summarised and it cost this much" —
 * and committing them separately is what allowed a failure in the second to
 * erase the first.
 */
export async function applyUsage(tx: Tx, usage: UsageRecord): Promise<void> {
  const [existing] = await tx
    .select({ id: llmUsage.id })
    .from(llmUsage)
    .where(
      and(
        eq(llmUsage.day, usage.day),
        eq(llmUsage.provider, usage.provider),
        eq(llmUsage.model, usage.model),
      ),
    )
    .for("update")
    .limit(1);

  if (!existing) {
    await tx.insert(llmUsage).values({
      day: usage.day,
      provider: usage.provider,
      model: usage.model,
      storiesSummarized: usage.stories,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    return;
  }

  await tx
    .update(llmUsage)
    .set({
      storiesSummarized: sql`${llmUsage.storiesSummarized} + ${usage.stories}`,
      inputTokens: sql`${llmUsage.inputTokens} + ${usage.inputTokens}`,
      outputTokens: sql`${llmUsage.outputTokens} + ${usage.outputTokens}`,
    })
    .where(eq(llmUsage.id, existing.id));
}
