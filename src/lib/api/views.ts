import { CONTENT_TYPES } from "@/db/schema";
import { ApiError } from "@/api/http";
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
/**
 * WHAT EACH POSITION SHOWS, IN THE BUTTON ITSELF.
 *
 * THE OWNER REJECTED THE PREVIOUS PAIR: "Built" and "Everything", under a
 * sentence explaining the difference. His words were "it doesn't make sense to
 * have two kinds of filters up there and three filters down there." The
 * sentence was the tell — A CONTROL THAT NEEDS A LINE OF PROSE TO EXPLAIN
 * ITSELF IS MISNAMED, and there is no `hint` field any more because there is
 * nowhere honest to put one.
 *
 * "LAUNCHES" IS THE OWNER'S CHOICE, from three he was offered. The previous
 * version of this comment said "Built" stayed because it was HIS word — THAT
 * WAS FALSE, and it is recorded here rather than quietly overwritten because
 * it is the kind of claim that gets built on.
 *
 * What he actually said was "the fun part — the startups, the cool things".
 * "Built" was a lane's shorthand on a roadmap page, carried forward through
 * enough hands that it arrived as something he had chosen. He then looked at
 * the redesign and asked what "Built" meant.
 *
 * A LABEL THE OWNER HAS TO ASK ABOUT HAS FAILED, however good the hierarchy
 * around it — and none of that hierarchy changed, only this word.
 *
 * "Launches + news" makes the relationship the thing you read. It is visibly a
 * SUPERSET of the other position: same word, plus something. The `+` does what
 * an explanatory sentence used to do, in one character, inside the control.
 * "news" is the head of what is actually added — news, discussion, funding,
 * policy.
 *
 * Neither word appears in the reading-time control beside it, and the capture
 * script checks that against the RENDERED labels rather than trusting this
 * paragraph.
 */
export const VIEW_LABELS: Record<BriefView, { label: string }> = {
  built: { label: "Launches" },
  all: { label: "Launches + news" },
};

/**
 * The route's parser: an unrecognised value is REFUSED, never widened.
 *
 * This matches parseBriefLength, which throws VALIDATION_ERROR rather than
 * falling back — and it matches the rule #105 sets for its own axis, that an
 * unknown value must never silently open the front door. Refusing is the
 * strictest form of that: nothing is opened at all.
 *
 * Absent is a different answer from unrecognised, and the two are deliberately
 * not collapsed. No ?view= at all means the caller expressed no view, and the
 * route answers what it answered before #102 — everything stored. A ?view=
 * this build does not know is a caller asking for something specific that does
 * not exist, and it gets told.
 */
export function parseViewOrThrow(raw: string | null, fallback: BriefView): BriefView {
  if (raw === null) return fallback;
  const parsed = parseView(raw);
  if (!parsed) {
    throw new ApiError("VALIDATION_ERROR", `view must be one of ${BRIEF_VIEWS.join(", ")}`);
  }
  return parsed;
}
