import { getDb } from "@/db/client";
import { buildDetail, type StoryDetail } from "@/api/stories";
import { USING_FIXTURES } from "@/lib/api/client";
import { fixtureStory } from "@/lib/api/fixtures";

/**
 * How the story page gets one story, ON THE SERVER.
 *
 * Same shape and same reason as loadBrief: it calls the function the route
 * calls rather than fetching its own API over HTTP, so the page and
 * `GET /api/stories/:slug` cannot disagree about what a story is. A server
 * component fetching a relative URL has no base and throws, which once made a
 * working API look like an unreachable database.
 */
export async function loadStory(slug: string): Promise<StoryDetail | null> {
  if (USING_FIXTURES) return fixtureStory(slug);
  return buildDetail(getDb(), slug);
}
