import { and, desc, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { ContentType } from "@/db/schema";
import { ingestRuns, stories } from "@/db/schema";
import { ApiError } from "./http";
import type { BriefLength } from "./reading-budget";
import { BRIEF_LENGTHS } from "./reading-budget";
import { notAdjacentTech, notHidden } from "./radar";
// IMPORTED, NOT COPIED. The brief's bound and the ranker's horizon must be the
// same number or the brief sorts on scores the ranker has stopped maintaining.
import { RANKING_WINDOW_HOURS, STORY_WINDOW_HOURS } from "@/pipeline/story-window";
import { buildCards, type StoryCard } from "./stories";

// One implementation, in a module with no database imports so the fixtures can
// use the same rule rather than a copy that drifts. See reading-budget.ts.
export { BRIEF_LENGTHS, BRIEF_STORY_COUNTS, takeBriefStories } from "./reading-budget";
export type { BriefLength } from "./reading-budget";

export interface BriefWindow {
  from: Date;
  to: Date;
  briefTime: string;
  timezone: string;
}

/** What a zone's UTC offset is at a given instant, in milliseconds. */
function offsetAt(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // A midnight local time formats as hour 24 in some locales.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - at.getTime();
}

/**
 * The instant at which a local wall-clock time occurs in a zone.
 *
 * Resolved twice because the offset depends on the instant we are still
 * solving for: the first pass gets close, the second corrects it across a
 * daylight-saving boundary.
 */
function instantOfLocalTime(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hours, minutes);
  const firstPass = new Date(naive - offsetAt(new Date(naive), timeZone));
  return new Date(naive - offsetAt(firstPass, timeZone));
}

/** The calendar date it is right now in a zone. */
function localDateParts(at: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/**
 * The window the brief covers: the most recent occurrence of the reader's
 * brief time, up to now.
 *
 * Derived every request rather than remembered. Nothing records that a brief
 * was delivered, so reloading does not use one up, and two requests an hour
 * apart describe the same window.
 */
/**
 * What a brief runs to when the caller expresses no preference. Since #94 the
 * reader's own length is in their browser, so there is no stored value for a
 * route to fall back to — this is the product's default, not a person's.
 */
export const DEFAULT_BRIEF_LENGTH = "10" as const;

export function briefWindow(now: Date, briefTime: string, timezone: string): BriefWindow {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(briefTime);
  if (!match) {
    throw new ApiError("VALIDATION_ERROR", "briefTime must be HH:MM in 24-hour form");
  }
  let parts;
  try {
    parts = localDateParts(now, timezone);
  } catch {
    throw new ApiError("VALIDATION_ERROR", `timezone "${timezone}" is not an IANA time zone`);
  }

  const today = instantOfLocalTime(
    parts.year,
    parts.month,
    parts.day,
    Number(match[1]),
    Number(match[2]),
    timezone,
  );
  if (today <= now) return { from: today, to: now, briefTime, timezone };

  // Before the reader's brief time, so the most recent occurrence was
  // yesterday's — resolved on yesterday's CALENDAR date, not by subtracting 24
  // hours. Across a daylight-saving change the two differ by an hour, and the
  // subtraction would put the window an hour off in the reader's own morning.
  const previous = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  previous.setUTCDate(previous.getUTCDate() - 1);
  const from = instantOfLocalTime(
    previous.getUTCFullYear(),
    previous.getUTCMonth() + 1,
    previous.getUTCDate(),
    Number(match[1]),
    Number(match[2]),
    timezone,
  );
  return { from, to: now, briefTime, timezone };
}

export function parseBriefLength(raw: string | null, fallback: string): BriefLength {
  const value = raw ?? fallback;
  if (!(BRIEF_LENGTHS as readonly string[]).includes(value)) {
    throw new ApiError("VALIDATION_ERROR", `length must be one of ${BRIEF_LENGTHS.join(", ")}`);
  }
  return value as BriefLength;
}

/** Most stories a brief will ever consider, before the reading budget trims it. */
export const BRIEF_CANDIDATE_LIMIT = 200;

/**
 * The highest-ranked stories in the window, best first.
 *
 * Ordered by score, so until the ranking run has written one every story
 * scores 0 and this falls back to newest-first by id — which is the same
 * degenerate behaviour the radar's importance sort documents.
 */
/**
 * Narrowing options for the brief.
 *
 * An object rather than positional arguments because two lanes are adding an
 * axis to this function from different bases (#105 and #102), and two optional
 * positionals of different types in an order nobody agreed is how the third
 * person passes them the wrong way round. A third axis is another key here, not
 * another argument.
 *
 * Every key defaults NARROW, and omitting the object entirely is exactly the
 * behaviour this function had before any of them existed. #102 took that
 * instruction literally on the merge: `types` arrived on this branch as a third
 * POSITIONAL parameter and is a key here instead.
 *
 * THE TWO AXES ARE ORTHOGONAL AND BOTH APPLY. `includeAdjacent` is about
 * whether a story is AI-related at all; `types` is about which KIND of thing it
 * is. They narrow on different columns and neither substitutes for the other,
 * so the query carries both conditions rather than choosing between them.
 */
export interface BriefOptions {
  /** Include adjacent tech — stories kept deliberately that never used AI
   *  vocabulary. False is the front door: the app is an AI radar. */
  includeAdjacent?: boolean;

  /**
   * Which content types the brief may contain. OMITTING IT PRESERVES TODAY'S
   * BEHAVIOUR: every stored type.
   *
   * A list rather than a view name on purpose — this module decides what a
   * brief IS, not what leads on the front door, and a view is a product
   * decision that belongs to the caller (see src/lib/api/views.ts).
   *
   * The filter is applied IN THE QUERY, before the candidate limit and
   * therefore before the reading-time budget its caller applies. Filtering
   * afterwards would return three stories for a ten-minute brief, because the
   * budget would already have been spent on rows the reader never sees — a bug
   * a reader would feel and never be able to describe.
   */
  types?: readonly ContentType[];
}

/**
 * ADMISSION IS BY ARRIVAL. ORDERING IS NOT.
 *
 * THE BUG THIS FIXES, hit by the owner on the live site (#148). His window
 * opened at 07:30 and the screen said "nothing has arrived since your brief
 * window opened — the database answered, so this is a quiet morning rather
 * than a fault." The collector had written 64 stories that day and 13 more at
 * 12:17. It was not a quiet morning.
 *
 * Admission keyed on `stories.lastActivityAt`, which refreshStory computes as
 * the newest PUBLISHED time of the story's items. So a story published at 02:00
 * and fetched at 12:17 has lastActivityAt 02:00 — before a 07:30 window, and
 * invisible for the whole day it arrived in. That is most stories: publishers
 * file overnight and we sweep in the morning.
 *
 * A brief is "what arrived for you", so it admits on `raw_items.fetched_at` —
 * when this app first held the thing. Publication is still what the story SAYS
 * about itself and still what `lastActivityAt` means; it is simply not the
 * question "is this new to me".
 *
 * EXISTS RATHER THAN A DENORMALISED COLUMN, deliberately. A column would need a
 * migration, and the collector spent four days dead because a change added a
 * column and started writing it in the same deploy with nothing applying
 * migrations on merge. `raw_items_story_idx` already exists, so this reads the
 * index rather than the table, and it ships without a schema change at all.
 */
/**
 * Still used, but ONLY by the sweep diagnostic below — never to decide what a
 * reader may see. It reports how much has landed recently so an empty screen
 * can say why; it does not filter the brief.
 */
function arrivedSince(from: Date): SQL {
  // AN ISO STRING WITH AN EXPLICIT CAST, not the Date. Interpolating a Date
  // into a raw `sql` template hands it straight to postgres.js, which wants a
  // string or a Buffer and throws "Received an instance of Date" — every brief
  // request a 500. notHidden() next door never hit this because it interpolates
  // only column references, so the pattern it models does not cover a value.
  return sql`exists (
    select 1 from raw_items ri
    where ri.story_id = ${stories.id} and ri.fetched_at >= ${from.toISOString()}::timestamptz
  )`;
}

/**
 * THE STORIES A BRIEF DRAWS FROM: everything recent, newest first.
 *
 * THERE IS NO LONGER AN ADMISSION WINDOW, and removing it is the point. This
 * used to be `storiesInWindow`, anchored to the reader's `briefTime`, which
 * made one setting do two jobs: decide when the push is sent, AND decide what
 * the reader is allowed to see. Only the first is legitimate. Opening the app
 * at 09:05 with a 09:00 brief time showed whatever had arrived in five
 * minutes, which is nothing — the owner hit exactly that and said: "It doesn't
 * need to be open at 9. It needs to consistently receive news."
 *
 * #148 is the near miss worth recording. It changed admission from publication
 * to ARRIVAL and left the anchor in place, so it corrected which timestamp
 * counted without noticing that the question itself was wrong. A screen can be
 * honest about what it checked and still be checking the wrong thing.
 *
 * `briefTime` ONCE HAD A SECOND JOB and no longer has either. It decided when
 * the brief was SENT, and #189 removed sending entirely; it never decided what
 * exists, which was the point of the change above. What remains is a label on
 * the settings screen.
 *
 * RANKED, NOT CHRONOLOGICAL — the owner ruled it: "the 5 most important,
 * recent ones." He was offered strictly-newest and declined the consequence,
 * which is that a big story gets pushed off by newer trivia within the hour.
 * Score order keeps it on top for a while, and with no admission filter the
 * screen still cannot be empty while the collector works.
 *
 * SO "RECENT" HAS TO MEAN SOMETHING, AND THERE ARE TWO BOUNDS, FOR TWO
 * DIFFERENT REASONS. Only one of them is a technical necessity, and an
 * earlier version of this comment claimed both were — which foreclosed a
 * product question by dressing it as arithmetic.
 *
 * BOUND ONE, ARRIVAL WITHIN STORY_WINDOW_HOURS: A PRODUCT JUDGEMENT.
 *
 * Recency is at most 14 points of a score that sums to roughly 84, so an
 * older story with strong structure — primary source 20, corroboration 16,
 * topic match 22 — outranks a fresh weaker one ON A PERFECTLY CURRENT SCORE.
 * Nothing is stale and nothing is broken; without a bound the brief simply
 * fills with correct rankings of old things. That is a choice about what the
 * reader should see, the owner asked for "recent", and three days is a fair
 * reading of it. IT IS ARGUABLE, AND IT IS SUPPOSED TO BE.
 *
 * (The earlier claim that an out-of-window story "freezes holding whatever
 * score it had when it was fresh" was simply wrong. A story is re-scored on
 * every pass while it is inside the ranking window, so by the time it leaves,
 * recency has decayed to about 0.0001 points. Nothing inflates.)
 *
 * BOUND TWO, ACTIVITY WITHIN RANKING_WINDOW_HOURS: THE NECESSITY.
 *
 * `stories.score` defaults to 0 and rank-all.ts only maintains it for stories
 * whose `lastActivityAt` is inside RANKING_WINDOW_HOURS. A story published
 * more than seven days ago and fetched this morning is therefore NEVER
 * SCORED — and ordering by score would put it dead last behind everything
 * ever ranked, so at length=5 the reader never sees it.
 *
 * A DEFAULT IS NOT A LOW SCORE; IT IS THE ABSENCE OF A SCORE, and sorting on
 * it is this project's own defect family living in the ordering key. So the
 * brief must never admit a story the ranker cannot have scored.
 *
 * THE TWO CLOCKS ARE THE TRAP. Admission is measured on ARRIVAL
 * (raw_items.fetched_at) and both horizons are measured on PUBLICATION
 * (stories.lastActivityAt, set from the newest source's publishedAt). So this
 * is not 72 against 168; it is 72 of one clock against 168 of another, and a
 * story can be recent on one and ancient on the other. That gap is exactly
 * what #148 was about, one layer down: #148's own sentence is "a story
 * published last week and fetched this morning is news to this reader", and
 * the ordering key contradicted it while the admission filter honoured it.
 *
 * THE NARROW FIX IS HERE AND THE WIDE ONE IS TICKETED. Bound two excludes
 * what cannot be ranked, so nothing is ever sorted on a default — but it also
 * means a story published nine days ago and fetched today does not appear at
 * all. The invariant that removes that limitation is "a story admitted to the
 * brief must have a maintained score", achieved by ranking on the same fact
 * admission uses rather than by excluding. That is a pipeline change and it
 * is filed separately.
 */
export async function recentStories(db: Db, options: BriefOptions = {}): Promise<StoryCard[]> {
  const { includeAdjacent = false, types } = options;
  const rows = await db
    .select()
    .from(stories)
    .where(
      and(
        // BOUND ONE — the product judgement, measured on ARRIVAL.
        arrivedSince(briefHorizon()),
        // BOUND TWO — the necessity, measured on PUBLICATION. Without it a
        // story the ranker never scored is admitted carrying score 0 and
        // sorted below everything, which is worse than absent because it
        // looks fine. See the note above.
        gte(stories.lastActivityAt, rankedSince()),
        notHidden(),
        ...(includeAdjacent ? [] : [notAdjacentTech()]),
        types && types.length > 0 ? inArray(stories.contentType, [...types]) : undefined,
      ),
    )
    // BY SCORE, which is what "most important" means here, and which is
    // unchanged from before the window came out. Only the admission rule
    // changed; the ordering is the one the ranker already produces.
    /**
     * NEWEST FIRST, THEN THE MOST IMPORTANT — the owner's words, 2026-10-02,
     * ruling on what a single merged feed should do.
     *
     * Two keys, not one. The first bucket is whether a story arrived in the
     * last 24 hours; the second is score. So today's arrivals lead the feed in
     * their own importance order, and everything older follows in its own.
     *
     * WHY NOT PURE RECENCY. He was offered that in an earlier round and
     * declined it: "the 5 most important, recent ones." A strict time sort
     * pushes a major launch off the screen within the hour on the strength of
     * newer trivia.
     *
     * WHY NOT PURE SCORE, WHICH IS WHAT THIS WAS. Measured 2026-09-30: zero of
     * the top twenty carried anything from the previous day, because a
     * corroborated launch scores around 66 and a single-source news item around
     * 12–18, and the age decay cannot close that without inverting the ordering
     * (#186 has the arithmetic). He opened the app on two consecutive days and
     * saw the same stories. That is the defect this ruling answers.
     *
     * The bucket is 24 hours of ARRIVAL, matching the admission filter above,
     * rather than publication — a paper published last week and fetched this
     * morning is new to this reader, which is #148's sentence and the same
     * clock this query already uses.
     */
    .orderBy(
      desc(sql`exists (
        select 1 from raw_items ri
        where ri.story_id = ${stories.id}
          and ri.fetched_at >= now() - interval '24 hours'
      )`),
      desc(stories.score),
      desc(stories.id),
    )
    .limit(BRIEF_CANDIDATE_LIMIT);
  return buildCards(db, rows);
}

/**
 * THE ONE CUTOFF. Everything that bounds or reports the brief derives from
 * this call, so the measured set and the reported period CANNOT DISAGREE.
 *
 * They did, for one commit, and the Intelligence lane caught it: recentStories
 * bounded at 72 hours while reportingWindow reported 24, so the coverage step
 * would have printed a 24-hour period beside a figure computed over 72 — off
 * by 3x, with an ISO timestamp on each end lending it false precision. The
 * same skew reached the reader: sweepSummary counted arrivals in 24 hours to
 * explain a brief selected over 72, so a story that arrived 30 hours ago and
 * was filtered out would have produced "genuinely quiet" on a day that was
 * not.
 *
 * ON MAIN THE TWO AGREED BY CONSTRUCTION, because briefWindow produced a
 * single value used as both. Splitting it into two constants that happened to
 * be right was the regression — picking the correct number would have made
 * them agree today, and only deriving them from one value makes them unable
 * to disagree tomorrow. Nothing downstream would have revealed the error: a
 * low coverage figure reads as "the cap is too small" and a high one as
 * "fixed", and neither reading corrects the label.
 */
export function briefHorizon(now: Date = new Date()): Date {
  return new Date(now.getTime() - STORY_WINDOW_HOURS * 60 * 60 * 1000);
}

/**
 * The oldest PUBLICATION activity whose score rank-all.ts still maintains.
 *
 * Anything older carries whatever `score` it last had, or the column default
 * of 0 if it was never ranked at all. The brief must not order by that.
 */
export function rankedSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - RANKING_WINDOW_HOURS * 60 * 60 * 1000);
}

/**
 * The period the empty state talks about, plus the reader's brief settings.
 *
 * THIS IS NOT AN ADMISSION WINDOW. It replaces one, and the distinction is the
 * whole change: `from`/`to` describe what the app is REPORTING on, and
 * `briefTime`/`timezone` ride along because they are worth showing next to it.
 * Nothing here decides which stories exist. They no longer schedule anything
 * either — #189 removed delivery — so they are now labels rather than settings
 * that act.
 *
 * `from` IS THE QUERY'S OWN CUTOFF, not a second number chosen to match it.
 * A report whose bounds do not bound the thing being measured is worse than a
 * report with no bounds, because it invites the wrong inference confidently.
 */
export function reportingWindow(now: Date, briefTime: string, timezone: string): BriefWindow {
  // Validated through briefWindow so an invalid briefTime or timezone is still
  // rejected in exactly the same way and with the same message — the setting
  // did not stop being real, it stopped being a filter.
  const validated = briefWindow(now, briefTime, timezone);
  // THE SAME CUTOFF THE QUERY USES, from the same function. See briefHorizon.
  const from = briefHorizon(now);
  return { from, to: now, briefTime: validated.briefTime, timezone: validated.timezone };
}

/**
 * What the collector has been doing, so an empty brief can never again be
 * mistaken for a quiet day (#148).
 *
 * The screen that caused this ticket said "the database answered, so this is a
 * quiet morning rather than a fault." Every word was true about what it had
 * CHECKED, and the conclusion was wrong: 64 stories had been collected that
 * day. Honest about the check, wrong about the cause — the reading-side twin
 * of the collector outage, where the system was fine, the user saw nothing,
 * and the message reassured.
 *
 * So the empty state is given two facts it cannot infer for itself:
 *
 *   lastFinishedAt          when a sweep last COMPLETED. Null means none ever
 *                           has, which is a different screen from a quiet day.
 *   itemsSinceWindowOpened  how much the collector has written since the
 *                           reader's window opened.
 *
 * The second is the one that turns a reassurance into a lead. If it is zero the
 * morning really was quiet. If it is not, stories arrived and none of them are
 * in this view — which points at the filter or the window, and is actionable.
 */
export interface SweepSummary {
  lastFinishedAt: string | null;
  itemsSinceWindowOpened: number;
}

export async function sweepSummary(db: Db, from: Date): Promise<SweepSummary> {
  const [row] = await db
    .select({
      lastFinishedAt: sql<Date | null>`max(${ingestRuns.finishedAt})`,
      // COALESCE because sum() over no rows is NULL, and "the collector wrote
      // nothing" must not arrive as an absent number that renders as blank.
      // Zero is an answer; null is the absence of one.
      itemsSinceWindowOpened: sql<number>`coalesce(sum(${ingestRuns.itemsNew}) filter (where ${ingestRuns.finishedAt} >= ${from.toISOString()}::timestamptz), 0)::int`,
    })
    .from(ingestRuns);

  return {
    lastFinishedAt: row?.lastFinishedAt ? new Date(row.lastFinishedAt).toISOString() : null,
    itemsSinceWindowOpened: Number(row?.itemsSinceWindowOpened ?? 0),
  };
}
