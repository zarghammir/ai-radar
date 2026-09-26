import { and, desc, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { ContentType } from "@/db/schema";
import { ingestRuns, stories } from "@/db/schema";
import { ApiError } from "./http";
import type { BriefLength } from "./reading-budget";
import { BRIEF_LENGTHS } from "./reading-budget";
import { notAdjacentTech, notHidden } from "./radar";
// IMPORTED, NOT COPIED. The brief's bound and the ranker's horizon must be the
// same number or the brief sorts on scores the ranker has stopped maintaining.
import { STORY_WINDOW_HOURS } from "@/pipeline/run";
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
 * `briefTime` keeps its real job — src/notify/run-brief.ts uses briefWindow to
 * decide when to SEND. It no longer decides what exists.
 *
 * RANKED, NOT CHRONOLOGICAL — the owner ruled it: "the 5 most important,
 * recent ones." He was offered strictly-newest and declined the consequence,
 * which is that a big story gets pushed off by newer trivia within the hour.
 * Score order keeps it on top for a while, and with no admission filter the
 * screen still cannot be empty while the collector works.
 *
 * SO "RECENT" HAS TO MEAN SOMETHING, AND THIS IS THE BOUND.
 *
 * With no filter and score ordering, the top five would otherwise be the
 * all-time best rather than today's — and worse than that, they would be the
 * best according to a STALE number. `stories.score` is computed and STORED,
 * and the pipeline only recomputes it for stories whose `lastActivityAt` is
 * within STORY_WINDOW_HOURS (src/pipeline/run.ts). Past that horizon a story
 * keeps whatever score it had when it was fresh — recency is 14 points of it
 * (ten-hour half-life), so a once-hot story stays permanently inflated and
 * would lead the brief forever.
 *
 * The bound is therefore THE SAME HORIZON THE RANKER MAINTAINS, imported
 * rather than copied. Beyond it the ordering key is meaningless, so this is
 * not a policy about what the reader deserves to see — it is the range over
 * which the number being sorted on is still true.
 *
 * IT IS MEASURED BY ARRIVAL, NOT PUBLICATION, and that is #148 surviving. A
 * story published last week and fetched this morning is news to this reader;
 * bounding on publication would have re-created the exact defect #148 fixed,
 * one layer down, while looking like a tidy-up.
 *
 * AND IT IS NOT THE WINDOW THAT WAS REMOVED. That one was anchored to the
 * READER'S OWN briefTime: personal, re-anchored every day, and capable of
 * being five minutes wide at 09:05. This is fixed, product-wide, three days
 * long, and cannot go empty while the collector is working — if a sweep has
 * run, something has activity inside 72 hours.
 */
export async function recentStories(db: Db, options: BriefOptions = {}): Promise<StoryCard[]> {
  const { includeAdjacent = false, types } = options;
  const rows = await db
    .select()
    .from(stories)
    .where(
      and(
        // The bound, not a window — see the note above. BY ARRIVAL, not by
        // publication: #148's ruling is that a story which reached this app
        // recently is news to the reader even if it was published earlier, and
        // bounding on publication would have thrown that away again. A story
        // fetched this morning and published last week still counts.
        arrivedSince(new Date(Date.now() - STORY_WINDOW_HOURS * 3_600_000)),
        notHidden(),
        ...(includeAdjacent ? [] : [notAdjacentTech()]),
        types && types.length > 0 ? inArray(stories.contentType, [...types]) : undefined,
      ),
    )
    // BY SCORE, which is what "most important" means here, and which is
    // unchanged from before the window came out. Only the admission rule
    // changed; the ordering is the one the ranker already produces.
    .orderBy(desc(stories.score), desc(stories.id))
    .limit(BRIEF_CANDIDATE_LIMIT);
  return buildCards(db, rows);
}

/**
 * How far back "recently" reaches WHEN REPORTING, and nowhere else.
 *
 * Nothing is filtered by this. It bounds the sweep diagnostic, so an empty
 * screen can say how much the collector has written lately — see sweepSummary.
 */
export const RECENT_ACTIVITY_HOURS = 24;

/**
 * The period the empty state talks about, plus the reader's delivery settings.
 *
 * THIS IS NOT AN ADMISSION WINDOW. It replaces one, and the distinction is the
 * whole change: `from`/`to` describe what the app is REPORTING on, and
 * `briefTime`/`timezone` ride along because the reader's delivery setting is
 * worth showing next to it. Nothing here decides which stories exist.
 */
export function reportingWindow(now: Date, briefTime: string, timezone: string): BriefWindow {
  // Validated through briefWindow so an invalid briefTime or timezone is still
  // rejected in exactly the same way and with the same message — the setting
  // did not stop being real, it stopped being a filter.
  const validated = briefWindow(now, briefTime, timezone);
  const from = new Date(now.getTime() - RECENT_ACTIVITY_HOURS * 60 * 60 * 1000);
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
