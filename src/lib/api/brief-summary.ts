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
