"use client";

import { SaveStatusText, Section, useSaveStatus } from "@/components/settings/section";
import { savePreferences } from "@/lib/api/preferences-store";
import { OTHER_TOPIC_GROUP, TOPIC_GROUPS } from "@/lib/api/preferences";
import type { Preferences, TopicSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * What the reader cares about.
 *
 * Chosen topics RAISE a story's score; they never filter. Nothing is kept out
 * for lacking one, which is why the words below say "pushes up" and not
 * "shows only" — a reader who picks three topics and then sees a fourth
 * subject in their brief should understand that as the product working, not
 * failing. See the topicMatch term in src/pipeline/ranking/score.ts.
 */
export function InterestsSection({
  preferences,
  topics,
}: {
  preferences: Preferences;
  /** null when the catalogue could not be read — a different fact from none. */
  topics: TopicSummary[] | null;
}) {
  const { status, run } = useSaveStatus();
  const chosen = new Set(preferences.topicKeys);

  function toggle(key: string) {
    const next = new Set(chosen);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    void run(() => savePreferences({ topicKeys: [...next] }));
  }

  return (
    <Section
      title="What you follow"
      hint="Anything you follow is pushed up your brief. Nothing is filtered out — a big story in a subject you never picked still reaches you."
      status={<SaveStatusText status={status} what="what you follow" />}
    >
      {topics === null ? (
        <p className="border-faint-2 text-soft border border-dashed p-4 text-[14px] leading-relaxed">
          The list of subjects could not be read just now. Whatever you already follow is
          untouched — reload the page to try again.
        </p>
      ) : topics.length === 0 ? (
        <p className="border-faint-2 text-soft border border-dashed p-4 text-[14px] leading-relaxed">
          There are no subjects yet. They appear as the app collects stories and works out what
          they are about, so this fills in on its own.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {groupsOf(topics).map((group) => (
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
                      onClick={() => toggle(topic.key)}
                      className={cn(
                        "focus-visible:ring-org flex items-center gap-1.5 rounded-xs border px-2.5 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none",
                        on ? "bg-ink text-paper border-ink" : "border-faint-2 text-soft hover:bg-faint",
                      )}
                    >
                      {topic.name}
                      {/* 0 is a real answer — this subject has been quiet —
                          and is shown rather than hidden, so a reader can tell
                          a quiet subject from one the app has never seen. */}
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

          <p className="text-meta text-[12.5px]">
            {chosen.size === 0
              ? "You follow nothing in particular, so every subject is weighed the same."
              : `${chosen.size} followed. The number beside each is how many stories it carried lately.`}
          </p>
        </div>
      )}
    </Section>
  );
}

/**
 * Buckets the catalogue for display.
 *
 * A topic whose group this build does not recognise goes into "Everything
 * else" rather than being dropped: a subject that exists and is not shown is a
 * subject the reader cannot choose or unchoose, and they would have no way of
 * knowing it was there. Empty buckets are omitted — a heading over nothing
 * says less than no heading.
 */
function groupsOf(topics: TopicSummary[]) {
  const known = new Set<string>(TOPIC_GROUPS.map((g) => g.key));
  const buckets = [...TOPIC_GROUPS, OTHER_TOPIC_GROUP].map((group) => ({
    key: group.key,
    heading: group.heading,
    topics: topics.filter((t) =>
      group.key === OTHER_TOPIC_GROUP.key ? !known.has(t.group) : t.group === group.key,
    ),
  }));
  return buckets.filter((bucket) => bucket.topics.length > 0);
}
