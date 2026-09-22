import type { StoryDetail } from "@/api/stories";

/**
 * The story's own words, and an honest account of why they may be missing.
 *
 * THREE STATES, NOT TWO. #138 shipped the summariser switched OFF, so almost
 * every story in the database has no summary — and "no summary" is three
 * different facts:
 *
 *   summarizedAt null                  nobody has tried: no provider configured
 *   summarizedAt set, summary null     tried, and it produced nothing
 *   summarizedAt set, summary present  done
 *
 * Collapsing the first two into "no summary" is the absence-versus-failure
 * defect. "We have not looked at this yet" and "we looked and could not" are
 * different answers, and only the second is a reason to distrust the page. A
 * reader who sees an excerpt where a summary should be deserves to know which
 * one they are looking at.
 *
 * In every case the EXCERPT carries the page. Falling back to it is what the
 * card already does, and it is why the summariser being off is a thinner page
 * rather than a broken one.
 */
export function SummaryBlock({ story }: { story: StoryDetail }) {
  const summarised = story.summary !== null;
  const tried = story.summarizedAt !== null;
  const body = story.summary ?? story.excerpt;

  return (
    <section
      className="mt-4"
      data-summary-state={summarised ? "summarised" : tried ? "failed" : "never-tried"}
    >
      {body ? (
        <p className="text-[16px] leading-[1.55]">{body}</p>
      ) : (
        <p className="text-ash text-[15px]">This story has no summary and no excerpt yet.</p>
      )}

      {/* Said once, quietly, and only when the words above are not the
          summariser's. A reader comparing two stories should be able to tell
          why one reads fuller than the other. */}
      {!summarised ? (
        <p className="text-ash mt-2 text-[12.5px]">
          {tried
            ? "The summariser ran on this story and produced nothing, so the text above is the source's own excerpt."
            : "Not summarised — no summariser is configured, so the text above is the source's own excerpt."}
        </p>
      ) : null}

      {story.whyItMatters ? (
        <div className="border-faint mt-4 border-t pt-3">
          <b className="font-label text-soft block text-[10.5px] font-bold tracking-[0.18em] uppercase">
            Why it matters
          </b>
          <p className="mt-1 text-[14.5px] leading-[1.48]">{story.whyItMatters}</p>
        </div>
      ) : null}

      {/* Absent rather than empty: a labelled heading over nothing is worse
          than no heading, and key points are empty for every unsummarised
          story, which is currently almost all of them. */}
      {story.keyPoints.length > 0 ? (
        <div className="border-faint mt-4 border-t pt-3">
          <b className="font-label text-soft block text-[10.5px] font-bold tracking-[0.18em] uppercase">
            Key points
          </b>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[14.5px] leading-[1.45]">
            {story.keyPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
