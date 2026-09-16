import { and, desc, gte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { stories } from "@/db/schema";
import { ApiError } from "./http";
import { notHidden } from "./radar";
import { buildCards, type StoryCard } from "./stories";

export const BRIEF_LENGTHS = ["5", "10", "all"] as const;
export type BriefLength = (typeof BRIEF_LENGTHS)[number];

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

/**
 * Take stories until the reading time would exceed the target.
 *
 * A time budget, not a story count: "five-minute mode" means five minutes of
 * reading. Always returns at least one story when there are any, because a
 * brief that hides a long story rather than showing one is not a brief.
 */
export function takeWithinReadingTime(stories: StoryCard[], length: BriefLength): StoryCard[] {
  if (length === "all") return stories;
  const target = Number(length);
  const taken: StoryCard[] = [];
  let minutes = 0;
  for (const story of stories) {
    if (taken.length > 0 && minutes + story.readingMinutes > target) break;
    taken.push(story);
    minutes += story.readingMinutes;
  }
  return taken;
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
export async function storiesInWindow(db: Db, window: BriefWindow): Promise<StoryCard[]> {
  const rows = await db
    .select()
    .from(stories)
    .where(and(gte(stories.lastActivityAt, window.from), notHidden()))
    .orderBy(desc(stories.score), desc(stories.id))
    .limit(BRIEF_CANDIDATE_LIMIT);
  return buildCards(db, rows);
}
