import { and, desc, eq, gte, isNull, lt, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rawItems, sources, stories } from "@/db/schema";
import { readDailyCap, recordUsage, remainingToday, usageDay } from "./budget";
import { createLlmClient, type FetchLike, type LlmClient } from "./client";
import { isPaidProvider, readLlmSettings, type LlmEnv } from "./config";
import {
  MAX_ITEMS_IN_PROMPT,
  summarizeStory,
  UnusableSummaryError,
  type StoryForSummary,
} from "./summarize";

/**
 * The summarising half of a pass.
 *
 * Runs after ingest and ranking, in the worker only. A page render must never
 * reach this file — docs/cost-protection.md rule 2 — and `npm run routes:check`
 * is what keeps that true rather than this sentence.
 */

/** Stories older than this are not worth spending on; matches the ranking window. */
export const SUMMARY_WINDOW_HOURS = 7 * 24;

/**
 * How long a failed story waits before it is tried again.
 *
 * A story that cannot be summarised — a feed with no excerpts, a model that
 * keeps answering in prose — would otherwise be retried every pass and eat the
 * daily cap while newer stories go without. Six hours costs at most a few
 * attempts a day against a permanently bad story, while still recovering from
 * a provider outage the same day instead of the next one.
 */
export const RETRY_AFTER_HOURS = 6;

export interface SummaryRunResult {
  /** Null when summaries ran; otherwise the sentence naming why they did not. */
  skipped: string | null;
  /** Budget left when the run started, after reading today's ledger. */
  budgetAtStart: number;
  attempted: number;
  succeeded: number;
  failed: number;
}

const IDLE: SummaryRunResult = {
  skipped: null,
  budgetAtStart: 0,
  attempted: 0,
  succeeded: 0,
  failed: 0,
};

/**
 * Stories worth spending on, best first.
 *
 * Ordered by score so that when the cap binds — which is the normal case, not
 * the exception — the budget goes to what the reader actually sees at the top
 * of the brief rather than to whatever happened to be inserted first.
 */
export async function selectStoriesToSummarize(
  db: Db,
  now: Date,
  limit: number,
): Promise<StoryForSummary[]> {
  if (limit <= 0) return [];

  const windowStart = new Date(now.getTime() - SUMMARY_WINDOW_HOURS * 3_600_000);
  const retryBefore = new Date(now.getTime() - RETRY_AFTER_HOURS * 3_600_000);

  const candidates = await db
    .select({ id: stories.id, title: stories.title })
    .from(stories)
    .where(
      and(
        isNull(stories.summary),
        gte(stories.lastActivityAt, windowStart),
        or(isNull(stories.summarizedAt), lt(stories.summarizedAt, retryBefore)),
      ),
    )
    .orderBy(desc(stories.score))
    .limit(limit);

  const out: StoryForSummary[] = [];
  for (const story of candidates) {
    const items = await db
      .select({
        title: rawItems.title,
        excerpt: rawItems.excerpt,
        sourceName: sources.name,
      })
      .from(rawItems)
      .innerJoin(sources, eq(rawItems.sourceId, sources.id))
      .where(eq(rawItems.storyId, story.id))
      .orderBy(desc(rawItems.publishedAt))
      .limit(MAX_ITEMS_IN_PROMPT);

    // A story with no items cannot be summarised from stored text, and asking
    // anyway would spend a call to be told so. It is left untouched, which
    // keeps it "never attempted" rather than recording a failure it did not
    // have.
    if (items.length > 0) out.push({ id: story.id, title: story.title, items });
  }
  return out;
}

/**
 * Mark a story as attempted, with or without a result.
 *
 * THIS IS THE ABSENT-VERSUS-FAILED LINE, and it is drawn with the two columns
 * the schema already has rather than a new one:
 *
 *   summarized_at NULL ...................... never attempted
 *   summarized_at set, summary NULL ......... attempted, and it failed
 *   summarized_at set, summary present ...... summarised
 *
 * The middle row is the one that did not exist before. Without it a story the
 * model choked on is byte-identical to a story nobody has reached yet, and the
 * retry rule above has nothing to read.
 */
async function recordAttempt(
  db: Db,
  storyId: number,
  now: Date,
  provider: string,
  result: { summary: string; whyItMatters: string; keyPoints: string[] } | null,
): Promise<void> {
  await db
    .update(stories)
    .set({
      summary: result?.summary ?? null,
      whyItMatters: result?.whyItMatters ?? null,
      keyPoints: result?.keyPoints ?? [],
      summaryProvider: provider,
      summarizedAt: now,
      updatedAt: now,
    })
    .where(eq(stories.id, storyId));
}

export interface RunSummariesOptions {
  env?: LlmEnv;
  now?: Date;
  /** Injected in tests. Production passes nothing. */
  fetchImpl?: FetchLike;
  /** Injected in tests so the cap can be exercised without a network. */
  client?: LlmClient;
  log?: (line: string) => void;
}

/**
 * Summarise as many stories as today's budget allows, then stop.
 *
 * NEVER THROWS. Summaries are an enhancement on top of a pass that has already
 * collected and scored everything; a provider outage must not turn a green
 * ingestion red. Failures are counted, logged and recorded on the story.
 */
export async function runSummaries(
  db: Db,
  options: RunSummariesOptions = {},
): Promise<SummaryRunResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const log = options.log ?? ((line: string) => console.log(line));

  const settings = readLlmSettings(env);
  if (!settings.enabled) {
    return { ...IDLE, skipped: settings.reason };
  }

  const cap = readDailyCap(env);
  const day = usageDay(now);
  const budget = await remainingToday(db, day, cap);

  if (budget <= 0) {
    // The refusal, out loud and by name. Rule 3 of cost-protection.md is that
    // the cap refuses rather than warns; this is the branch that does it, and
    // budget.test.ts asserts no call is made from here.
    return {
      ...IDLE,
      skipped: `daily cap reached (${cap} stories/day)`,
      budgetAtStart: 0,
    };
  }

  const client = options.client ?? createLlmClient(settings.config, options.fetchImpl);
  const candidates = await selectStoriesToSummarize(db, now, budget);

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const story of candidates) {
    // Re-checked every iteration rather than trusting the slice above: the
    // ledger is shared and the loop can be long. A cap enforced only by the
    // size of a list is enforced by arithmetic done before the spending
    // started.
    const left = await remainingToday(db, day, cap);
    if (left <= 0) {
      log(`[summaries] daily cap of ${cap} reached; stopping.`);
      break;
    }

    attempted++;
    try {
      const outcome = await summarizeStory(client, story);
      await recordAttempt(db, story.id, now, client.provider, outcome.summary);
      succeeded++;
      await recordUsage(db, {
        day,
        provider: client.provider,
        model: client.model,
        stories: 1,
        inputTokens: outcome.inputTokens ?? 0,
        outputTokens: outcome.outputTokens ?? 0,
      });
    } catch (error) {
      failed++;
      const why =
        error instanceof UnusableSummaryError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      log(`[summaries] story ${story.id} failed: ${why}`);
      await recordAttempt(db, story.id, now, client.provider, null);
      // Charged to the budget anyway. The call left the building and the
      // provider billed for it whether or not the answer was usable, so a
      // ledger that skipped this would under-report the bill in exactly the
      // case somebody is watching it. An unusable reply is the expensive
      // failure, not the free one.
      await recordUsage(db, {
        day,
        provider: client.provider,
        model: client.model,
        stories: 1,
        inputTokens: 0,
        outputTokens: 0,
      });
    }
  }

  const paid = isPaidProvider(settings.config.provider);
  log(
    `[summaries] ${succeeded} written, ${failed} failed, ${budget - attempted} of ${cap} ${
      paid ? "paid " : ""
    }calls left today.`,
  );

  return { skipped: null, budgetAtStart: budget, attempted, succeeded, failed };
}
