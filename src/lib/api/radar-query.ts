import { CONTENT_TYPES } from "@/db/schema";
import type { ContentType, VerificationLevel } from "@/lib/api/types";

/**
 * What the Radar screen asks for, in one place, so the page, the chips and the
 * "load more" fetch cannot disagree about what the URL means.
 *
 * The query IS the URL. Every control is a link that rewrites it, so a filtered
 * feed can be reloaded, bookmarked and pasted to someone else — the requirement
 * in #14 and the reason none of this lives in React state.
 */

export const RADAR_KINDS = ["all", "news", "research", "models", "releases", "community"] as const;
export type RadarKind = (typeof RADAR_KINDS)[number];

/**
 * A chip is a GROUP of content types, not one of them, and the map is total
 * over CONTENT_TYPES rather than a convenient subset. Ten types and six chips
 * means any type left out of this map would be reachable only through "All" —
 * present in the feed, absent from every filter, which reads to a reader as
 * the filter being broken. The test asserts the union, so adding a type to the
 * database without placing it here fails there rather than on the screen.
 *
 * "All" carries an empty list because the API's `type` filter is "no filter
 * when empty". It is the absence of a constraint, not a list of everything.
 */
export const KIND_TYPES: Record<RadarKind, readonly ContentType[]> = {
  all: [],
  news: ["NEWS", "BUSINESS", "REGULATION"],
  research: ["RESEARCH", "PAPER"],
  models: ["MODEL"],
  releases: ["RELEASE", "TOOL"],
  community: ["DISCUSSION", "TREND"],
};

export const KIND_LABELS: Record<RadarKind, string> = {
  all: "All",
  news: "News",
  research: "Research",
  models: "Models",
  releases: "Releases",
  community: "Community",
};

/** Every content type the chips can reach. Exported for the coverage test. */
export const ALL_RADAR_TYPES = CONTENT_TYPES;

export const RADAR_SORTS = ["newest", "importance", "trending"] as const;
export type RadarSort = (typeof RADAR_SORTS)[number];

export const SORT_LABELS: Record<RadarSort, string> = {
  newest: "Newest",
  importance: "Importance",
  trending: "Trending",
};

export const RADAR_RANGES = ["24h", "7d", "30d"] as const;
export type RadarRange = (typeof RADAR_RANGES)[number];

export const RANGE_LABELS: Record<RadarRange, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

export const DEFAULT_RADAR_QUERY: RadarQuery = {
  kind: "all",
  sort: "newest",
  range: "7d",
  topic: [],
  source: [],
  verification: [],
};

export interface RadarQuery {
  kind: RadarKind;
  sort: RadarSort;
  range: RadarRange;
  /** Carried through from the URL. There is no control for these yet — the
   *  filter sheet is still to come — but a link that names them must keep
   *  working, and the screen has to say they are applied. */
  topic: string[];
  source: string[];
  verification: VerificationLevel[];
}

type Raw = string | string[] | undefined;

function first(value: Raw): string | null {
  const one = Array.isArray(value) ? value[0] : value;
  return one === undefined ? null : one.trim();
}

function list(value: Raw): string[] {
  const all = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return [...new Set(all.map((v) => v.trim()).filter(Boolean))];
}

function member<T extends string>(values: readonly T[], raw: string | null): T | null {
  return raw !== null && (values as readonly string[]).includes(raw) ? (raw as T) : null;
}

/**
 * The URL, read.
 *
 * UNRECOGNISED FALLS BACK HERE, and throws in the API — deliberately, not by
 * oversight. `/api/radar?sort=newst` is a caller with a bug and is told so.
 * A READER holding a hand-edited or stale link is not debugging anything: the
 * useful answer is the feed, with the chips showing plainly which filter is
 * actually in force, rather than an error page in place of a screen that works.
 * Nothing is widened by the fallback — every default is the front door.
 */
export function parseRadarQuery(params: Record<string, Raw>): RadarQuery {
  return {
    kind: member(RADAR_KINDS, first(params.kind)) ?? DEFAULT_RADAR_QUERY.kind,
    sort: member(RADAR_SORTS, first(params.sort)) ?? DEFAULT_RADAR_QUERY.sort,
    range: member(RADAR_RANGES, first(params.range)) ?? DEFAULT_RADAR_QUERY.range,
    topic: list(params.topic),
    source: list(params.source),
    verification: list(params.verification) as VerificationLevel[],
  };
}

/**
 * The query, written back out — as the page's own links and as the query
 * string "load more" sends to /api/radar. One function for both, so the second
 * page cannot be a different feed from the first.
 *
 * `type` is expanded from the chip rather than sent as `kind`, because the API
 * speaks content types and knows nothing about the groups this screen draws.
 */
export function radarSearchParams(query: RadarQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.kind !== DEFAULT_RADAR_QUERY.kind) params.set("kind", query.kind);
  if (query.sort !== DEFAULT_RADAR_QUERY.sort) params.set("sort", query.sort);
  if (query.range !== DEFAULT_RADAR_QUERY.range) params.set("range", query.range);
  for (const topic of query.topic) params.append("topic", topic);
  for (const source of query.source) params.append("source", source);
  for (const level of query.verification) params.append("verification", level);
  return params;
}

/** The same query as the API speaks it: groups expanded, range named `since`. */
export function radarApiParams(query: RadarQuery, cursor: string | null): URLSearchParams {
  const params = new URLSearchParams();
  for (const type of KIND_TYPES[query.kind]) params.append("type", type);
  for (const topic of query.topic) params.append("topic", topic);
  for (const source of query.source) params.append("source", source);
  for (const level of query.verification) params.append("verification", level);
  params.set("sort", query.sort);
  params.set("since", query.range);
  if (cursor) params.set("cursor", cursor);
  return params;
}

/** A link to this screen with one field changed. */
export function radarHref(query: RadarQuery, change: Partial<RadarQuery>): string {
  const params = radarSearchParams({ ...query, ...change });
  const search = params.toString();
  return search ? `/radar?${search}` : "/radar";
}

/** Whether anything beyond the chips is narrowing the feed, so the screen can
 *  say so and offer a way out. */
export function extraFilterCount(query: RadarQuery): number {
  return query.topic.length + query.source.length + query.verification.length;
}
