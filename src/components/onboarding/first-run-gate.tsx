"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getPreferencesSnapshot,
  getServerPreferencesSnapshot,
  subscribePreferences,
} from "@/lib/api/preferences-store";

/** Where first-run onboarding lives, and the one route this gate leaves alone. */
export const WELCOME_PATH = "/welcome";

/**
 * Sends a reader who has never been here to the welcome screen, once.
 *
 * The gate is `onboardedAt === null` and nothing else. Two states are
 * deliberately NOT treated as first run:
 *
 *  - preferences still loading, which would bounce every visitor through
 *    /welcome for a moment on every cold load;
 *  - preferences that could not be READ, which is the important one. An
 *    unreachable store is not a new reader. Redirecting on a failed read would
 *    take somebody who has used the app for months through a setup whose every
 *    answer then fails to save — the absence-versus-failure defect in the one
 *    place where it greets you at the door.
 *
 * It renders nothing. It is in the layout so that arriving on any page works,
 * not only Today.
 */
export function FirstRunGate() {
  const router = useRouter();
  const pathname = usePathname();
  const state = useSyncExternalStore(
    subscribePreferences,
    getPreferencesSnapshot,
    getServerPreferencesSnapshot,
  );

  const firstRun = state.kind === "ready" && state.preferences.onboardedAt === null;

  useEffect(() => {
    if (!firstRun) return;
    if (pathname === WELCOME_PATH) return;
    router.replace(WELCOME_PATH);
  }, [firstRun, pathname, router]);

  return null;
}
