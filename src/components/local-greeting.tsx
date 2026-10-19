"use client";

import { useSyncExternalStore } from "react";

/**
 * The greeting at the top of Today, from the READER'S OWN CLOCK.
 *
 * It used to be the literal "Good morning", which was right for a reader in
 * one time zone before noon and wrong for everyone else — the owner opened it
 * in the evening and was wished a good morning. The server cannot know the
 * reader's hour (it runs in UTC, and the reader can be anywhere), so the hour
 * is read on the device, the way LocalDate reads the date.
 *
 * "Hello" is what the server renders, and what shows if the device's clock
 * cannot be read: it is true at any hour, so the fallback is never wrong, only
 * less specific.
 */
export const FALLBACK_GREETING = "Hello";

/** Pure, so a test can walk all 24 hours. */
export function greetingFor(hour: number): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return FALLBACK_GREETING;
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 22) return "Good evening";
  // Late night. "Good night" is a goodbye, not a greeting, so it says hello.
  return FALLBACK_GREETING;
}

function subscribe() {
  // No clock event worth a re-render; the value is recomputed on any render
  // the app already performs. Same as LocalDate.
  return () => {};
}

function getSnapshot() {
  return greetingFor(new Date().getHours());
}

function getServerSnapshot() {
  return FALLBACK_GREETING;
}

export function LocalGreeting() {
  return (
    <span suppressHydrationWarning>
      {useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)}
    </span>
  );
}
