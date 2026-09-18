import { cookies } from "next/headers";
import { BRIEF_LENGTH_COOKIE, VIEW_COOKIE } from "@/lib/api/fixture-store";
import { asBriefLength } from "@/lib/api/preferences";
import { parseView, type BriefView } from "@/lib/api/views";
import type { BriefLengthParam } from "@/lib/api/types";

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
 * Against the real API it calls the same function the route calls, the way
 * brief-server.ts does — static imports, one fixture guard at the top, then the
 * live path. Two modules solving one problem in two shapes is how they drift,
 * so this follows the one that arrived with the live flip. It does NOT
 * fetch /api/preferences: a server component asking its own app for a relative
 * URL has no origin to resolve it against, so the request throws on every
 * load. Today already shipped that defect once, and it was invisible — the
 * catch below would have swallowed it and quietly used ten minutes forever,
 * which is the dead control this function exists to remove.
 *
 * On fixtures there is no database, and the client's own path is right.
 */
async function readBriefLength(): Promise<{ length: BriefLengthParam; recognised: boolean }> {
  // The reader's length lives in their BROWSER since #94, so the server has no
  // row to read it from — on either path. The cookie #75 introduced for fixture
  // builds is now the general mechanism rather than a fixture workaround: it is
  // the only way a value kept on the device can reach a page rendered on the
  // server before that device runs any JavaScript.
  const jar = await cookies();
  const stored = jar.get(BRIEF_LENGTH_COOKIE)?.value;
  if (!stored) return { length: FALLBACK_BRIEF_LENGTH, recognised: true };
  return asBriefLength(decodeURIComponent(stored));
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
    return (await readBriefLength()).length;
  } catch (error) {
    console.error("today: could not read the preferred brief length", error);
    return FALLBACK_BRIEF_LENGTH;
  }
}

/** What the app opens on when the reader has never chosen. */
export const DEFAULT_VIEW: BriefView = "built";

/**
 * Which view Today opens on, read the way a SERVER component must.
 *
 * The same cookie mechanism as the brief length, for the same reason: a value
 * kept on the device cannot otherwise reach a page rendered before that device
 * runs any JavaScript. A cookie this build cannot parse falls back to the
 * default rather than filtering to nothing — it is reader-writable, so it is
 * untrusted input.
 */
export async function defaultView(): Promise<BriefView> {
  try {
    const jar = await cookies();
    const stored = jar.get(VIEW_COOKIE)?.value;
    if (!stored) return DEFAULT_VIEW;
    return parseView(decodeURIComponent(stored)) ?? DEFAULT_VIEW;
  } catch (error) {
    console.error("today: could not read the preferred view", error);
    return DEFAULT_VIEW;
  }
}
