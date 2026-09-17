"use client";

import { useCallback, useState, type ReactNode } from "react";

/**
 * One setting, in its own panel.
 *
 * Settings is a LIST OF SECTIONS rather than a list of switches, because the
 * things that belong here next are not switches: interests are a large grid,
 * and a watchlist of people worth listening to is a list with its own adding
 * and removing. A screen built as one column of toggles has nowhere to put
 * either without being rebuilt, so each section is self-contained — its own
 * heading, its own explanation, its own saving state — and a new one is a new
 * component in the list, not a change to the ones already here.
 */
export function Section({
  title,
  hint,
  status,
  children,
}: {
  title: string;
  hint?: string;
  /** Rendered beside the heading, where a change is announced. */
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-paper text-ink p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
        {status}
      </div>
      {hint ? <p className="text-soft mt-2 text-[13px] leading-relaxed">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export type SaveStatus =
  { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed" };

/**
 * Runs a write and reports honestly what happened to it.
 *
 * A settings screen with no saving state is the absence-shaped defect in its
 * most ordinary form: the reader changes something, sees the control move, and
 * has no way to tell a stored preference from one that never left the browser.
 */
export function useSaveStatus() {
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });

  const run = useCallback(async (write: () => Promise<void>) => {
    setStatus({ kind: "saving" });
    try {
      await write();
      setStatus({ kind: "saved" });
    } catch {
      // The store has already put the old value back; this is the telling.
      setStatus({ kind: "failed" });
    }
  }, []);

  return { status, run };
}

/**
 * What happened to the last change, in words, in a live region — a change the
 * reader cannot see announced is a change that, as far as they know, did not
 * happen.
 */
export function SaveStatusText({ status, what }: { status: SaveStatus; what: string }) {
  // No empty:hidden on the span below, deliberately, and the same goes for
  // every other live region on these screens. display:none takes an element
  // out of the accessibility tree, so a region hidden while empty is ADDED to
  // the tree at the moment it gets its message — and assistive technology may
  // not announce a region it has only just seen. It stays rendered and only
  // its text changes; an empty inline span costs nothing visible.
  return (
    <span role="status" aria-live="polite" className="text-[12.5px]">
      {status.kind === "saving" ? <span className="text-meta">Saving…</span> : null}
      {status.kind === "saved" ? <span className="text-meta">Saved</span> : null}
      {status.kind === "failed" ? (
        <span className="text-destructive font-semibold">
          Could not save {what}. It is unchanged.
        </span>
      ) : null}
    </span>
  );
}
