"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { brand } from "@/config/brand";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { TopicChips } from "@/components/settings/topic-chips";
import {
  getPreferencesSnapshot,
  getServerPreferencesSnapshot,
  refreshPreferences,
  savePreferences,
  subscribePreferences,
} from "@/lib/api/preferences-store";
import { detectTimezone } from "@/lib/api/preferences";
import type { TopicSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils";

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
const STEPS = ["what", "when", "what-you-follow"] as const;
type Step = (typeof STEPS)[number];

export function OnboardingFlow({ topics }: { topics: TopicSummary[] | null }) {
  const router = useRouter();
  const state = useSyncExternalStore(
    subscribePreferences,
    getPreferencesSnapshot,
    getServerPreferencesSnapshot,
  );

  const [step, setStep] = useState<Step>("what");
  const [briefTime, setBriefTime] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const detected = useMemo(() => detectTimezone(), []);
  const timeId = useId();
  const zoneId = useId();

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
  // The reader's own answers if they have given one, otherwise what is stored,
  // and for the zone the browser's guess — OFFERED as the filled-in answer they
  // confirm by pressing Next, never written behind their back.
  const time = briefTime ?? preferences.briefTime;
  const zone =
    timezone ?? (preferences.timezone === "UTC" ? (detected ?? "UTC") : preferences.timezone);
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
      {/* The numerals only. Each item used to carry the whole phrase, so the
          row read "1 OF 3  2 OF 3  3 OF 3" — three sentences that look like a
          fault rather than a position. The phrase is said once, to everyone. */}
      <p className="text-meta font-label mb-2 text-[10.5px] tracking-[0.18em] uppercase">
        Step {STEPS.indexOf(step) + 1} of {STEPS.length}
      </p>
      <ol className="text-meta mb-6 flex gap-2 font-mono text-[11px]">
        {STEPS.map((name, index) => (
          <li
            key={name}
            aria-current={name === step ? "step" : undefined}
            className={cn(
              "w-10 border-b-2 pb-1 text-center",
              name === step
                ? "border-org text-ink font-bold"
                : index < STEPS.indexOf(step)
                  ? "border-ink text-soft"
                  : "border-faint-2",
            )}
          >
            {index + 1}
            <span className="sr-only">
              {name === step
                ? " — this step"
                : index < STEPS.indexOf(step)
                  ? " — done"
                  : " — later"}
            </span>
          </li>
        ))}
      </ol>

      {step === "what" ? (
        <div>
          <h2 className="text-ink text-[24px] leading-tight font-bold tracking-tight text-balance">
            You will hear about it early.
          </h2>
          <div className="text-soft mt-3 flex max-w-prose flex-col gap-3 text-[15px] leading-relaxed">
            <p>
              Things appear — a repository, a model, a tool, a change in the rules — and most of
              them reach you weeks later through somebody else&rsquo;s summary, if they reach you at
              all.
            </p>
            <p>
              {brand.name} watches where they show up first, works out how well-sourced each one is
              and says so on its face, and gives you the few that matter in the time you have.
            </p>
            <p>
              It runs on your machine. What you read, save and follow stays there — nothing is
              reported anywhere.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Primary onClick={() => setStep("when")}>Set it up — under a minute</Primary>
            <Secondary disabled={busy} onClick={() => void write({ onboardedAt: stamp() }, done)}>
              Skip, use the defaults
            </Secondary>
          </div>
        </div>
      ) : null}

      {step === "when" ? (
        <div>
          <h2 className="text-ink text-[24px] leading-tight font-bold tracking-tight text-balance">
            When do you want it ready?
          </h2>
          <p className="text-soft mt-3 max-w-prose text-[15px] leading-relaxed">
            Everything that arrived since the last one is waiting at this time each day. You can
            change it whenever you like.
          </p>

          <div className="mt-5 flex flex-col gap-4">
            <div>
              <Label htmlFor={timeId}>Ready at</Label>
              <input
                id={timeId}
                type="time"
                value={time}
                onChange={(event) => setBriefTime(event.target.value)}
                className="border-faint-2 bg-paper text-ink focus-visible:ring-org mt-1 border px-2 py-1.5 text-[14px] tabular-nums focus-visible:ring-2 focus-visible:outline-none"
              />
            </div>
            <div>
              <Label htmlFor={zoneId}>Your time zone</Label>
              <div className="mt-1">
                <TimezonePicker id={zoneId} value={zone} onChange={setTimezone} />
              </div>
              {detected === null ? (
                <p className="text-meta mt-2 text-[12.5px]">
                  This browser will not say which zone it is in, so nothing is filled in for you.
                </p>
              ) : null}
            </div>
          </div>

          <Problem message={problem} />
          <div className="mt-6 flex flex-wrap gap-2">
            <Primary
              disabled={busy || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)}
              onClick={() =>
                void write({ briefTime: time, timezone: zone }, () => setStep("what-you-follow"))
              }
            >
              Next
            </Primary>
            <Secondary disabled={busy} onClick={() => setStep("what")}>
              Back
            </Secondary>
            <Secondary disabled={busy} onClick={() => void write({ onboardedAt: stamp() }, done)}>
              Skip the rest
            </Secondary>
          </div>
        </div>
      ) : null}

      {step === "what-you-follow" ? (
        <div>
          <h2 className="text-ink text-[24px] leading-tight font-bold tracking-tight text-balance">
            What are you working on?
          </h2>
          <p className="text-soft mt-3 max-w-prose text-[15px] leading-relaxed">
            Anything you pick is pushed up your brief. Nothing is filtered out — something big in a
            subject you never picked still reaches you. Pick none and everything is weighed the
            same.
          </p>

          <div className="mt-5">
            {topics === null ? (
              <p className="border-faint-2 text-soft border border-dashed p-4 text-[14px] leading-relaxed">
                The list of subjects could not be read just now. You can finish without it and pick
                them later in Settings.
              </p>
            ) : topics.length === 0 ? (
              <p className="border-faint-2 text-soft border border-dashed p-4 text-[14px] leading-relaxed">
                There are no subjects yet — they appear as the app collects stories and works out
                what they are about. Settings will have them once it has.
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
            <Secondary disabled={busy} onClick={() => setStep("when")}>
              Back
            </Secondary>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="font-label text-soft block text-[10.5px] font-bold tracking-[0.18em] uppercase"
    >
      {children}
    </label>
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
