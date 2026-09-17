"use client";

import { groupTopics } from "@/lib/api/preferences";
import type { TopicSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * The subjects the app knows about, as chips the reader can turn on and off.
 *
 * Shared by Settings and first-run onboarding on purpose: the same grid, the
 * same grouping and the same counts in both places. Two copies would drift,
 * and the one a stranger sees first is the one least likely to be maintained.
 */
export function TopicChips({
  topics,
  chosen,
  onToggle,
}: {
  topics: TopicSummary[];
  chosen: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {groupTopics(topics).map((group) => (
        <fieldset key={group.key}>
          <legend className="font-label text-soft text-[10.5px] font-bold tracking-[0.18em] uppercase">
            {group.heading}
          </legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {group.topics.map((topic) => {
              const on = chosen.has(topic.key);
              return (
                <button
                  key={topic.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(topic.key)}
                  className={cn(
                    "focus-visible:ring-org flex items-center gap-1.5 rounded-xs border px-2.5 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none",
                    on ? "bg-ink text-paper border-ink" : "border-faint-2 text-soft hover:bg-faint",
                  )}
                >
                  {topic.name}
                  {/* 0 is a real answer — this subject has been quiet — and is
                      shown rather than hidden, so a reader can tell a quiet
                      subject from one the app has never seen. */}
                  <span
                    className={cn(
                      "font-mono text-[10.5px] tabular-nums",
                      on ? "text-paper/70" : "text-meta",
                    )}
                  >
                    {topic.storyCount}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
