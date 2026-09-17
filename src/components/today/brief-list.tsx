"use client";

import { useSyncExternalStore } from "react";
import { StoryCardView } from "@/components/story/story-card";
import { getReaderState, getServerReaderState, subscribeReaderState } from "@/lib/api/local-state";
import type { StoryCard } from "@/lib/api/types";

/**
 * The reader's own saved and hidden state is applied here, not on the server,
 * because the server cannot know it. `getServerReaderState` returns the same
 * empty value every time, so the server render and the first client render
 * agree and the real state arrives on subscribe without a hydration mismatch.
 */
export function BriefList({ stories }: { stories: StoryCard[] }) {
  const reader = useSyncExternalStore(subscribeReaderState, getReaderState, getServerReaderState);

  const visible = stories
    .filter((s) => !reader.hidden.has(s.id))
    .map((s) => ({ ...s, saved: s.saved || reader.saved.has(s.id) }));

  if (visible.length === 0) {
    return (
      <div className="border-edge text-ash ml-rail mr-4 border border-dashed p-6 lg:mr-0">
        <p className="text-ash-hi text-[15px] font-semibold">Nothing left in this brief</p>
        <p className="mt-2 max-w-prose text-[14px] leading-relaxed">
          You have hidden everything in it. Hidden stories are not deleted — they are skipped in
          lists and still reachable by their own link.
        </p>
      </div>
    );
  }

  return (
    <div>
      {visible.map((story, index) => (
        <StoryCardView key={story.id} story={story} rank={index + 1} lead={index === 0} />
      ))}
    </div>
  );
}
