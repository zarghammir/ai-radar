import { getPreferences } from "@/lib/api/client";
import { asBriefLength } from "@/lib/api/preferences";
import type { BriefLengthParam } from "@/lib/api/types";

/** What Today falls back to when preferences cannot be read. */
export const FALLBACK_BRIEF_LENGTH: BriefLengthParam = "10";

/**
 * How long Today runs when the reader has not said otherwise in the URL.
 *
 * The stored preference is the DEFAULT and `?length=` is the override for one
 * visit — the split ReadingMode's own comment described before the endpoint
 * existed. Until this, the length chosen in Settings was written and read by
 * nobody: a control that moves and changes nothing.
 *
 * A failed read falls back to ten minutes rather than throwing. This is the
 * one place in the app where guessing is right: the alternative is no brief at
 * all, the guess is visible in the switch on the page, and one press corrects
 * it. Nothing is written back, so the reader's real choice is never overwritten
 * by the fallback.
 */
export async function defaultBriefLength(): Promise<BriefLengthParam> {
  try {
    const preferences = await getPreferences();
    return asBriefLength(preferences.briefLength).length;
  } catch (error) {
    console.error("today: could not read the preferred brief length", error);
    return FALLBACK_BRIEF_LENGTH;
  }
}
