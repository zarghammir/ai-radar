"use client";

import { SaveStatusText, Section, useSaveStatus } from "@/components/settings/section";
import { TopicChips } from "@/components/settings/topic-chips";
import { savePreferences } from "@/lib/api/preferences-store";
import type { Preferences, TopicSummary } from "@/lib/api/types";

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
          The list of subjects could not be read just now. Whatever you already follow is untouched
          — reload the page to try again.
        </p>
      ) : topics.length === 0 ? (
        <p className="border-faint-2 text-soft border border-dashed p-4 text-[14px] leading-relaxed">
          There are no subjects yet. They appear as the app collects stories and works out what they
          are about, so this fills in on its own.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <TopicChips topics={topics} chosen={chosen} onToggle={toggle} />

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
