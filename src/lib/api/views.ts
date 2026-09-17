import { CONTENT_TYPES } from "@/db/schema";
import type { ContentType } from "@/lib/api/types";

/**
 * What leads when you open the app, and the one control that widens it.
 *
 * The owner ruled one feed and one filter rather than sections or pages:
 * "it's just a filter… set the fun part as a default". So the app opens on
 * things somebody BUILT, and one control widens it to everything stored.
 *
 * THERE IS NO THIRD POSITION AND THERE MUST NOT BE. While the fetch-time AI
 * gate is in place every stored story is already AI-matched, so an "AI only"
 * stop and "Everything" would return the IDENTICAL SET — a control whose two
 * positions produce the same rows is a lie about what it does. When #71 turns
 * that gate into a stored label it does not add a stop either; it widens what
 * "Everything" already contains, and the label stays true at both stages.
 */
export const BRIEF_VIEWS = ["built", "all"] as const;
export type BriefView = (typeof BRIEF_VIEWS)[number];

/**
 * Every content type has a side. A TOTAL Record, like CONTENT_TYPE_LABELS —
 * so a value added to the database is a compile error here rather than a story
 * that silently belongs to neither view and appears in nothing.
 *
 * RESEARCH sits with PAPER deliberately. Excluding one while including the
 * other splits a distinction THE READER CANNOT SEE: both render as a published
 * piece of work somebody did. A filter whose boundary is invisible reads as
 * randomness, and "why is this in and that out" is the question that destroys
 * trust in a default view.
 */
export const VIEW_OF: Record<ContentType, BriefView> = {
  // Things somebody built.
  MODEL: "built",
  TOOL: "built",
  RELEASE: "built",
  PAPER: "built",
  RESEARCH: "built",
  // The reporting layer around them.
  NEWS: "all",
  DISCUSSION: "all",
  TREND: "all",
  BUSINESS: "all",
  REGULATION: "all",
};

/** The types a view shows. "all" is everything stored, not a second list. */
export function typesForView(view: BriefView): readonly ContentType[] {
  if (view === "all") return CONTENT_TYPES;
  return CONTENT_TYPES.filter((type) => VIEW_OF[type] === view);
}

/** Null when the caller expressed no view, so a caller can fall back to the
 *  reader's own choice rather than to a constant. */
export function parseView(value: string | string[] | undefined | null): BriefView | null {
  const first = Array.isArray(value) ? value[0] : value;
  return BRIEF_VIEWS.includes(first as BriefView) ? (first as BriefView) : null;
}

/** What the two positions say, and what the reader is told when one is empty. */
export const VIEW_LABELS: Record<BriefView, { label: string; hint: string }> = {
  built: {
    label: "Built",
    hint: "Models, tools, releases and papers — things somebody made.",
  },
  all: {
    label: "Everything",
    hint: "Adds the reporting around them: news, discussion, funding and policy.",
  },
};
