"use client";

import { useSyncExternalStore } from "react";

/**
 * "4 hours ago", from the reader's own clock.
 *
 * SAME SHAPE AS LocalDate, AND FOR THE SAME REASON: empty on the server, so
 * the markup cannot disagree with the client. A relative time rendered on the
 * server is computed against the server's clock at BUILD or request time and
 * then cached — this page is the landing page, which is exactly the page a CDN
 * is most likely to hold — so "2 minutes ago" could be served for an hour.
 */
function subscribe() {
  return () => {};
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

function format(iso: string) {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(elapsed)) return "";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(elapsed) >= ms) return rtf.format(-Math.round(elapsed / ms), unit);
  }
  return rtf.format(0, "minute");
}

export function RelativeTime({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribe,
    // Recomputed on every render rather than cached, and that is deliberate:
    // useSyncExternalStore compares with Object.is, and this returns the same
    // string for the whole minute it is true, so it cannot loop.
    () => format(iso),
    () => "",
  );
  if (!text) return null;
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
