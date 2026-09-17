import type { ReactNode } from "react";
import { ContentTypeBadge, VerificationChip } from "@/components/story/badges";
import { StoryActions } from "@/components/story/story-actions";
import { alsoReportedBy, storyBody } from "@/lib/api/labels";
import type { StoryCard as Story } from "@/lib/api/types";

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
  const body = storyBody(story);
  const others = alsoReportedBy(story);

  return (
    <article className="flex items-stretch">
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
        <div className="mb-2 flex items-center gap-3">
          <ContentTypeBadge type={story.contentType} />
          <VerificationChip level={story.verification} />
        </div>

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

        {/* summary is null for every story until the Phase 2 summariser lands,
            so this is the excerpt in practice. Rendering summary alone would
            show an empty card for the whole brief. */}
        {body ? <p className="text-soft mt-2 text-[15px] leading-[1.5]">{body}</p> : null}

        {/* Null until the summariser lands. The block is absent rather than
            empty — a labelled heading over nothing is worse than no heading. */}
        {story.whyItMatters ? (
          <div className="border-faint mt-3 border-t pt-3">
            <b className="font-label text-soft block text-[10.5px] font-bold tracking-[0.18em] uppercase">
              Why it matters
            </b>
            <p className="mt-1 text-[14.5px] leading-[1.48]">{story.whyItMatters}</p>
          </div>
        ) : null}

        <div className="text-meta mt-3 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] tabular-nums">
          <b className="text-ink font-bold">{story.primarySource.name}</b>
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
          <span>·</span>
          <span>{story.readingMinutes} min</span>
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
