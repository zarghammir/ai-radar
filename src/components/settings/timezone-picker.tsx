"use client";

import { useMemo, useState } from "react";

/**
 * Picks an IANA time zone, and says so when it cannot offer a list.
 *
 * Where the browser can enumerate zones this is a real list; where it cannot,
 * it falls back to typing one. An empty select would leave the setting
 * unreachable rather than merely plainer — the same absence-shaped defect as a
 * control with no endpoint behind it.
 *
 * Presentational: it validates and reports, and never saves. The caller
 * decides whether a valid choice is written immediately or carried to a Next
 * button.
 */
export function TimezonePicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  /** Called only with a zone this platform accepts. */
  onChange: (zone: string) => void;
}) {
  const [typed, setTyped] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);

  /** Does this platform accept the stored zone at all? Different question
   *  from whether it will list it. */
  const accepted = useMemo(() => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, [value]);

  const zones = useMemo(() => {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
    if (typeof intl.supportedValuesOf !== "function") return null;
    try {
      const list = intl.supportedValuesOf("timeZone");
      return list.length > 0 ? list : null;
    } catch {
      return null;
    }
  }, []);

  function commit(zone: string) {
    setProblem(null);
    try {
      // The same check the route makes, made here so the reason is attached to
      // the field rather than arriving later as a rejected write.
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
    } catch {
      setProblem(`“${zone}” is not a time zone name. They look like Europe/Lisbon.`);
      return;
    }
    onChange(zone);
  }

  return (
    <div>
      {zones ? (
        <select
          id={id}
          value={value}
          onChange={(event) => commit(event.target.value)}
          className="border-faint-2 bg-paper text-ink focus-visible:ring-org max-w-full border px-2 py-1.5 text-[14px] focus-visible:ring-2 focus-visible:outline-none"
        >
          {/* A stored zone this browser does not list still has to be visible,
              or the reader sees a picker claiming they chose something else.
              But "not in this list" is only the right thing to say when the
              zone is genuinely unknown. UTC is the app's OWN DEFAULT and is
              missing from supportedValuesOf here, so a fresh reader was being
              shown "UTC (not in this list)" — the default value reading as an
              anomaly about a choice they never made. If the platform ACCEPTS
              the zone, it is a real zone that simply is not enumerated, and it
              is shown plainly. */}
          {zones.includes(value) ? null : (
            <option value={value}>
              {accepted ? value : `${value} — not a zone this browser knows`}
            </option>
          )}
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          className="border-faint-2 bg-paper text-ink focus-visible:ring-org border px-2 py-1.5 text-[14px] focus-visible:ring-2 focus-visible:outline-none"
        />
      )}
      {problem ? (
        <p className="text-destructive mt-2 text-[12.5px] font-semibold">{problem}</p>
      ) : null}
    </div>
  );
}
