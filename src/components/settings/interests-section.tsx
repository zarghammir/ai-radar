"use client";

import { X } from "lucide-react";
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

  /**
   * Subjects the reader follows that the catalogue no longer lists.
   *
   * They were valid when they were saved — the route checks every key it is
   * sent — so one can only appear because a topic was removed afterwards. Two
   * things go wrong if they are simply left out of the grid, and the second is
   * the serious one:
   *
   *  - the reader follows something they cannot see and cannot unfollow;
   *  - EVERY toggle then fails. Each write sends the whole list, the route
   *    rejects an unknown key, and the reader gets "unknown topic: …" for a
   *    subject they never chose in this session and cannot find on the page.
   *
   * So they are shown, and they can be taken off. Only computed against a
   * catalogue that was actually READ: when the read failed, every key would
   * look orphaned and the panel would offer to delete all of them.
   */
  const orphans =
    topics === null
      ? []
      : preferences.topicKeys.filter((key) => !topics.some((t) => t.key === key));

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

          {orphans.length > 0 ? (
            <div className="border-faint-2 border border-dashed p-3">
              <p className="text-soft text-[13px] leading-relaxed">
                You follow {orphans.length === 1 ? "one subject" : `${orphans.length} subjects`}{" "}
                this version no longer has. Taking {orphans.length === 1 ? "it" : "them"} off is the
                only thing left to do with {orphans.length === 1 ? "it" : "them"}.
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {orphans.map((key) => (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      className="focus-visible:ring-org border-faint-2 text-soft hover:bg-faint flex items-center gap-1.5 rounded-xs border px-2.5 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {key}
                      <X aria-hidden className="size-3.5" />
                      <span className="sr-only">— stop following</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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
