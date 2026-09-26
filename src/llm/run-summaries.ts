import { and, desc, eq, gte, inArray, isNull, lt, notInArray, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { briefWindow, storiesInWindow } from "@/api/brief";
import { rawItems, sources, stories, userPreferences } from "@/db/schema";
import { applyUsage, readDailyCap, remainingToday, usageDay } from "./budget";
import { createLlmClient, type FetchLike, type LlmClient } from "./client";
import { isPaidProvider, readLlmSettings, type LlmEnv } from "./config";
import {
  MAX_ITEMS_IN_PROMPT,
  summarizeStory,
  type StoryForSummary,
  type StorySummary,
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
 * The subset of `ids` that is worth spending on, in the order given.
 *
 * Takes ids rather than building its own query because the ORDER is the
 * caller's: this exists only to apply the two facts the brief's own selection
 * cannot see — that a story already has a summary, and that a failed attempt is
 * inside its retry cooldown.
 */
async function eligibleAmong(db: Db, ids: number[], now: Date): Promise<number[]> {
  if (ids.length === 0) return [];
  const retryBefore = new Date(now.getTime() - RETRY_AFTER_HOURS * 3_600_000);
  const rows = await db
    .select({ id: stories.id })
    .from(stories)
    .where(
      and(
        inArray(stories.id, ids),
        isNull(stories.summary),
        or(isNull(stories.summarizedAt), lt(stories.summarizedAt, retryBefore)),
      ),
    );
  const eligible = new Set(rows.map((r) => r.id));
  return ids.filter((id) => eligible.has(id));
}

/**
 * Brief-window ids first, then backlog, deduplicated, capped.
 *
 * Pure, and separated because this is the decision the whole change is about:
 * everything else here is plumbing that fetches the two lists.
 *
 * THE DEDUPLICATION IS NOT BELT-AND-BRACES. The backlog query excludes the
 * already-chosen ids in SQL, so in production the two lists cannot overlap —
 * but a story summarised twice in one pass would spend twice from a cap of
 * twenty, and that consequence is too expensive to rest on one `notInArray`
 * surviving every future edit to that query. Two mechanisms, and this is the
 * one a test can exercise without a database.
 */
export function orderCandidates(
  briefIds: readonly number[],
  backlogIds: readonly number[],
  limit: number,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const id of [...briefIds, ...backlogIds]) {
    if (out.length >= limit) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Stories worth spending on — THE BRIEF'S OWN ORDER FIRST.
 *
 * THE DEFECT THIS FIXES. The first version ordered by `stories.score` over a
 * seven-day window, which is a reasonable-looking ordering and NOT THE ONE THE
 * READER SEES. On a live pass it wrote seventeen summaries and exactly ONE of
 * them landed in the ten stories the brief was serving: the summariser selected
 * across 845 scored stories, the brief shows what arrived in the reader's
 * window, and nothing connected the two sets. The owner opened his app, saw no
 * summaries, and was right.
 *
 * With a cap of twenty a day, an ordering that is not the reader's spends most
 * of the money on stories nobody opens — and from outside it is indistinguishable
 * from the feature not working.
 *
 * SO THE BRIEF'S SELECTION IS READ, NOT REIMPLEMENTED. `storiesInWindow` is the
 * same function `GET /api/brief` calls, with the same window, the same hidden
 * and adjacent-tech filters and the same ordering. A second copy of that logic
 * here would drift, and the drift would look exactly like this defect returning.
 *
 * The reader's LENGTH preference is deliberately not applied. It lives in the
 * browser (#94) so the worker cannot know it, and it does not need to: the brief
 * serves a PREFIX of this ordering whatever length is chosen, so covering the
 * front of the list covers the front of every length.
 *
 * Whatever budget survives the window goes to the older backlog, in score
 * order, which is what this function used to do with all of it.
 */
export async function selectStoriesToSummarize(
  db: Db,
  now: Date,
  limit: number,
): Promise<StoryForSummary[]> {
  if (limit <= 0) return [];

  // ── The brief's window, in the brief's order ────────────────────────────
  const [prefs] = await db
    .select({ briefTime: userPreferences.briefTime, timezone: userPreferences.timezone })
    .from(userPreferences)
    .limit(1);

  let briefIds: number[] = [];
  if (prefs) {
    // No preferences row means a database not yet seeded, which is not a reason
    // to skip summarising: the backlog pass below still runs.
    const window = briefWindow(now, prefs.briefTime, prefs.timezone);
    const inBrief = await storiesInWindow(db, window);
    const unsummarised = inBrief.filter((card) => card.summary === null).map((card) => card.id);
    briefIds = await eligibleAmong(db, unsummarised, now);
  }

  // ── Then the backlog, in score order ───────────────────────────────────
  const windowStart = new Date(now.getTime() - SUMMARY_WINDOW_HOURS * 3_600_000);
  const retryBefore = new Date(now.getTime() - RETRY_AFTER_HOURS * 3_600_000);
  const backlog =
    briefIds.length >= limit
      ? []
      : await db
          .select({ id: stories.id })
          .from(stories)
          .where(
            and(
              isNull(stories.summary),
              gte(stories.lastActivityAt, windowStart),
              or(isNull(stories.summarizedAt), lt(stories.summarizedAt, retryBefore)),
              briefIds.length > 0 ? notInArray(stories.id, briefIds) : undefined,
            ),
          )
          .orderBy(desc(stories.score))
          .limit(limit - briefIds.length);

  const chosen = orderCandidates(
    briefIds,
    backlog.map((r) => r.id),
    limit,
  );

  // ── Their items, in the chosen order ───────────────────────────────────
  const out: StoryForSummary[] = [];
  for (const id of chosen) {
    const [story] = await db
      .select({ id: stories.id, title: stories.title })
      .from(stories)
      .where(eq(stories.id, id))
      .limit(1);
    if (!story) continue;

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
    // anyway would spend a call to be told so. Left untouched, which keeps it
    // "never attempted" rather than recording a failure it did not have.
    if (items.length > 0) out.push({ id: story.id, title: story.title, items });
  }
  return out;
}

/**
 * Commit the attempt and its charge TOGETHER, or commit neither.
 *
 * THIS ORDERING IS THE FIX FOR A DATA-LOSS PATH, not a tidy-up. The story row
 * and the ledger row are two halves of one fact — "this story was summarised,
 * and it cost this much". Written as two statements, a failure in the second
 * left the first standing and sent the code down a failure path that
 * OVERWROTE A SUMMARY THAT HAD ALREADY BEEN PAID FOR, then charged again on
 * the next retry. One transaction makes that unreachable: if the bookkeeping
 * fails, the story stays untouched and unattempted and the money for that one
 * call is lost, which is the cheapest of the available bad outcomes.
 *
 * AND IT DRAWS THE ABSENT-VERSUS-FAILED LINE, with the two columns the schema
 * already has rather than a new one:
 *
 *   summarized_at NULL ...................... never attempted
 *   summarized_at set, summary NULL ......... attempted, and it failed
 *   summarized_at set, summary present ...... summarised
 *
 * The middle row is the one that did not exist. Without it a story the model
 * choked on is byte-identical to a story nobody has reached yet, and the retry
 * rule above has nothing to read.
 */
async function recordOutcome(
  db: Db,
  story: { id: number },
  now: Date,
  client: { provider: string; model: string },
  day: string,
  result: StorySummary | null,
  tokens: { inputTokens: number; outputTokens: number },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(stories)
      .set({
        summary: result?.summary ?? null,
        whyItMatters: result?.whyItMatters ?? null,
        keyPoints: result?.keyPoints ?? [],
        summaryProvider: client.provider,
        summarizedAt: now,
        updatedAt: now,
      })
      .where(eq(stories.id, story.id));

    // Charged whether or not the answer was usable. The call left the building
    // and the provider billed for it; a ledger that counted only successes
    // would under-report the bill in exactly the case somebody is watching it.
    await applyUsage(tx, {
      day,
      provider: client.provider,
      model: client.model,
      stories: 1,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
    });
  });
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
 * THIS FUNCTION DOES NOT THROW, and that is now a property of its shape rather
 * than a promise in a comment. Every database call it makes — the ledger read
 * at the top, the same read on each iteration, the story selection and the
 * bookkeeping — is inside the outer try. It used to say "NEVER THROWS" with
 * nothing enforcing it, which is a claim, and a claim is what this project
 * keeps deleting.
 *
 * It matters more than it looks: the caller's pass has already collected and
 * scored seventeen feeds by the time this runs, and #137 opens a GitHub issue
 * when a run fails. Without this, a transient database hiccup in an OPTIONAL
 * ENHANCEMENT would raise an outage alarm — and an alarm that cries wolf
 * trains its reader to ignore it.
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

  let budget = 0;
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    budget = await remainingToday(db, day, cap);

    if (budget <= 0) {
      // The refusal, out loud and by name. Rule 3 of cost-protection.md is
      // that the cap refuses rather than warns; this is the branch that does
      // it, and run-summaries.test.ts asserts no call is made from here.
      return { ...IDLE, skipped: `daily cap reached (${cap} stories/day)` };
    }

    const client = options.client ?? createLlmClient(settings.config, options.fetchImpl);
    const candidates = await selectStoriesToSummarize(db, now, budget);

    for (const story of candidates) {
      // Re-read from the ledger every iteration rather than trusting the slice
      // above: a cap enforced only by the size of a list is enforced by
      // arithmetic done before the spending started.
      const left = await remainingToday(db, day, cap);
      if (left <= 0) {
        log(`[summaries] daily cap of ${cap} reached; stopping.`);
        break;
      }

      attempted++;
      let result: StorySummary | null = null;
      let tokens = { inputTokens: 0, outputTokens: 0 };

      // ONLY the provider call is caught here. Bookkeeping failures are NOT
      // swallowed into this branch: doing so is what let a database error be
      // recorded as "the model produced rubbish" and erase a paid summary.
      try {
        const outcome = await summarizeStory(client, story);
        result = outcome.summary;
        tokens = {
          inputTokens: outcome.inputTokens ?? 0,
          outputTokens: outcome.outputTokens ?? 0,
        };
      } catch (error) {
        log(`[summaries] story ${story.id} failed: ${describeFailure(error)}`);
      }

      await recordOutcome(db, story, now, client, day, result, tokens);
      if (result) succeeded++;
      else failed++;
    }

    const paid = isPaidProvider(settings.config.provider);
    log(
      `[summaries] ${succeeded} written, ${failed} failed, ${budget - attempted} of ${cap} ${
        paid ? "paid " : ""
      }calls left today.`,
    );

    return { skipped: null, budgetAtStart: budget, attempted, succeeded, failed };
  } catch (error) {
    // The outer guard. Counts collected so far are returned rather than
    // discarded, and `attempted` exceeding `succeeded + failed` is the signal
    // that a call was paid for and its result never committed.
    const why = describeFailure(error);
    log(`[summaries] stopped after an error: ${why}`);
    return {
      skipped: `stopped after an error: ${why}`,
      budgetAtStart: budget,
      attempted,
      succeeded,
      failed,
    };
  }
}
