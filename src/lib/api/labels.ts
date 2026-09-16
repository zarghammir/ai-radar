import { CONTENT_TYPES, VERIFICATION_LEVELS } from "@/db/schema";
import type { ContentType, VerificationLevel } from "@/lib/api/types";

/**
 * Every content type has a label. ALL TEN — the prototype only ever drew six,
 * and a badge that falls through to a blank for the other four is the
 * absence-shaped defect in visual form: the reader cannot tell "no category"
 * from "a category nobody wrote a label for".
 *
 * The test derives its list from CONTENT_TYPES itself, so adding a value to the
 * database without a label here fails rather than shipping a blank badge.
 */
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  NEWS: "News",
  RELEASE: "Release",
  RESEARCH: "Research",
  DISCUSSION: "Discussion",
  TREND: "Trend",
  TOOL: "Tool",
  MODEL: "Model",
  PAPER: "Paper",
  BUSINESS: "Business",
  REGULATION: "Regulation",
};

/**
 * How well-sourced a story is: a four-segment meter AND the word, never one
 * without the other. `bars` is a rendering of the enum, not data from the
 * server — keeping the number out of the contract stops the picture and the
 * word drifting apart.
 */
export const VERIFICATION: Record<
  VerificationLevel,
  { bars: 1 | 2 | 3 | 4; word: string; meaning: string }
> = {
  PRIMARY_SOURCE: {
    bars: 4,
    word: "Primary source",
    meaning: "The company, lab or author published it themselves.",
  },
  CORROBORATED: {
    bars: 3,
    word: "Corroborated",
    meaning: "Two or more independent outlets report the same thing.",
  },
  EMERGING: {
    bars: 2,
    word: "Emerging",
    meaning: "One outlet so far. Probably true, not yet confirmed.",
  },
  UNVERIFIED: {
    bars: 1,
    word: "Unverified",
    meaning: "A rumour, a leak or an anonymous claim. Read it as such.",
  },
};

/** Exported so tests can assert coverage against the database's own list. */
export const ALL_CONTENT_TYPES = CONTENT_TYPES;
export const ALL_VERIFICATION_LEVELS = VERIFICATION_LEVELS;

/**
 * The text a card shows. `summary` is null until the Phase 2 summariser lands,
 * so this falls back to `excerpt` — the contract states that twice because a
 * client that renders `summary` alone shows empty cards on every story in
 * Phase 1. Returns null when there is genuinely nothing, so the caller can omit
 * the paragraph rather than render an empty one.
 */
export function storyBody(story: {
  summary: string | null;
  excerpt: string | null;
}): string | null {
  const text = story.summary ?? story.excerpt;
  if (!text) return null;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * "+N others" beside the primary source, or NOTHING when one outlet is the only
 * source — including when that outlet filed twice, because `sources` is
 * de-duplicated and `sourceCount` counts distinct sources. "+0 others" is a
 * sentence about nothing.
 */
export function alsoReportedBy(story: { sourceCount: number }): string | null {
  const others = story.sourceCount - 1;
  if (others < 1) return null;
  return others === 1 ? "+1 other" : `+${others} others`;
}
