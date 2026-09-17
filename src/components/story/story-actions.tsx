"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck, EyeOff, Share2 } from "lucide-react";
import { setHidden, setSaved } from "@/lib/api/client";
import { applyOptimistic } from "@/lib/api/local-state";
import type { StoryCard } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Save, Share and Hide. Open is the headline link itself, not a fourth button.
 *
 * Save and Hide apply OPTIMISTICALLY and roll back if the write throws, so the
 * interface never keeps claiming something that did not happen — and the reader
 * is told, rather than left with a button that silently snapped back.
 */
export function StoryActions({ story }: { story: StoryCard }) {
  const [error, setError] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);

  async function toggle(kind: "saved" | "hidden", next: boolean) {
    setError(null);
    const rollback = applyOptimistic(kind, story.id, next);
    try {
      if (kind === "saved") await setSaved(story, next);
      else await setHidden(story, next);
    } catch {
      rollback();
      setError(kind === "saved" ? "Could not save that. Try again." : "Could not hide that.");
    }
  }

  async function share() {
    setError(null);
    const payload = { title: story.title, url: story.url };
    // Web Share where it exists, clipboard everywhere else. A reader dismissing
    // the share sheet REJECTS, and that is a choice, not a failure — reporting
    // it as an error would be the product calling a decision a fault.
    const nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator;
    if (nav && typeof nav.share === "function") {
      try {
        await nav.share(payload);
      } catch {
        // Dismissed, or the platform refused. Either way, say nothing.
      }
      return;
    }
    try {
      if (!nav?.clipboard) throw new Error("no clipboard");
      await nav.clipboard.writeText(story.url);
      setShareNote("Link copied");
      window.setTimeout(() => setShareNote(null), 2000);
    } catch {
      setError("Could not copy the link.");
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => toggle("saved", !story.saved)}
        aria-pressed={story.saved}
        className={cn(
          "focus-visible:ring-org border-faint-2 flex items-center gap-1.5 rounded-xs border px-2.5 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none",
          story.saved ? "bg-ink text-paper border-ink" : "text-soft hover:bg-faint",
        )}
      >
        {story.saved ? (
          <BookmarkCheck aria-hidden className="size-4" />
        ) : (
          <Bookmark aria-hidden className="size-4" />
        )}
        {story.saved ? "Saved" : "Save"}
      </button>

      <button
        type="button"
        onClick={share}
        className="focus-visible:ring-org border-faint-2 text-soft hover:bg-faint flex items-center gap-1.5 rounded-xs border px-2.5 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none"
      >
        <Share2 aria-hidden className="size-4" />
        Share
      </button>

      <button
        type="button"
        onClick={() => toggle("hidden", true)}
        className="focus-visible:ring-org border-faint-2 text-soft hover:bg-faint flex items-center gap-1.5 rounded-xs border px-2.5 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none"
      >
        <EyeOff aria-hidden className="size-4" />
        Hide
      </button>

      {/* Both live in an aria-live region: a change the reader cannot see
          announced is a change that did not happen, as far as they know. */}
      <span role="status" aria-live="polite" className="text-[12.5px]">
        {error ? <span className="text-destructive font-semibold">{error}</span> : null}
        {shareNote ? <span className="text-soft">{shareNote}</span> : null}
      </span>
    </div>
  );
}
