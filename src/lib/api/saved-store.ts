import { getSaved } from "@/lib/api/client";
import type { SavedCard } from "@/lib/api/types";

/**
 * The saved list, as an external store.
 *
 * It is a store and not component state for the same reason the reader's
 * saved/hidden ids are: the server cannot know it — on fixtures it is
 * localStorage, and against the API it is a request the server render should
 * not make on every visit — and copying it into React state inside an effect is
 * both a lint error and a second source of truth that can disagree with the
 * first.
 *
 * The three kinds are distinct on purpose. "loading" is not "empty", and
 * "failed" is not "empty" either: a list that could not be read must never
 * render as a reader who has saved nothing.
 */
export type SavedState =
  { kind: "loading" } | { kind: "ready"; stories: SavedCard[] } | { kind: "failed" };

/** The same object every time, so the server render and the first client
 *  render agree and useSyncExternalStore cannot loop. */
const SERVER_SNAPSHOT: SavedState = { kind: "loading" };

let snapshot: SavedState = SERVER_SNAPSHOT;
let started = false;
/** Which load is current. A late answer from an abandoned one is dropped. */
let generation = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function set(next: SavedState) {
  snapshot = next;
  emit();
}

async function run() {
  const attempt = ++generation;
  try {
    const response = await getSaved(false);
    if (attempt !== generation) return;
    set({ kind: "ready", stories: response.stories });
  } catch (error) {
    // The driver's message belongs in the console, never on the screen: it
    // names tables and hosts, and the reader can act on none of it.
    console.error("saved: could not load the list", error);
    if (attempt !== generation) return;
    set({ kind: "failed" });
  }
}

/**
 * Subscribing starts the first load. That keeps the fetch out of an effect —
 * where the rule against synchronous setState cannot tell that this one
 * happens a network round-trip later — and it means a second screen mounting
 * joins the load in flight rather than starting a competing one.
 */
export function subscribeSaved(listener: () => void) {
  listeners.add(listener);
  if (!started) {
    started = true;
    void run();
  }
  return () => {
    listeners.delete(listener);
  };
}

export function getSavedSnapshot(): SavedState {
  return snapshot;
}

export function getServerSavedSnapshot(): SavedState {
  return SERVER_SNAPSHOT;
}

/** Try again after a failure. Puts the screen back to "loading" first, so the
 *  reader can see that the press did something. */
export function refreshSaved() {
  set({ kind: "loading" });
  void run();
}

/**
 * Applies a change optimistically and returns a rollback, the same bargain
 * StoryActions makes with the reader. A write that throws puts the list back
 * rather than leaving the screen claiming something that did not happen.
 */
export function patchSavedStory(id: number, changes: Partial<SavedCard>): () => void {
  const before = snapshot;
  if (before.kind !== "ready") return () => {};
  set({
    kind: "ready",
    stories: before.stories.map((s) => (s.id === id ? { ...s, ...changes } : s)),
  });
  return () => set(before);
}

export function removeSavedStory(id: number): () => void {
  const before = snapshot;
  if (before.kind !== "ready") return () => {};
  set({ kind: "ready", stories: before.stories.filter((s) => s.id !== id) });
  return () => set(before);
}

/** Test seam: the module holds process-wide state, so a suite that does not
 *  reset it inherits whatever the previous test left behind. */
export function resetSavedStoreForTests() {
  snapshot = SERVER_SNAPSHOT;
  started = false;
  generation += 1;
  listeners.clear();
}
