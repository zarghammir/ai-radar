"use client";

import { useState, useSyncExternalStore } from "react";
import { RadarRow } from "@/components/radar/radar-row";
import { getRadar } from "@/lib/api/client";
import { getReaderState, getServerReaderState, subscribeReaderState } from "@/lib/api/local-state";
import { radarApiParams, type RadarQuery } from "@/lib/api/radar-query";
import type { StoryCard } from "@/lib/api/types";

/**
 * The feed, plus the one button that grows it.
 *
 * A BUTTON AND NEVER INFINITE SCROLL, per #14. Auto-loading a firehose takes
 * the end of the page away from the reader: there is no bottom, no footer, and
 * no way to tell "I have seen everything since Tuesday" from "it is still
 * fetching". The button is also the only honest place to report a failed
 * fetch, which an observer silently retrying is not.
 *
 * The reader's saved and hidden state is applied HERE for the same reason
 * BriefList applies it there — the server cannot know it, and the store
 * returns the same empty value on the server and on the first client render so
 * hydration matches.
 */
export function RadarFeed({
  query,
  initial,
  initialCursor,
  initialHasMore,
}: {
  query: RadarQuery;
  initial: StoryCard[];
  initialCursor: string | null;
  initialHasMore: boolean;
}) {
  const reader = useSyncExternalStore(subscribeReaderState, getReaderState, getServerReaderState);
  const [loaded, setLoaded] = useState<StoryCard[]>([]);
  const [cursor, setCursor] = useState(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Later pages are appended to the SERVER's page rather than replacing it, and
  // the key is the story id, so a story that arrives between two requests
  // cannot be rendered twice.
  const seen = new Set<number>();
  const visible: StoryCard[] = [];
  for (const story of [...initial, ...loaded]) {
    if (reader.hidden.has(story.id) || seen.has(story.id)) continue;
    seen.add(story.id);
    visible.push({ ...story, saved: story.saved || reader.saved.has(story.id) });
  }

  async function loadMore() {
    if (loading || !cursor) return;
    setLoading(true);
    setError(null);
    try {
      const next = await getRadar(radarApiParams(query, cursor));
      setLoaded((before) => [...before, ...next.stories]);
      setCursor(next.nextCursor);
      setHasMore(next.hasMore);
    } catch {
      // The rows already on screen stay. A failed second page is not a reason
      // to take the first one away.
      setError("Could not load more stories. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div data-radar-count={visible.length} className="border-edge mr-4 border-t lg:mr-0">
        {visible.map((story) => (
          <RadarRow key={story.id} story={story} />
        ))}
      </div>

      {hasMore ? (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="focus-visible:ring-org border-edge text-ash hover:text-ash-hi rounded-xs border px-4 py-2.5 text-[14px] font-bold focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
          <span role="status" aria-live="polite" className="text-[12.5px]">
            {error ? <span className="text-destructive font-semibold">{error}</span> : null}
          </span>
        </div>
      ) : (
        // THE END OF THE FEED, SAID OUT LOUD. Without this the last row and a
        // failed page look identical from the bottom of the screen.
        <p className="text-ash mt-4 text-[12.5px]">That is everything in this window.</p>
      )}
    </div>
  );
}
