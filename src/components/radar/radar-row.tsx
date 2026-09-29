import Link from "next/link";
import { ContentTypeBadge, VerificationChip } from "@/components/story/badges";
import { StoryActions } from "@/components/story/story-actions";
import { alsoReportedBy } from "@/lib/api/labels";
import type { StoryCard } from "@/lib/api/types";

function arrived(iso: string) {
  const at = new Date(iso);
  return {
    label: at.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    iso,
  };
}

/**
 * ONE ARRIVAL, ONE LINE. The firehose, not the brief.
 *
 * Deliberately not StoryCardView. Today is a short ranked read where the lead
 * story is drawn large and the excerpt is part of the point; Radar is
 * everything that landed, and a page of full cards is four stories per screen
 * — which is the same as not having a feed. So: no excerpt, no entry number,
 * no size hierarchy. Every row is equal, because on this screen they ARE:
 * arrival order is the subject, and drawing one larger would assert an
 * importance that the default sort does not claim.
 *
 * The badges and the actions ARE shared with the card, because those are
 * claims about the story rather than decisions about this screen. A second
 * verification chip drawn locally is how the picture and the word drift apart,
 * and a second save button is how one of them ends up not writing anything.
 */
export function RadarRow({ story }: { story: StoryCard }) {
  const others = alsoReportedBy(story);
  const seen = arrived(story.firstSeenAt);

  return (
    <article
      data-story-id={story.id}
      className="border-edge bg-paper text-ink mr-4 border-b px-4 py-3 last:border-b-0 lg:mr-0"
    >
      <div className="flex items-center gap-3">
        <ContentTypeBadge type={story.contentType} />
        <VerificationChip level={story.verification} />
      </div>

      <h2 className="mt-1.5 text-[17px] leading-[1.28] font-semibold tracking-[-0.012em]">
        <a
          href={story.url}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-visible:ring-org rounded-xs hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        >
          {story.title}
        </a>
      </h2>

      <div className="text-meta mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] tabular-nums">
        <b className="text-ink font-bold">{story.primarySource.name}</b>
        {others ? (
          <>
            <span>·</span>
            <span>{others}</span>
          </>
        ) : null}
        <span>·</span>
        {/* THE TIME IT ARRIVED HERE, with the date, and it says which. Today
            shows a bare clock because everything on it landed today; this feed
            runs back a week or a month, so a bare "09:14" would be read as
            this morning. */}
        <time dateTime={seen.iso}>{seen.label}</time>
        <span>·</span>
        <span>{story.readingMinutes} min</span>
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

      <StoryActions story={story} />
    </article>
  );
}
