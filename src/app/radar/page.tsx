import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageShell } from "@/components/page-shell";
import { RadarControls } from "@/components/radar/radar-controls";
import { RadarFeed } from "@/components/radar/radar-feed";
import { loadRadar } from "@/lib/api/radar-server";
import {
  KIND_LABELS,
  RANGE_LABELS,
  extraFilterCount,
  parseRadarQuery,
  radarHref,
} from "@/lib/api/radar-query";

export const metadata: Metadata = { title: "Live Radar" };

/**
 * EVERYTHING THAT ARRIVED, newest first — the counterpart to Today.
 *
 * This screen used to say "not built yet", which was true and was the last
 * place in the app where the owner's own question — "where is the rest of it?"
 * — had no answer. /api/radar had been answering with the stories since #33;
 * only the page was missing. It is here now: the same feed, through the same
 * functions the route calls.
 *
 * THE FIRST PAGE IS RENDERED ON THE SERVER, not fetched by the browser. A
 * server component that fetches its own route over a relative URL has no base
 * and throws — the defect #65 found on Today — and the reader would watch an
 * empty screen while a round trip happens inside the process that already has
 * the answer. "Load more" runs in the browser, where a relative URL means
 * something, and is the only part of this screen that touches the network.
 *
 * THREE STATES AND NONE OF THEM MAY LOOK ALIKE, the rule Today set:
 *   stories        — the feed
 *   none in window — nothing arrived, or the filters exclude everything
 *   the read threw — we could not reach the stories at all
 * An empty database and an unreachable one both produce zero rows if you only
 * count an array; they are not the same fact, and the second one is not the
 * reader's fault to fix.
 */
export default async function RadarPage({ searchParams }: PageProps<"/radar">) {
  const query = parseRadarQuery(await searchParams);

  let feed: Awaited<ReturnType<typeof loadRadar>> | null = null;
  try {
    feed = await loadRadar(query);
  } catch (error) {
    // Logged, never rendered: the driver's message carries the failed SQL and
    // can carry the host and credentials out of DATABASE_URL onto a page
    // somebody screenshots. Same answer every surface in this app gives.
    console.error("[radar] could not load the feed", error);
  }

  const controls = <RadarControls query={query} />;
  const eyebrow = "Everything arriving";

  if (!feed) {
    return (
      <PageShell
        eyebrow={eyebrow}
        title="Live Radar"
        summary={<span>The feed is out of reach</span>}
        controls={controls}
        state="unreachable"
      >
        <EmptyState
          title="Cannot reach the feed"
          body={
            "The app is running but it could not read the story database, so this is not " +
            "a quiet week — it is a missing answer. Check that the database is running and " +
            "that DATABASE_URL points at it, then reload. The reason is in the server log."
          }
        />
      </PageShell>
    );
  }

  const narrowed = query.kind !== "all" || extraFilterCount(query) > 0;

  return (
    <PageShell
      eyebrow={eyebrow}
      title="Live Radar"
      summary={
        <span className="tabular-nums">
          {KIND_LABELS[query.kind]} · last {RANGE_LABELS[query.range]}
          {feed.unknown.length
            ? // A FILTER THAT NAMES NOTHING IS SAID OUT LOUD AND THEN IGNORED.
              // Applying it would return an empty feed that looks exactly like
              // a quiet week, and a stale link is the likeliest way to get here.
              ` · ignoring unknown ${feed.unknown.length === 1 ? "filter" : "filters"}: ${feed.unknown.join(", ")}`
            : null}
        </span>
      }
      controls={controls}
      state={feed.stories.length === 0 ? "empty" : "feed"}
    >
      {feed.stories.length === 0 ? (
        <div data-empty-reason={narrowed ? "filtered" : "quiet"}>
          <EmptyState
            title={narrowed ? "Nothing matches these filters" : "Nothing has arrived yet"}
            body={
              narrowed
                ? `No story in the last ${RANGE_LABELS[query.range]} matches this filter. ` +
                  "The feed itself is not empty — widen the window, or choose All, to see what is there."
                : `Nothing has been collected in the last ${RANGE_LABELS[query.range]}. ` +
                  "The collector runs on a schedule; if this stays empty after a sweep, check the source " +
                  "health on Settings rather than this screen."
            }
          />
          {narrowed ? (
            <p className="mt-3 text-[13px]">
              <Link
                href={radarHref(query, { kind: "all", range: "30d" })}
                className="text-ash hover:text-ash-hi focus-visible:ring-org rounded-xs underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
              >
                Show everything from the last 30 days
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <RadarFeed
          query={query}
          initial={feed.stories}
          initialCursor={feed.nextCursor}
          initialHasMore={feed.hasMore}
        />
      )}
    </PageShell>
  );
}
