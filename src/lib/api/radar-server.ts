import { getDb } from "@/db/client";
import { DEFAULT_LIMIT, parseSince } from "@/api/params";
import { radarPage, unknownKeys } from "@/api/radar";
import { USING_FIXTURES } from "@/lib/api/client";
import { fixtureRadar } from "@/lib/api/fixtures";
import { KIND_TYPES, type RadarQuery } from "@/lib/api/radar-query";
import type { StoryCard } from "@/lib/api/types";

export interface RadarFeed {
  stories: StoryCard[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Keys in the URL that name nothing this installation has. Reported rather
   *  than thrown: the feed is still worth showing, and the screen can say
   *  which filter is doing nothing instead of leaving a reader to wonder why
   *  their link returns fewer stories than they remember. */
  unknown: string[];
}

/**
 * How the Radar page gets its first page, ON THE SERVER.
 *
 * It reads the database directly through the same functions /api/radar calls,
 * for the reason loadBrief does: a server component fetching its own route
 * over a relative URL has no base and throws, and even when it works it is a
 * round trip through the process it is already inside. The route stays the
 * path for "load more", which runs in the browser where a relative URL means
 * something.
 */
export async function loadRadar(query: RadarQuery, now = new Date()): Promise<RadarFeed> {
  const types = KIND_TYPES[query.kind];
  if (USING_FIXTURES) return { ...fixtureRadar(types, query.sort), unknown: [] };

  const db = getDb();

  // A topic or source key that does not exist would otherwise filter the feed
  // down to nothing and look like a quiet week.
  const unknown: string[] = [];
  for (const kind of ["topic", "source"] as const) {
    unknown.push(...(await unknownKeys(db, kind, query[kind])));
  }

  const page = await radarPage(
    db,
    {
      type: [...types],
      topic: query.topic.filter((key) => !unknown.includes(key)),
      source: query.source.filter((key) => !unknown.includes(key)),
      verification: query.verification,
      since: parseSince(query.range, query.range, now),
      sinceRaw: query.range,
      // The front door is AI; the Scope control on this screen is how a
      // reader leaves it, and this is the only place that widening happens.
      includeAdjacent: query.view === "everything",
    },
    query.sort,
    DEFAULT_LIMIT,
    null,
    now,
  );

  return {
    stories: page.stories as unknown as StoryCard[],
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    unknown,
  };
}
