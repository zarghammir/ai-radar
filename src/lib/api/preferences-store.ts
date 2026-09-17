import { getPreferences, putPreferences, type PreferencesPatch } from "@/lib/api/client";
import type { Preferences } from "@/lib/api/types";

/**
 * The reader's preferences, as an external store.
 *
 * One store rather than a copy per screen: Settings, first-run onboarding and
 * the reading-length control on Today all read the same row, and three
 * components each holding their own copy is three answers to one question.
 *
 * Same three kinds as the saved list, for the same reason: a preferences row
 * that could not be READ is not a reader who has chosen nothing. Showing
 * defaults after a failed read would invite them to "confirm" settings that
 * silently overwrite what they actually chose.
 */
export type PreferencesState =
  | { kind: "loading" }
  | { kind: "ready"; preferences: Preferences }
  | { kind: "failed" };

const SERVER_SNAPSHOT: PreferencesState = { kind: "loading" };

let snapshot: PreferencesState = SERVER_SNAPSHOT;
let started = false;
let generation = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function set(next: PreferencesState) {
  snapshot = next;
  emit();
}

async function run() {
  const attempt = ++generation;
  try {
    const preferences = await getPreferences();
    if (attempt !== generation) return;
    set({ kind: "ready", preferences });
  } catch (error) {
    console.error("preferences: could not load", error);
    if (attempt !== generation) return;
    set({ kind: "failed" });
  }
}

/** Subscribing starts the first load, keeping the fetch out of an effect. */
export function subscribePreferences(listener: () => void) {
  listeners.add(listener);
  if (!started) {
    started = true;
    void run();
  }
  return () => {
    listeners.delete(listener);
  };
}

export function getPreferencesSnapshot(): PreferencesState {
  return snapshot;
}

export function getServerPreferencesSnapshot(): PreferencesState {
  return SERVER_SNAPSHOT;
}

export function refreshPreferences() {
  set({ kind: "loading" });
  void run();
}

/**
 * Writes a patch and keeps the screen honest about the result.
 *
 * The change shows immediately, and if the write throws the old value comes
 * back AND the caller is told. A settings screen that keeps displaying a
 * choice the server rejected is the worst kind of lie this product can tell:
 * the reader walks away believing their brief arrives at seven.
 *
 * The response is taken as the new truth rather than the patch, because the
 * server may normalise what it stores, and the screen should show what is
 * actually saved.
 */
export async function savePreferences(patch: PreferencesPatch): Promise<void> {
  const before = snapshot;
  if (before.kind === "ready") {
    set({ kind: "ready", preferences: { ...before.preferences, ...patch } });
  }
  try {
    const saved = await putPreferences(patch);
    set({ kind: "ready", preferences: saved });
  } catch (error) {
    console.error("preferences: could not save", error);
    set(before);
    throw error;
  }
}

/** Test seam: module-level state outlives a test that does not reset it. */
export function resetPreferencesStoreForTests() {
  snapshot = SERVER_SNAPSHOT;
  started = false;
  generation += 1;
  listeners.clear();
}
