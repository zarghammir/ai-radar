"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getPreferencesSnapshot,
  getServerPreferencesSnapshot,
  subscribePreferences,
} from "@/lib/api/preferences-store";

/** Where first-run onboarding lives. */
export const WELCOME_PATH = "/welcome";

/**
 * The routes this gate leaves alone, and they are the same two that draw no
 * navigation — for the same reason, from opposite ends.
 *
 * /welcome is the destination; sending it to itself would loop.
 *
 * /about IS THE PAGE FOR SOMEONE WHO HAS NEVER BEEN HERE, which is exactly the
 * reader this gate fires on. Without this entry, every stranger who follows the
 * link in a post lands on the marketing page for a frame and is then thrown
 * into onboarding, having been told nothing about what they are onboarding to.
 * The page would have been unreachable by the only audience it is written for,
 * and reachable by everyone else — which is the hardest kind of defect to
 * notice, because anyone on the team testing it has onboarded already.
 *
 * Caught by a browser check, not by reading: the sweep of /about came back with
 * no header, no figures and no links, because it had been redirected.
 */
const UNGATED_PATHS = new Set<string>([WELCOME_PATH, "/about"]);

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
 * not only Today. UNGATED_PATHS above lists the routes it must not touch.
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
    if (UNGATED_PATHS.has(pathname)) return;
    router.replace(WELCOME_PATH);
  }, [firstRun, pathname, router]);

  return null;
}
