"use client";

import { useId, useMemo } from "react";
import { SaveStatusText, Section, useSaveStatus } from "@/components/settings/section";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { brand } from "@/config/brand";
import { savePreferences } from "@/lib/api/preferences-store";
import { BRIEF_LENGTH_OPTIONS, detectTimezone, formatBriefTime } from "@/lib/api/preferences";
import type { Preferences } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * When the brief is cut, where in the world that is, and how long it runs.
 *
 * These three live together because they are one sentence: "have about ten
 * minutes ready for me at half past seven, my time". Splitting them into three
 * panels would make the reader assemble that sentence themselves.
 *
 * TWO OF THE THREE ARE NOT THE READER'S TO CHANGE — #203. The time the brief
 * is cut and its zone are the instance's: one collector, one window, the same
 * for everyone who opens this copy. Until #203 any reader could change them
 * for every other reader, from this screen, with no login. The controls stay
 * on the page, disabled, with the reason beside them — a gated control that
 * vanishes leaves the reader wondering whether the feature exists, and one
 * that is greyed with a sentence tells them exactly who holds it. Whoever runs
 * the copy changes them through /api/internal/preferences with the secret.
 *
 * The LENGTH is still the reader's: it lives on their device (#94) and nobody
 * else sees it.
 */
export function BriefSection({ preferences }: { preferences: Preferences }) {
  const { status, run } = useSaveStatus();

  return (
    <Section
      title="Your brief"
      hint="The window closes at this time each day, and what arrived since the last one is what you get."
      status={<SaveStatusText status={status} what="your brief settings" />}
    >
      <div className="flex flex-col gap-5">
        <BriefTimeField briefTime={preferences.briefTime} />
        <TimezoneField timezone={preferences.timezone} />
        <p className="text-meta -mt-2 text-[12.5px]" data-settings-locked="brief-window">
          The time and zone are set by whoever runs this copy, and are the same for everyone who
          opens it.
        </p>
        <BriefLengthField
          briefLength={preferences.briefLength}
          onSave={(briefLength) => run(() => savePreferences({ briefLength }))}
        />
      </div>
    </Section>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="font-label text-soft block text-[10.5px] font-bold tracking-[0.18em] uppercase"
    >
      {children}
    </label>
  );
}

/**
 * A native time input, so the reader sees the brief time in their own
 * platform's clock and its own 12- or 24-hour habit. DISABLED since #203: the
 * value is shown, not offered. The draft/Save machinery this held is gone with
 * the write it drove; the one sentence under the fields says who can change it.
 */
function BriefTimeField({ briefTime }: { briefTime: string }) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id}>Ready at</FieldLabel>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="time"
          value={briefTime}
          readOnly
          disabled
          aria-describedby={`${id}-locked`}
          className="border-faint-2 bg-paper text-ink border px-2 py-1.5 text-[14px] tabular-nums disabled:cursor-not-allowed disabled:opacity-70"
        />
        <span id={`${id}-locked`} className="text-meta text-[12.5px]">
          {formatBriefTime(briefTime)}, set by whoever runs this copy
        </span>
      </div>
    </div>
  );
}

/**
 * The zone the brief's clock runs in. DISABLED since #203, same as the time:
 * shown, not offered. The "Use <detected zone>" button is gone with the write
 * — but the reader's own zone is still worth a sentence when it differs,
 * because a brief cut at 09:00 Vancouver arrives at a different hour in
 * Lisbon, and a reader who cannot change the setting can at least be told
 * what it means for them.
 */
function TimezoneField({ timezone }: { timezone: string }) {
  const id = useId();
  const detected = useMemo(() => detectTimezone(), []);

  return (
    <div>
      <FieldLabel htmlFor={id}>Brief time zone</FieldLabel>
      <div className="mt-1 flex flex-wrap items-start gap-2">
        <TimezonePicker id={id} value={timezone} disabled />
      </div>
      {detected && detected !== timezone ? (
        <p className="text-meta mt-2 text-[12.5px]">
          Your browser is in {detected}; the brief is cut on {timezone} time.
        </p>
      ) : null}
    </div>
  );
}

/**
 * How long the brief runs by default.
 *
 * This is the DEFAULT, not the rule: the length control on Today overrides it
 * for a visit. Saying so here stops the reader thinking one of the two is
 * broken when they disagree.
 */
function BriefLengthField({
  briefLength,
  onSave,
}: {
  briefLength: string;
  onSave: (value: "5" | "10" | "all") => void;
}) {
  const known = BRIEF_LENGTH_OPTIONS.some((option) => option.value === briefLength);

  return (
    <fieldset>
      <legend className="font-label text-soft text-[10.5px] font-bold tracking-[0.18em] uppercase">
        How long you have
      </legend>
      <p className="text-meta mt-1 text-[12.5px]">
        The default. Today has the same switch for changing it on the day.
      </p>
      {/*
        ON BOTH PATHS SINCE #94, and this was a real defect for one commit. The
        length moved onto the device, so the cookie is set on a live build too —
        and this sentence was still gated on fixture mode, which meant the app
        set a cookie and said nothing about it. This app promises "nothing is
        sent anywhere", so it owes an explanation for every exception, and a
        sentence that hides itself in the ordinary case explains nothing.
        See BRIEF_LENGTH_COOKIE in fixture-store.ts.
      */}
      <p className="text-meta mt-1 text-[12.5px] leading-relaxed">
        Your choice is kept on this device, and one small cookie carries it so the page knows your
        length before it loads — that is the only cookie {brand.name} sets. It holds the length and
        nothing else: no name, no address, nothing that says who you are. It never leaves this
        machine.
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {BRIEF_LENGTH_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 border p-3",
              option.value === briefLength ? "border-ink" : "border-faint-2 hover:bg-faint",
            )}
          >
            <input
              type="radio"
              name="brief-length"
              value={option.value}
              checked={option.value === briefLength}
              onChange={() => onSave(option.value)}
              className="accent-ink focus-visible:ring-org mt-0.5 size-4 shrink-0 focus-visible:ring-2 focus-visible:outline-none"
            />
            <span>
              <span className="block text-[14px] font-semibold">{option.label}</span>
              <span className="text-soft block text-[13px] leading-relaxed">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {/* The column is plain text, so a length this build cannot draw can come
          back from the database. Nothing would be checked above, and a set of
          radios with none selected reads as "not chosen" — which is a different
          and false statement. */}
      {known ? null : (
        <p className="text-destructive mt-2 text-[12.5px] font-semibold">
          Your saved length is “{briefLength}”, which this version does not recognise. Choosing one
          above replaces it.
        </p>
      )}
    </fieldset>
  );
}
