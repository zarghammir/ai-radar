import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sources, stories } from "@/db/schema";
import { loadBrief } from "@/lib/api/brief-server";

/**
 * The figures the landing page prints about itself.
 *
 * EVERY ONE OF THEM IS READ, NOT TYPED. The mock said why: "those four numbers
 * are real and checkable today … if any stops being true the page is wrong, so
 * they should come from the app rather than be typed here." A landing page is
 * the one surface nobody on the team looks at twice, so a number typed into it
 * is a claim that goes stale silently and is read by strangers.
 *
 * NULL MEANS "WE DO NOT KNOW", AND IT IS NOT ZERO. An unreachable database and
 * an empty one are different facts, and the page renders them differently: a
 * figure it knows gets a tile, a figure it does not know gets no tile at all.
 * The alternative — printing "0 sources" to a stranger because Neon was asleep
 * — is the worst sentence this page could say, and it is the one a `?? 0`
 * would have produced.
 */
export type AboutFacts = {
  /** Sources the collector is currently allowed to fetch. */
  sources: number | null;
  /** Stories touched in the last seven days: proof the thing is running. */
  storiesThisWeek: number | null;
  /** When any source last came back with something, as an ISO string. */
  lastCollectedAt: string | null;
  /**
   * The top of the feed, right now. Empty when it could not be read.
   *
   * A LANDING PAGE FOR A FEED SHOULD SHOW THE FEED. The alternative was a
   * screenshot, and a screenshot committed to a repository is a claim that
   * stops being true the week after it is taken, with nothing in the tree to
   * notice. These headlines cannot go stale: they ARE the product, read through
   * `loadBrief` — the same function the app's own page calls, so the pitch and
   * the thing it is pitching cannot disagree about what is on it today.
   */
  topStories: { slug: string; title: string; source: string }[];
};

const EMPTY: AboutFacts = {
  sources: null,
  storiesThisWeek: null,
  lastCollectedAt: null,
  topStories: [],
};

export async function loadAboutFacts(): Promise<AboutFacts> {
  try {
    const db = getDb();
    const [counts] = await db
      .select({
        enabled: sql<number>`count(*) filter (where ${sources.enabled})::int`,
        lastCollectedAt: sql<Date | null>`max(${sources.lastFetchedAt})`,
      })
      .from(sources);

    const [recent] = await db
      .select({
        // Seven days rather than "all time", because an all-time count only
        // ever grows and would keep looking healthy for months after the
        // collector stopped. This one falls to zero within a week.
        week: sql<number>`count(*) filter (where ${stories.lastActivityAt} >= now() - interval '7 days')::int`,
      })
      .from(stories);

    const brief = await loadBrief("5");

    return {
      sources: counts ? Number(counts.enabled) : null,
      storiesThisWeek: recent ? Number(recent.week) : null,
      lastCollectedAt: counts?.lastCollectedAt
        ? new Date(counts.lastCollectedAt).toISOString()
        : null,
      // Three, not five: enough to show what the thing is without turning the
      // landing page into a second feed that then has to be maintained.
      topStories: brief.stories.slice(0, 3).map((story) => ({
        slug: story.slug,
        title: story.title,
        source: story.primarySource.name,
      })),
    };
  } catch (error) {
    // Logged, never rendered. The driver's message carries the failed SQL and
    // can carry the host and credentials out of DATABASE_URL onto a page a
    // stranger is reading. Same answer every other surface in this app gives.
    console.error("[about] could not read the figures", error);
    return EMPTY;
  }
}
