import { z } from "zod";
import { CONTENT_TYPES, SOURCE_TIERS, VERIFICATION_LEVELS } from "@/db/schema";
import { ApiError } from "./http";

/** Longest window the radar will look back over. */
export const MAX_SINCE_DAYS = 90;
export const DEFAULT_LIMIT = 30;
export const MAX_LIMIT = 100;

export const SORTS = ["newest", "importance", "trending"] as const;
export type Sort = (typeof SORTS)[number];

/**
 * `since` accepts an ISO instant or a duration shorthand. Returned as an
 * instant so every caller compares the same way.
 */
export function parseSince(raw: string | null, fallback: string, now: Date): Date {
  const value = (raw ?? fallback).trim();
  const duration = /^(\d+)([hd])$/.exec(value);
  if (duration) {
    const n = Number(duration[1]);
    const hours = duration[2] === "h" ? n : n * 24;
    if (n <= 0 || hours > MAX_SINCE_DAYS * 24) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `since must be a positive duration no longer than ${MAX_SINCE_DAYS}d, or an ISO instant`,
      );
    }
    return new Date(now.getTime() - hours * 3_600_000);
  }
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "since must be an ISO instant or a duration such as 24h, 7d or 30d",
    );
  }
  return at;
}

/** A repeatable enum filter. An unknown value is rejected rather than ignored:
 *  silently dropping it would return a set the caller did not ask for. */
function enumList<T extends string>(values: readonly T[], raw: string[], name: string): T[] {
  const allowed = new Set<string>(values);
  for (const v of raw) {
    if (!allowed.has(v)) {
      throw new ApiError("VALIDATION_ERROR", `${name} must be one of ${values.join(", ")}`);
    }
  }
  return [...new Set(raw)] as T[];
}

export interface RadarFilters {
  type: (typeof CONTENT_TYPES)[number][];
  topic: string[];
  source: string[];
  verification: (typeof VERIFICATION_LEVELS)[number][];
  since: Date;
  sinceRaw: string;
  /**
   * Whether to include adjacent tech — stories kept deliberately that never
   * used AI vocabulary. False is the front door: the app is an AI radar.
   */
  includeAdjacent: boolean;
}

export function parseFilters(
  params: URLSearchParams,
  now: Date,
  defaultSince: string,
): RadarFilters {
  const sinceRaw = (params.get("since") ?? defaultSince).trim();
  return {
    type: enumList(CONTENT_TYPES, params.getAll("type"), "type"),
    // Topic and source keys are validated against the database by the caller,
    // which is the only place that knows what exists.
    topic: [
      ...new Set(
        params
          .getAll("topic")
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ],
    source: [
      ...new Set(
        params
          .getAll("source")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ],
    verification: enumList(VERIFICATION_LEVELS, params.getAll("verification"), "verification"),
    since: parseSince(params.get("since"), defaultSince, now),
    sinceRaw,
    includeAdjacent: parseView(params.get("view")),
  };
}

const VIEWS = ["ai", "everything"] as const;

/**
 * Which view the reader asked for, as a boolean the query can use.
 *
 * ABSENT and UNRECOGNISED are different answers and are treated differently,
 * which is the same distinction enumList makes two functions above: no ?view=
 * means the caller expressed no preference and gets the front door, while
 * ?view=evrything is a typo and is told so rather than silently served
 * something it did not ask for.
 *
 * Refusing is the strict form of "an unknown value must never widen": nothing
 * is opened at all. An earlier version of this narrowed silently, which was
 * safe and was still the odd one out — every other enum parameter in this file
 * throws VALIDATION_ERROR, and a new convention two lines from an existing one
 * is how the next reader learns the wrong rule.
 */
function parseView(raw: string | null): boolean {
  if (raw === null) return false;
  if (!(VIEWS as readonly string[]).includes(raw)) {
    throw new ApiError("VALIDATION_ERROR", `view must be one of ${VIEWS.join(", ")}`);
  }
  return raw === "everything";
}

export function parseSort(params: URLSearchParams): Sort {
  const raw = params.get("sort");
  if (raw === null) return "newest";
  if (!(SORTS as readonly string[]).includes(raw)) {
    throw new ApiError("VALIDATION_ERROR", `sort must be one of ${SORTS.join(", ")}`);
  }
  return raw as Sort;
}

export function parseLimit(params: URLSearchParams): number {
  const raw = params.get("limit");
  if (raw === null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `limit must be a whole number between 1 and ${MAX_LIMIT}`,
    );
  }
  return n;
}

/**
 * A cursor carries the sort key and the story id of the last row.
 *
 * Opaque on purpose, and validated on the way back in: a hand-edited cursor
 * must be a clear rejection rather than a confusing page, and it must never
 * become a way to inject a value into a query.
 */
export interface Cursor {
  k: string | number;
  i: number;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

const cursorSchema = z.object({
  k: z.union([z.string(), z.number()]),
  i: z.number().int().nonnegative(),
});

export function parseCursor(params: URLSearchParams): Cursor | null {
  const raw = params.get("cursor");
  if (!raw) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("VALIDATION_ERROR", "cursor is not a cursor this API issued");
  }
  const parsed = cursorSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_ERROR", "cursor is not a cursor this API issued");
  }
  return parsed.data;
}

export const sourceTierSchema = z.enum(SOURCE_TIERS);
