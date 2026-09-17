"use client";

import { useSyncExternalStore } from "react";

/**
 * The reader's own date, from their own clock.
 *
 * The Today page previously hard-coded "Wednesday morning", which was true on
 * the day it was written and wrong the other six. It cannot be rendered on the
 * server either: the server's weekday is the server's timezone, not the
 * reader's, and a self-hosted install can be anywhere.
 *
 * Once /api/brief lands (issue #13) the brief's own `window` is the better
 * source, because then the date means "the window this brief covers" rather
 * than "now".
 */
function subscribe() {
  // Nothing to subscribe to: a clock has no change event worth a re-render
  // here, and the value is recomputed on any render the app already performs.
  return () => {};
}

function getSnapshot() {
  // Returns an equal string on every call, so useSyncExternalStore's Object.is
  // check is satisfied and this cannot loop.
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

/** Empty on the server, so the markup cannot disagree with the client. */
function getServerSnapshot() {
  return "";
}

export function LocalDate() {
  const formatted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!formatted) return null;
  return <time suppressHydrationWarning>{formatted}</time>;
}
