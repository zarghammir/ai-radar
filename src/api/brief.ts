import { and, desc, gte, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { ContentType } from "@/db/schema";
import { stories } from "@/db/schema";
import { ApiError } from "./http";
import type { BriefLength } from "./reading-budget";
import { BRIEF_LENGTHS } from "./reading-budget";
import { notAdjacentTech, notHidden } from "./radar";
import { buildCards, type StoryCard } from "./stories";

// One implementation, in a module with no database imports so the fixtures can
// use the same rule rather than a copy that drifts. See reading-budget.ts.
export { BRIEF_LENGTHS, takeWithinReadingTime } from "./reading-budget";
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

export async function storiesInWindow(
  db: Db,
  window: BriefWindow,
  options: BriefOptions = {},
): Promise<StoryCard[]> {
  const { includeAdjacent = false, types } = options;
  const rows = await db
    .select()
    .from(stories)
    .where(
      and(
        gte(stories.lastActivityAt, window.from),
        notHidden(),
        ...(includeAdjacent ? [] : [notAdjacentTech()]),
        types && types.length > 0 ? inArray(stories.contentType, [...types]) : undefined,
      ),
    )
    .orderBy(desc(stories.score), desc(stories.id))
    .limit(BRIEF_CANDIDATE_LIMIT);
  return buildCards(db, rows);
}
