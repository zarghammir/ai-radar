"use client";

import { useSyncExternalStore } from "react";
import { BriefSection } from "@/components/settings/brief-section";
import { InterestsSection } from "@/components/settings/interests-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import {
  getPreferencesSnapshot,
  getServerPreferencesSnapshot,
  refreshPreferences,
  subscribePreferences,
} from "@/lib/api/preferences-store";
import type { TopicSummary } from "@/lib/api/types";

/**
 * Every section that reads the preferences row, subscribed once.
 *
 * Loading and failure are handled HERE rather than in each section, so the
 * screen has one answer to "what is going on" instead of three panels
 * disagreeing. Adding a section — a watchlist, source choices — means adding a
 * child below, not touching this or its siblings.
 *
 * On failure the sections are NOT rendered with defaults. A settings screen
 * showing 07:30 after a failed read invites the reader to confirm a value they
 * never chose, and the confirmation would overwrite whatever is really stored.
 */
export function PreferenceSections({ topics }: { topics: TopicSummary[] | null }) {
  const state = useSyncExternalStore(
    subscribePreferences,
    getPreferencesSnapshot,
    getServerPreferencesSnapshot,
  );

  if (state.kind === "loading") {
    return (
      <section className="bg-paper text-ink p-5" data-settings-state="loading">
        <p role="status" className="text-soft text-[14px]">
          Fetching your settings…
        </p>
      </section>
    );
  }

  if (state.kind === "failed") {
    return (
      <section className="bg-paper text-ink p-5" data-settings-state="unreachable">
        <h2 className="text-[17px] font-bold tracking-tight">Cannot reach your settings</h2>
        <p className="text-soft mt-2 max-w-prose text-[14px] leading-relaxed">
          Nothing has been changed or lost. Your settings are not shown rather than shown wrongly —
          filling this in with defaults would invite you to confirm choices you never made.
        </p>
        <button
          type="button"
          onClick={refreshPreferences}
          className="focus-visible:ring-org border-faint-2 text-soft hover:bg-faint mt-4 rounded-xs border px-3 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none"
        >
          Try again
        </button>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-settings-state="ready">
      <BriefSection preferences={state.preferences} />
      <InterestsSection preferences={state.preferences} topics={topics} />
      <NotificationsSection preferences={state.preferences} />
    </div>
  );
}
