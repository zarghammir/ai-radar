"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { EmptyState, PageShell } from "@/components/page-shell";
import { ARCHIVE_NOTE_ID, SavedCardView } from "@/components/saved/saved-card";
import {
  getSavedSnapshot,
  getServerSavedSnapshot,
  patchSavedStory,
  refreshSaved,
  removeSavedStory,
  subscribeSaved,
} from "@/lib/api/saved-store";
import type { SavedCard } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * The four things this screen can be, named in the DOM as data-screen-state.
 *
 * "empty" and "unreachable" are DIFFERENT ANSWERS and the reader is told which
 * one they are looking at: nothing saved yet is a fact about them, while a
 * store that cannot be read is a fact about the app. Collapsing the second into
 * the first tells someone their notes are gone when they are merely out of
 * reach — the worst version of this product's recurring defect.
 *
 * "loading" is named too, so a test cannot pass by catching the screen before
 * its data arrives and calling that empty.
 */
type ScreenState = "loading" | "list" | "empty" | "unreachable";

/**
 * NO FOURTH STATE. An id this device cannot turn into a story is the screen's
 * EXISTING "unreachable" — the store answered, and what it holds for that id
 * cannot be read. It is not "empty", which is a fact about the reader.
 *
 * The count is published as `data-unresolved` beside `data-screen-state` so a
 * check can assert the CASE rather than the prose, the way `data-empty-reason`
 * does on Today. Asserting the sentence would pin the wording and miss the
 * thing that matters.
 */

/** No point offering a filter until there is more than one tag to pick. */
const MIN_TAGS_FOR_FILTER = 2;

/** One shared empty array, so "not ready yet" is the SAME reference on every
 *  render and the memos below do not recompute for nothing. */
const NO_STORIES: SavedCard[] = [];

export function SavedScreen() {
  const saved = useSyncExternalStore(subscribeSaved, getSavedSnapshot, getServerSavedSnapshot);
  const [tag, setTag] = useState<string | null>(null);

  const stories = saved.kind === "ready" ? saved.stories : NO_STORIES;
  const unresolved = saved.kind === "ready" ? saved.unresolved : 0;
  const state: ScreenState =
    saved.kind === "failed"
      ? "unreachable"
      : saved.kind === "loading"
        ? "loading"
        : stories.length === 0
          ? // NOTHING RENDERABLE. If the device is holding saved ids it cannot
            // resolve, this is unreachable and NOT empty: telling a reader who
            // just pressed Save that they have saved nothing is the defect.
            unresolved > 0
            ? "unreachable"
            : "empty"
          : "list";

  const tags = useMemo(() => {
    const all = new Set<string>();
    for (const story of stories) for (const t of story.tags) all.add(t);
    return [...all].sort((a, b) => a.localeCompare(b));
  }, [stories]);

  const visible = useMemo(
    () => (tag === null ? stories : stories.filter((s) => s.tags.includes(tag))),
    [stories, tag],
  );

  const unread = stories.filter((s) => !s.read).length;

  return (
    <PageShell
      eyebrow="The bin"
      title="Saved"
      summary={summaryFor(state, stories.length, unread, tag, visible.length)}
      controls={
        tags.length >= MIN_TAGS_FOR_FILTER ? (
          <TagFilter tags={tags} active={tag} onChange={setTag} />
        ) : null
      }
    >
      <div data-screen-state={state} data-unresolved={unresolved}>
        {state === "loading" ? (
          // A real state with its own words. A blank panel and an empty bin
          // look identical for as long as the read takes.
          <p role="status" className="text-ash text-[14px]">
            Fetching what you have saved…
          </p>
        ) : null}

        {state === "unreachable" ? (
          <div className="border-edge text-ash border border-dashed p-6">
            <p className="text-ash-hi text-[15px] font-semibold">
              {unresolved > 0
                ? unresolved === 1
                  ? "1 saved story could not be read"
                  : `${unresolved} saved stories could not be read`
                : "Cannot reach your saved stories"}
            </p>
            <p className="mt-2 max-w-prose text-[14px] leading-relaxed">
              {unresolved > 0
                ? "This device still has the save, but not the copy of the story that goes with it — so there is nothing to draw here. Pressing Save on it again will restore it."
                : "Nothing has been lost. The app could not read the store just now, and your notes and tags are where you left them."}
            </p>
            {/* ONLY WHEN RE-READING IS THE REMEDY. A store that could not be
                read may read fine a moment later. An id with no card will
                resolve the same way every time, so offering "Try again" there
                would be a button that cannot work — the copy above names the
                thing that does. */}
            {unresolved > 0 ? null : (
              <button
                type="button"
                onClick={refreshSaved}
                className="focus-visible:ring-org border-edge text-ash-hi hover:bg-bench-2 mt-4 border px-3 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none"
              >
                Try again
              </button>
            )}
          </div>
        ) : null}

        {state === "empty" ? (
          <EmptyState
            title="Nothing saved"
            body="Open a story and press Save, and it hangs here until you take it down. Saved stories keep their grade and their link to the original, and you can put a note on any of them."
          />
        ) : null}

        {state === "list" && visible.length === 0 ? (
          <EmptyState
            title={`Nothing tagged \u201C${tag}\u201D`}
            body="Every story carrying that tag has since been removed. Clear the filter to see the rest of what you have saved."
          />
        ) : null}

        {/* Said ONCE for the whole list, and every Archive button points at it
            through aria-describedby. It used to be repeated inside every card,
            which is the same sentence twenty times on a full bin. */}
        {state === "list" && unresolved > 0 ? (
          <p
            role="status"
            className="border-edge text-ash-hi mb-3 border border-dashed p-3 text-[13px]"
          >
            {unresolved === 1
              ? "1 more saved story could not be read and is not shown below."
              : `${unresolved} more saved stories could not be read and are not shown below.`}
          </p>
        ) : null}

        {state === "list" ? (
          <p id={ARCHIVE_NOTE_ID} className="text-ash mb-3 text-[12.5px]">
            Archiving is not built yet, so that button is off. Remove takes a story off this list
            for good.
          </p>
        ) : null}

        {state === "list"
          ? visible.map((story, index) => (
              <SavedCardView
                key={story.id}
                story={story}
                rank={index + 1}
                onPatch={patchSavedStory}
                onRemove={removeSavedStory}
              />
            ))
          : null}
      </div>
    </PageShell>
  );
}

function summaryFor(
  state: ScreenState,
  total: number,
  unread: number,
  tag: string | null,
  shown: number,
) {
  if (state !== "list") return null;
  const parts = [total === 1 ? "1 story" : `${total} stories`];
  if (unread > 0) parts.push(`${unread} unread`);
  if (tag !== null) parts.push(`${shown} tagged “${tag}”`);
  return <span className="tabular-nums">{parts.join(" · ")}</span>;
}

/**
 * The tags the reader has actually used, as a filter.
 *
 * role="radiogroup" promises the ARIA radio pattern — one tab stop for the
 * group and arrow keys within it — so the keys are implemented. Declaring the
 * role without them is worse than plain buttons: a screen reader announces
 * "All, 1 of 4" and the keys the reader then reaches for do nothing.
 */
function TagFilter({
  tags,
  active,
  onChange,
}: {
  tags: string[];
  active: string | null;
  onChange: (tag: string | null) => void;
}) {
  const options: { value: string | null; label: string }[] = [
    { value: null, label: "All" },
    ...tags.map((t) => ({ value: t, label: t })),
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === active),
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = options.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = index === last ? 0 : index + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = index === 0 ? last : index - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    }
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Filter by tag" className="mt-4 flex flex-wrap gap-1.5">
      {options.map((option, index) => (
        <button
          key={option.value ?? "__all"}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === active}
          tabIndex={index === selected ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className={cn(
            // --org marks WHERE YOU ARE, which is what the chosen filter is.
            // Palette law one, same as the reading-length control on Today.
            "focus-visible:ring-org rounded-xs border px-2.5 py-1.5 text-[12.5px] font-semibold focus-visible:ring-2 focus-visible:outline-none",
            option.value === active
              ? "bg-org border-org text-org-on"
              : "border-edge text-ash hover:text-ash-hi",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
