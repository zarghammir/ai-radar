"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { TopicChips } from "@/components/settings/topic-chips";
import {
  getPreferencesSnapshot,
  getServerPreferencesSnapshot,
  refreshPreferences,
  savePreferences,
  subscribePreferences,
} from "@/lib/api/preferences-store";
import type { TopicSummary } from "@/lib/api/types";

/**
 * First run.
 *
 * The words here are about WHAT THIS DOES FOR THE READER, never about what it
 * contains. That is deliberate and it is the reason this copy is worth
 * reading twice: what the app collects is going to change, and a welcome
 * screen that lists categories becomes wrong the day the product widens. What
 * it does for someone — finds the thing early, says how solid it is, keeps it
 * short — stays true through that.
 *
 * Every step is skippable, and skipping is a real answer rather than a
 * postponement: it writes onboardedAt like finishing does, so a reader who
 * skips is not asked again on their next visit.
 */
export function OnboardingFlow({ topics }: { topics: TopicSummary[] | null }) {
  const router = useRouter();
  const state = useSyncExternalStore(
    subscribePreferences,
    getPreferencesSnapshot,
    getServerPreferencesSnapshot,
  );

  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (state.kind === "loading") {
    return (
      <p role="status" className="text-soft text-[14px]">
        One moment…
      </p>
    );
  }

  if (state.kind === "failed") {
    // Onboarding with no store behind it would take a stranger through three
    // steps and lose all of it at the end. Say so before they start.
    return (
      <div>
        <h2 className="text-[17px] font-bold tracking-tight">Cannot set up just yet</h2>
        <p className="text-soft mt-2 max-w-prose text-[14px] leading-relaxed">
          The app could not reach the place your choices are kept, so there is no point asking for
          them — they would not survive the last step. Nothing is wrong with what you have.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Secondary onClick={refreshPreferences}>Try again</Secondary>
          <Secondary onClick={() => router.replace("/")}>Go to Today</Secondary>
        </div>
      </div>
    );
  }

  const preferences = state.preferences;
  const topicKeys = chosen ?? new Set(preferences.topicKeys);

  async function write(patch: Parameters<typeof savePreferences>[0], then: () => void) {
    setBusy(true);
    setProblem(null);
    try {
      await savePreferences(patch);
      then();
    } catch {
      // The store has already put the old values back. Staying on the step
      // beats moving on and pretending the answer was kept.
      setProblem("That could not be saved. Nothing was changed — try again.");
    } finally {
      setBusy(false);
    }
  }

  const done = () => router.replace("/");
  const stamp = () => new Date().toISOString();

  return (
    <div>
      {/* ONE QUESTION, AND NO STEPPER OVER IT.
            There were three steps: a three-paragraph pitch, a brief time, and
            this. The pitch belongs on a page somebody chooses to open, not in
            front of the app — the owner: "reduce the text heavily on welcome".
            The brief time stopped configuring anything when #189 removed
            delivery; it is a label on Settings now, so asking a newcomer to set
            it was asking them to decide nothing.

            What is left is the one question whose answer changes what they see,
            and a step counter over a single step is furniture. Skip is a peer of
            Start reading rather than a smaller third option, because skipping is
            a real answer here: it means "weigh everything the same". */}
      <div>
        <h2 className="text-ink text-[24px] leading-tight font-bold tracking-tight text-balance">
          What do you want more of?
        </h2>
        <p className="text-soft mt-3 max-w-prose text-[15px] leading-relaxed">
          Anything you pick moves up your feed. Nothing is hidden, and you can change this later in
          Settings.
        </p>

        <div className="mt-5">
          {topics === null ? (
            <p className="border-faint-2 text-soft border border-dashed p-4 text-[14px] leading-relaxed">
              The list of subjects could not be read just now. You can finish without it and pick
              them later in Settings.
            </p>
          ) : topics.length === 0 ? (
            <p className="border-faint-2 text-soft border border-dashed p-4 text-[14px] leading-relaxed">
              There are no subjects yet — they appear as the app collects stories and works out what
              they are about. Settings will have them once it has.
            </p>
          ) : (
            <TopicChips
              topics={topics}
              chosen={topicKeys}
              onToggle={(key) => {
                const next = new Set(topicKeys);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                setChosen(next);
              }}
            />
          )}
        </div>

        <Problem message={problem} />
        <div className="mt-6 flex flex-wrap gap-2">
          <Primary
            disabled={busy}
            onClick={() => void write({ topicKeys: [...topicKeys], onboardedAt: stamp() }, done)}
          >
            Start reading
          </Primary>
          <Secondary disabled={busy} onClick={() => void write({ onboardedAt: stamp() }, done)}>
            Skip
          </Secondary>
        </div>
      </div>
    </div>
  );
}

function Problem({ message }: { message: string | null }) {
  return (
    <p role="status" aria-live="polite" className="mt-4 text-[13px]">
      {message ? <span className="text-destructive font-semibold">{message}</span> : null}
    </p>
  );
}

function Primary({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="focus-visible:ring-org bg-ink text-paper border-ink rounded-xs border px-3.5 py-2 text-[14px] font-semibold focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function Secondary({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="focus-visible:ring-org border-faint-2 text-soft hover:bg-faint rounded-xs border px-3.5 py-2 text-[14px] font-semibold focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}
