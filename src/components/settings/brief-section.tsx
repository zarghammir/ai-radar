"use client";

import { useId, useMemo, useState } from "react";
import { SaveStatusText, Section, useSaveStatus } from "@/components/settings/section";
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
        <BriefTimeField
          briefTime={preferences.briefTime}
          onSave={(briefTime) => run(() => savePreferences({ briefTime }))}
        />
        <TimezoneField
          timezone={preferences.timezone}
          onSave={(timezone) => run(() => savePreferences({ timezone }))}
        />
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
 * A native time input, so the reader gets their own platform's clock and its
 * own 12- or 24-hour habit. The Save button appears only once the draft
 * differs: a control that is always there gives no signal about whether there
 * is anything to save.
 */
function BriefTimeField({
  briefTime,
  onSave,
}: {
  briefTime: string;
  onSave: (value: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(briefTime);
  const changed = draft !== briefTime;
  const valid = /^([01]\d|2[0-3]):([0-5]\d)$/.test(draft);

  return (
    <div>
      <FieldLabel htmlFor={id}>Ready at</FieldLabel>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="time"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="border-faint-2 bg-paper text-ink focus-visible:ring-org border px-2 py-1.5 text-[14px] tabular-nums focus-visible:ring-2 focus-visible:outline-none"
        />
        <span className="text-meta text-[12.5px]">
          Currently {formatBriefTime(briefTime)}
        </span>
        {changed ? (
          <button
            type="button"
            disabled={!valid}
            onClick={() => onSave(draft)}
            className="focus-visible:ring-org bg-ink text-paper border-ink rounded-xs border px-2.5 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save time
          </button>
        ) : null}
        {/* An emptied time input reads as "" on every browser. Saying so beats
            a Save button that is disabled for reasons the reader cannot see. */}
        {changed && !valid ? (
          <span className="text-destructive text-[12.5px] font-semibold">
            Pick a time first.
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The zone the brief's clock runs in.
 *
 * The browser's guess is OFFERED, never applied behind the reader's back: a
 * wrong guess stored silently is a brief arriving at the wrong hour with
 * nothing on screen to explain why. Where the browser can list the zones, this
 * is a real list; where it cannot, it falls back to typing one — an empty list
 * would leave the setting unreachable rather than merely plainer.
 */
function TimezoneField({ timezone, onSave }: { timezone: string; onSave: (value: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(timezone);
  const [problem, setProblem] = useState<string | null>(null);
  const detected = useMemo(() => detectTimezone(), []);

  const zones = useMemo(() => {
    const supported = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
    if (typeof supported.supportedValuesOf !== "function") return null;
    try {
      const list = supported.supportedValuesOf("timeZone");
      return list.length > 0 ? list : null;
    } catch {
      return null;
    }
  }, []);

  function commit(value: string) {
    setProblem(null);
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
    } catch {
      // The same check the route makes, made here so the reason is attached to
      // the field rather than arriving as a rejected write.
      setProblem(`“${value}” is not a time zone name. They look like Europe/Lisbon.`);
      return;
    }
    setDraft(value);
    onSave(value);
  }

  return (
    <div>
      <FieldLabel htmlFor={id}>Your time zone</FieldLabel>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {zones ? (
          <select
            id={id}
            value={zones.includes(draft) ? draft : ""}
            onChange={(event) => commit(event.target.value)}
            className="border-faint-2 bg-paper text-ink focus-visible:ring-org max-w-full border px-2 py-1.5 text-[14px] focus-visible:ring-2 focus-visible:outline-none"
          >
            {/* A stored zone this browser does not list still has to be
                visible, or the reader sees a picker claiming they chose
                something else. */}
            {zones.includes(draft) ? null : <option value="">{draft} (not in this list)</option>}
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            className="border-faint-2 bg-paper text-ink focus-visible:ring-org border px-2 py-1.5 text-[14px] focus-visible:ring-2 focus-visible:outline-none"
          />
        )}

        {detected && detected !== timezone ? (
          <button
            type="button"
            onClick={() => commit(detected)}
            className="focus-visible:ring-org border-faint-2 text-soft hover:bg-faint rounded-xs border px-2.5 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none"
          >
            Use {detected}
          </button>
        ) : null}
      </div>
      {problem ? (
        <p className="text-destructive mt-2 text-[12.5px] font-semibold">{problem}</p>
      ) : null}
      {detected === null ? (
        <p className="text-meta mt-2 text-[12.5px]">
          This browser will not say which zone it is in, so nothing is guessed for you.
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
