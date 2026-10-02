import type { ReactNode } from "react";
import { StoryActions } from "@/components/story/story-actions";
import { CONTENT_TYPE_LABELS } from "@/lib/api/labels";
import { alsoReportedBy } from "@/lib/api/labels";
import type { StoryCard as Story } from "@/lib/api/types";
import Link from "next/link";

function detectedAt(iso: string) {
  // The time this app first SAW it, which is a different question from when it
  // was published. Both are on the card for that reason.
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * One story on paper, on the bench.
 *
 * `actions` and `footer` are slots so that Saved can put its own controls on
 * the same card instead of a second card drifting away from this one. Both
 * default to nothing extra, so Today is untouched by their existence.
 */
export function StoryCardView({
  story,
  rank,
  lead,
  actions,
  footer,
}: {
  story: Story;
  rank: number;
  lead: boolean;
  /** Replaces the default Save/Share/Hide row. */
  actions?: ReactNode;
  /** Sits below the actions. Used for the reader's note and tags. */
  footer?: ReactNode;
}) {
  const others = alsoReportedBy(story);

  return (
    // data-story-id is how the browser-driven scripts know WHICH stories are
    // on the page. They seed the reader's saved list from it rather than from
    // a list of ids typed into the script, which would silently stop matching
    // the day a fixture changed and leave every assertion measuring an empty
    // screen.
    <article data-story-id={story.id} className="flex items-stretch">
      {/* The rail carries the entry number. Importance is card SIZE, not a
          separate indicator — the design the owner approved shows the lead
          story larger rather than decorating it. */}
      <div
        aria-hidden
        className="w-rail relative shrink-0"
        style={{
          background: "repeating-linear-gradient(180deg, transparent 0 9px, var(--edge) 9px 18px)",
        }}
      >
        <span className="bg-background text-ash absolute top-2.5 right-0 left-0 px-0 py-1 text-center font-mono text-[11px] font-bold">
          {String(rank).padStart(2, "0")}
        </span>
      </div>

      <div className="bg-paper text-ink mr-4 mb-3 flex-1 p-4 lg:mr-0">
        <h2
          className={
            lead
              ? "text-[25px] leading-[1.16] font-bold tracking-[-0.014em] text-balance"
              : "text-[20px] leading-[1.22] font-semibold tracking-[-0.014em] text-balance"
          }
        >
          <a
            href={story.url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-visible:ring-org rounded-xs hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
          >
            {story.title}
          </a>
        </h2>

        {/* ONE LINE, OR NOTHING. The owner asked for "title and one line
            summary" and the honest version of that is a line WRITTEN to be one,
            not a paragraph cut to length — the first sentence of an arXiv
            abstract reads "As robotic hardware and learning methods advance,
            humanoids need tools to perform tasks beyond their inhere…", which
            is worse than silence.

            So this renders story.oneLine and NOTHING ELSE. Today that field is
            null everywhere, so every card is title-only, which is Option A and
            is a complete card on its own. As the summariser starts writing the
            field the lines appear underneath, story by story, with no further
            change here. #191 is that work. */}
        {story.oneLine ? (
          <p className="text-soft mt-1.5 text-[14px] leading-[1.45]">{story.oneLine}</p>
        ) : null}

        <div className="text-meta mt-3 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] tabular-nums">
          <b className="text-ink font-bold">{story.primarySource.name}</b>
          {/* THE TYPE SURVIVED THE BADGE. Both badges came off the card, but
              only one of them was the owner's objection: "Primary source" is
              gone for good. The content type still answers "is this a paper or
              a funding round", which is the difference between two titles that
              look alike, so it moved here as a word rather than a chip. */}
          <span>·</span>
          <span>{CONTENT_TYPE_LABELS[story.contentType]}</span>
          {/* NOTHING when one outlet is the only source, including when it filed
              twice. "+0 others" is a sentence about nothing. */}
          {others ? (
            <>
              <span>·</span>
              <span>{others}</span>
            </>
          ) : null}
          <span>·</span>
          <span>{detectedAt(story.firstSeenAt)}</span>
          {/* THE SECOND LINK, AND IT IS ABSENT RATHER THAN DISABLED (#84).
              The standing rule that a gated control stays visible and says why
              is for a control the reader could EARN — a thing they cannot do
              yet. This is different: for most stories there is no discussion
              to link to and there never will be, so a greyed "Discussion" would
              describe nothing. An affordance for something that does not exist
              is not honesty, it is furniture.

              The title above links to the thing; this links to the argument
              about it. The accessible name carries the story's title because a
              reader tabbing a brief would otherwise hear "Discussion" a dozen
              times with nothing to tell them apart. */}
          {/* THE WAY IN TO PROVENANCE (#15). The title still links OUT to the
              article, because that is what a reader taps when they want to
              read the thing — changing it would hijack the primary action and
              make every existing habit and screenshot wrong. This is the
              second question, "where did this come from", and it gets its own
              affordance rather than taking over the first. */}
          <span>·</span>
          <Link
            href={`/story/${story.slug}`}
            aria-label={`Sources for ${story.title}`}
            className="focus-visible:ring-org rounded-xs underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:outline-none"
          >
            Sources
          </Link>
          {story.discussionUrl ? (
            <>
              <span>·</span>
              <a
                href={story.discussionUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Discussion of ${story.title}`}
                className="focus-visible:ring-org rounded-xs underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:outline-none"
              >
                Discussion
              </a>
            </>
          ) : null}
        </div>

        {actions ?? <StoryActions story={story} />}

        {/* empty:hidden on the CONTAINER. An element is always truthy, so a
            `footer` whose component returns null would still draw this div and
            its top margin; the ternary cannot see that. */}
        {footer ? <div className="mt-3 empty:hidden">{footer}</div> : null}
      </div>
    </article>
  );
}
