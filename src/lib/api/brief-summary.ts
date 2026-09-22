import type { BriefResponse } from "@/lib/api/types";

export interface BriefSummary {
  /** "8 stories" / "1 story" / "Nothing yet" */
  count: string;
  /** "9 minutes" — omitted when the brief is empty. */
  minutes: string | null;
  /** How many of them you have not read, or null when that is all of them. */
  unread: string | null;
  /**
   * Set ONLY when the brief runs longer than the selected budget, which the
   * contract allows on purpose: a brief always returns at least one story, so a
   * single long story can exceed a five-minute setting.
   *
   * Without this the header reads "1 story, 6 min" under a 5-minute selector
   * and looks like an arithmetic error. The interface states its reasoning
   * rather than leaving the reader to infer it — the same principle as showing
   * the word beside the trust meter.
   */
  overBudget: string | null;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function briefSummary(brief: BriefResponse): BriefSummary {
  if (brief.count === 0) {
    return { count: "Nothing yet", minutes: null, unread: null, overBudget: null };
  }

  const unreadCount = brief.stories.filter((s) => !s.read).length;

  // "Already seen" means per-story `read`; no brief delivery is recorded, so
  // there is nothing to compare against a previous morning.
  const unread = unreadCount === brief.count || unreadCount === 0 ? null : `${unreadCount} unread`;

  let overBudget: string | null = null;
  if (brief.length !== "all") {
    const budget = Number(brief.length);
    if (brief.readingMinutes > budget) {
      overBudget =
        `longer than your ${budget}-minute setting — the top story alone ` +
        `runs ${plural(brief.readingMinutes, "minute", "minutes")}`;
    }
  }

  return {
    count: plural(brief.count, "story", "stories"),
    minutes: plural(brief.readingMinutes, "minute", "minutes"),
    unread,
    overBudget,
  };
}

/** Which of the four reasons an empty brief is empty. Exposed to the DOM so a
 *  check can assert the CASE without matching prose that will be reworded. */
export type EmptyBriefKind = "no-collector" | "never-swept" | "quiet" | "arrived-but-filtered";

export interface EmptyBriefReason {
  kind: EmptyBriefKind;
  title: string;
  body: string;
}

const atTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * WHY THIS BRIEF IS EMPTY — four answers, not one (#148).
 *
 * The screen that caused this ticket said "the database answered, so this is a
 * quiet morning rather than a fault." True about what it had checked, wrong
 * about the cause: sixty-four stories had been collected that day. An empty
 * brief must never again be mistakable for a quiet one.
 *
 * THE CASE THAT MATTERS IS THE LAST. If the collector HAS written things since
 * the window opened and the brief is still empty, the reader is not looking at
 * a quiet morning — they are looking at a filter, or a brief time set to
 * somebody else's timezone. That is the only case where the screen can hand
 * them something to do, and it is the case the old copy actively argued them
 * out of.
 */
export function emptyBriefReason(brief: BriefResponse): EmptyBriefReason {
  const at = brief.window.briefTime;

  if (brief.sweep === null) {
    return {
      kind: "no-collector",
      title: "No brief yet",
      body:
        "This build is showing sample stories and has no collector behind it, so there is " +
        "nothing to gather. On the real site this is where your morning's stories appear.",
    };
  }

  if (brief.sweep.lastFinishedAt === null) {
    return {
      kind: "never-swept",
      title: "Nothing collected yet",
      body:
        "No sweep has finished yet, so nothing has been gathered — this is the collector not " +
        "having run rather than a quiet morning. It fills as soon as the first sweep completes.",
    };
  }

  const last = atTime(brief.sweep.lastFinishedAt);
  const n = brief.sweep.itemsSinceWindowOpened;

  if (n === 0) {
    return {
      kind: "quiet",
      title: "A quiet morning",
      body:
        `Nothing has arrived since your brief window opened at ${at}. The last sweep finished ` +
        `at ${last} and brought nothing new, so this is genuinely quiet rather than a fault.`,
    };
  }

  return {
    kind: "arrived-but-filtered",
    title: "Nothing here, but the day was not quiet",
    body:
      `${n} ${n === 1 ? "story has" : "stories have"} arrived since your brief window opened at ` +
      `${at} — the last sweep finished at ${last} — and none of them are in this view. Widen the ` +
      `filter above, or check your brief time and timezone in Settings if ${at} is not your morning.`,
  };
}
