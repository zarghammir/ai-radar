import { getPreferences, USING_FIXTURES } from "@/lib/api/client";
import { BRIEF_LENGTH_COOKIE } from "@/lib/api/fixture-store";
import { asBriefLength } from "@/lib/api/preferences";
import type { BriefLengthParam, Preferences } from "@/lib/api/types";

/**
 * SERVER ONLY. Nothing with "use client" may import this module: the live path
 * below pulls in the database client, and the dynamic import is what keeps it
 * out of a browser bundle — it is not a guard against being imported from one.
 * There is no `server-only` package in this repository to enforce it, so this
 * comment and the single call site in src/app/page.tsx are the enforcement.
 */

/** What Today falls back to when preferences cannot be read. */
export const FALLBACK_BRIEF_LENGTH: BriefLengthParam = "10";

/**
 * Reads preferences the way a SERVER component must.
 *
 * Against the real API it calls the same function the route calls, through a
 * dynamic import so no database code reaches a browser bundle. It does NOT
 * fetch /api/preferences: a server component asking its own app for a relative
 * URL has no origin to resolve it against, so the request throws on every
 * load. Today already shipped that defect once, and it was invisible — the
 * catch below would have swallowed it and quietly used ten minutes forever,
 * which is the dead control this function exists to remove.
 *
 * On fixtures there is no database, and the client's own path is right.
 */
async function readPreferences(): Promise<Preferences> {
  if (USING_FIXTURES) {
    // On fixtures the preferences are in localStorage, which the server cannot
    // read. The chosen length is mirrored into one cookie for exactly this —
    // see BRIEF_LENGTH_COOKIE in fixture-store.ts and issue #75. Everything
    // else still comes from the client-side defaults, because nothing else on
    // this page needs it.
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const stored = jar.get(BRIEF_LENGTH_COOKIE)?.value;
    const base = await getPreferences();
    return stored ? { ...base, briefLength: decodeURIComponent(stored) } : base;
  }
  const [{ getDb }, reader] = await Promise.all([import("@/db/client"), import("@/api/reader")]);
  return reader.getPreferences(getDb());
}

/**
 * How long Today runs when the reader has not said otherwise in the URL.
 *
 * The stored preference is the DEFAULT and `?length=` is the override for one
 * visit — the split ReadingMode's own comment described before the endpoint
 * existed. Until this, the length chosen in Settings was written by the reader
 * and read by nobody.
 *
 * A failed read falls back to ten minutes rather than throwing. This is the
 * one place in the app where guessing is right: the alternative is no brief at
 * all, the guess is visible in the switch on the page, and one press corrects
 * it. Nothing is written back, so the reader's real choice is never overwritten
 * by the fallback.
 */
export async function defaultBriefLength(): Promise<BriefLengthParam> {
  try {
    const preferences = await readPreferences();
    return asBriefLength(preferences.briefLength).length;
  } catch (error) {
    console.error("today: could not read the preferred brief length", error);
    return FALLBACK_BRIEF_LENGTH;
  }
}
