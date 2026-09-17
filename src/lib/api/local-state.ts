import { localHiddenIds, localSavedIds, USING_FIXTURES } from "@/lib/api/client";

export interface ReaderState {
  saved: ReadonlySet<number>;
  hidden: ReadonlySet<number>;
}

const EMPTY: ReaderState = { saved: new Set(), hidden: new Set() };

/**
 * The reader's saved and hidden stories, as an external store.
 *
 * It is a store rather than React state because the server cannot know it —
 * localStorage does not exist there — and copying it into state inside an
 * effect is both a lint error and a second source of truth. `getServerSnapshot`
 * returns the same EMPTY object every time so the server render matches the
 * first client render, and the real values arrive on subscribe without a
 * hydration mismatch.
 */
let snapshot: ReaderState = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function recompute() {
  snapshot = { saved: localSavedIds(), hidden: localHiddenIds() };
  loaded = true;
}

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeReaderState(listener: () => void) {
  if (!loaded) recompute();
  listeners.add(listener);
  const onStorage = () => {
    recompute();
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Stable reference between changes, so useSyncExternalStore cannot loop. */
export function getReaderState(): ReaderState {
  if (!loaded) recompute();
  return snapshot;
}

export function getServerReaderState(): ReaderState {
  return EMPTY;
}

/**
 * Applies a change optimistically and returns a rollback. The caller awaits the
 * write and calls the rollback if it throws, so a failed save does not leave
 * the interface claiming something that did not happen.
 */
export function applyOptimistic(kind: "saved" | "hidden", id: number, next: boolean): () => void {
  const before = snapshot;
  const updated = new Set(before[kind]);
  if (next) updated.add(id);
  else updated.delete(id);
  snapshot = { ...before, [kind]: updated };
  loaded = true;
  emit();
  return () => {
    snapshot = before;
    emit();
  };
}

/** Only meaningful in fixture mode; against the real API the server is the truth. */
export const READER_STATE_IS_LOCAL = USING_FIXTURES;
