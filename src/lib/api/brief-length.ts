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

/**
 * WHAT THE WORKER MEASURES THE READER'S COVERAGE AGAINST — and no longer what
 * the page opens on, which is the part of this comment that went stale.
 *
 * WHEN IT CHANGED HANDS. This was written to fix the DEFAULT the Today page
 * read. #191 then landed first and removed the view control entirely on the
 * owner's ruling — "remove launches + news tab… just want one feed" — so
 * src/app/page.tsx now takes `parseView(params.view) ?? "all"` and never reads
 * this constant at all.
 *
 * THAT DID NOT MAKE THIS CHANGE UNNECESSARY, which is what I assumed when I
 * recommended closing this PR, and I was wrong. The constant has exactly one
 * live consumer left: src/worker/brief-coverage.ts, which reports summary
 * coverage "on the view he opens". With this still at "built" the worker
 * reports against five of ten content types while the app serves all ten — a
 * figure about a screen nobody can reach any more, printed every pass, next to
 * a correct one and indistinguishable from it.
 *
 * So the fix is the same fix and the reason is now a different one: it keeps
 * the worker's report describing the page that actually exists.
 *
 * ── WHY "all" WAS RIGHT IN THE FIRST PLACE ─────────────────────────────────
 *
 * "all" SINCE THE CATALOGUE CHANGED, and the change is in the catalogue rather
 * than in anyone's taste. "built" admits MODEL, TOOL, RELEASE, PAPER and
 * RESEARCH; it excludes NEWS, BUSINESS, DISCUSSION, TREND and REGULATION. That
 * was a fair default when the sources were labs and release feeds.
 *
 * #181 added seven startup and venture feeds — Crunchbase, TechCrunch Venture,
 * TechCrunch Startups, Sifted, Tech.eu, Y Combinator's blog and Product Hunt —
 * and they produce almost nothing BUT news and business. Measured on production
 * 2026-09-30: of the 23 stories that had arrived in the previous 24 hours, 20
 * were NEWS, 2 BUSINESS and 1 RELEASE. On "built" a reader could see one of
 * them. Seven sources were merged, seeded, fetched and ranked, and the default
 * screen could not show their output by construction.
 *
 * So this is not "news is more interesting now". It is that the default was
 * filtering out most of what the collector now collects, and a default that
 * hides five sixths of a day's arrivals is reporting a quiet day that did not
 * happen.
 *
 * THIS DOES NOT MAKE THE BRIEF FRESH, and it was not expected to. When this was
 * written, ordering was by score alone, so the front of "all" was still led by
 * whatever was most important rather than most recent — measured the same day,
 * the top ten of "all" held nothing under 24 hours old. #186 holds those
 * measurements and the reason the age half-life cannot fix it.
 *
 * THAT HALF IS NOW SOLVED ELSEWHERE, and the fact is dated rather than deleted
 * because both halves are worth keeping: #191 added a fresh-first ordering, and
 * on 2026-10-03 the live top five were 3.1h to 13.7h old, all under a day. So
 * the sentence above describes why this constant alone was never going to be
 * enough — not a property the app still has.
 */
export const DEFAULT_VIEW: BriefView = "all";

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
