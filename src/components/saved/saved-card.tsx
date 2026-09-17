"use client";

import { useId, useState } from "react";
import { Archive, BookOpen, BookOpenCheck, Plus, Trash2, X } from "lucide-react";
import { StoryCardView } from "@/components/story/story-card";
import { setRead, setSaved, setSavedMarks } from "@/lib/api/client";
import { NOTE_MAX, TAG_MAX_LENGTH, TAGS_MAX } from "@/lib/api/saved-limits";
import type { SavedCard } from "@/lib/api/types";
import { cn } from "@/lib/utils";

type Status =
  { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string };

export function SavedCardView({
  story,
  rank,
  onPatch,
  onRemove,
}: {
  story: SavedCard;
  rank: number;
  onPatch: (id: number, changes: Partial<SavedCard>) => () => void;
  onRemove: (id: number) => () => void;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  /**
   * Every write goes through here so that no path can change the screen
   * without also being able to put it back. The note and the tags travel
   * TOGETHER on each write because the route replaces both.
   */
  async function write(changes: Partial<SavedCard>, send: () => Promise<void>, failure: string) {
    setStatus({ kind: "saving" });
    const rollback = onPatch(story.id, changes);
    try {
      await send();
      setStatus({ kind: "saved" });
    } catch (error) {
      console.error("saved: write failed", error);
      rollback();
      setStatus({ kind: "failed", message: failure });
    }
  }

  async function saveMarks(next: { note: string | null; tags: string[] }, failure: string) {
    await write(next, () => setSavedMarks(story.id, next), failure);
  }

  async function toggleRead() {
    const next = !story.read;
    await write(
      { read: next },
      () => setRead(story.id, next),
      next ? "Could not mark that read." : "Could not mark that unread.",
    );
  }

  async function removeFromSaved() {
    setStatus({ kind: "saving" });
    const rollback = onRemove(story.id);
    try {
      await setSaved(story, false);
    } catch (error) {
      console.error("saved: could not remove", error);
      rollback();
      setStatus({ kind: "failed", message: "Could not remove that. It is still saved." });
    }
  }

  return (
    <StoryCardView
      story={story}
      rank={rank}
      lead={false}
      actions={
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CardButton onClick={() => void toggleRead()} pressed={story.read}>
            {story.read ? (
              <BookOpenCheck aria-hidden className="size-4" />
            ) : (
              <BookOpen aria-hidden className="size-4" />
            )}
            {story.read ? "Read" : "Mark read"}
          </CardButton>

          {/*
            Archiving has no endpoint behind it yet — issue #70 adds
            POST /api/saved/[storyId]/archive. The control is VISIBLE and
            DISABLED with the reason attached rather than absent, because a
            missing control tells the reader nothing, and rather than wired to
            browser storage, because a reader-local archive would disagree with
            the server the moment they open this on a second device. A button
            that lies quietly is worse than one that arrives a week late.
          */}
          <CardButton disabled aria-describedby={`archive-note-${story.id}`}>
            <Archive aria-hidden className="size-4" />
            Archive
          </CardButton>

          <CardButton onClick={() => void removeFromSaved()}>
            <Trash2 aria-hidden className="size-4" />
            Remove
          </CardButton>

          <span role="status" aria-live="polite" className="text-[12.5px]">
            {status.kind === "saving" ? <span className="text-meta">Saving…</span> : null}
            {status.kind === "saved" ? <span className="text-meta">Saved</span> : null}
            {status.kind === "failed" ? (
              <span className="text-destructive font-semibold">{status.message}</span>
            ) : null}
          </span>
        </div>
      }
      footer={
        <div className="border-faint border-t pt-3">
          <p id={`archive-note-${story.id}`} className="text-meta mb-3 text-[12.5px]">
            Archiving is not built yet. Remove takes a story off this list for good.
          </p>
          <NoteEditor
            note={story.note}
            onSave={(note) => saveMarks({ note, tags: story.tags }, "Could not save that note.")}
          />
          <TagEditor
            tags={story.tags}
            onChange={(tags) => saveMarks({ note: story.note, tags }, "Could not save those tags.")}
          />
          {story.savedAt ? (
            <p className="text-meta mt-3 font-mono text-[10.5px] tabular-nums">
              Saved {new Date(story.savedAt).toLocaleDateString()}
            </p>
          ) : null}
        </div>
      }
    />
  );
}

function CardButton({
  children,
  onClick,
  pressed,
  disabled,
  ...rest
}: {
  children: React.ReactNode;
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
} & React.ComponentPropsWithoutRef<"button">) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={cn(
        "focus-visible:ring-org border-faint-2 flex items-center gap-1.5 rounded-xs border px-2.5 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none",
        pressed ? "bg-ink text-paper border-ink" : "text-soft hover:bg-faint",
        // Disabled stays legible: a control the reader cannot use still has to
        // be readable, or the explanation attached to it is unreachable.
        disabled ? "border-faint text-meta cursor-not-allowed hover:bg-transparent" : null,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * The reader's note. An explicit Save, not save-on-blur: blur fires when a
 * finger brushes the screen, and a write nobody asked for is a write nobody
 * checks. Cancel restores what was there.
 */
function NoteEditor({
  note,
  onSave,
}: {
  note: string | null;
  onSave: (note: string | null) => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const value = draft ?? note ?? "";
  const tooLong = value.length > NOTE_MAX;

  if (!editing) {
    return (
      <div>
        {note ? (
          <p className="text-ink text-[14px] leading-relaxed whitespace-pre-wrap">{note}</p>
        ) : null}
        <button
          type="button"
          onClick={() => setDraft(note ?? "")}
          className="focus-visible:ring-org text-soft hover:text-ink mt-1 text-[13px] font-semibold underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        >
          {note ? "Edit note" : "Add a note"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor={id}
        className="font-label text-soft block text-[10.5px] font-bold tracking-[0.18em] uppercase"
      >
        Your note
      </label>
      <textarea
        id={id}
        rows={3}
        value={value}
        onChange={(event) => setDraft(event.target.value)}
        className="border-faint-2 bg-paper text-ink focus-visible:ring-org mt-1 w-full border p-2 text-[14px] leading-relaxed focus-visible:ring-2 focus-visible:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={tooLong}
          onClick={() => {
            const trimmed = value.trim();
            setDraft(null);
            // An empty note is stored as nothing, not as an empty string: one
            // absence, not two that render the same and compare differently.
            void onSave(trimmed.length === 0 ? null : trimmed);
          }}
          className="focus-visible:ring-org bg-ink text-paper border-ink rounded-xs border px-2.5 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          Save note
        </button>
        <button
          type="button"
          onClick={() => setDraft(null)}
          className="focus-visible:ring-org border-faint-2 text-soft hover:bg-faint rounded-xs border px-2.5 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none"
        >
          Cancel
        </button>
        {tooLong ? (
          <span className="text-destructive text-[12.5px] font-semibold">
            {value.length} characters. The most a note can hold is {NOTE_MAX}.
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Tags, with the route's limits enforced here so the reason is visible. */
function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function add() {
    const tag = draft.trim();
    setProblem(null);
    if (tag.length === 0) return;
    if (tag.length > TAG_MAX_LENGTH) {
      setProblem(`A tag can be ${TAG_MAX_LENGTH} characters at most.`);
      return;
    }
    if (tags.includes(tag)) {
      // Not an error, and not a silent no-op either: the reader typed
      // something and is owed an answer about where it went.
      setProblem(`Already tagged “${tag}”.`);
      setDraft("");
      return;
    }
    if (tags.length >= TAGS_MAX) {
      setProblem(`${TAGS_MAX} tags is the most one story can carry.`);
      return;
    }
    setDraft("");
    onChange([...tags, tag]);
  }

  return (
    <div className="mt-3">
      <ul className="flex flex-wrap gap-1.5 empty:hidden">
        {tags.map((tag) => (
          <li key={tag}>
            <span className="border-faint-2 text-soft flex items-center gap-1 rounded-xs border px-2 py-0.5 text-[12px] font-semibold">
              {tag}
              <button
                type="button"
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                aria-label={`Remove tag ${tag}`}
                className="focus-visible:ring-org hover:text-ink focus-visible:ring-2 focus-visible:outline-none"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Add a tag
        </label>
        <input
          id={id}
          value={draft}
          maxLength={TAG_MAX_LENGTH}
          placeholder="Add a tag"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
          className="border-faint-2 bg-paper text-ink focus-visible:ring-org min-w-0 flex-1 border px-2 py-1.5 text-[13px] focus-visible:ring-2 focus-visible:outline-none"
        />
        <button
          type="button"
          onClick={add}
          className="focus-visible:ring-org border-faint-2 text-soft hover:bg-faint flex items-center gap-1.5 rounded-xs border px-2.5 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none"
        >
          <Plus aria-hidden className="size-4" />
          Add
        </button>
      </div>
      <span role="status" aria-live="polite" className="text-[12.5px] empty:hidden">
        {problem ? <span className="text-destructive font-semibold">{problem}</span> : null}
      </span>
    </div>
  );
}
