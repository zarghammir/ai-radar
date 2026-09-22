import { notFound } from "next/navigation";
import { LocalDate } from "@/components/local-date";
import { PageShell } from "@/components/page-shell";
import { ContentTypeBadge, VerificationChip } from "@/components/story/badges";
import { StoryActions } from "@/components/story/story-actions";
import { MarkRead } from "@/components/story/mark-read";
import { StoryProvenance } from "@/components/story/story-provenance";
import { WhyRanked } from "@/components/story/why-ranked";
import { SummaryBlock } from "@/components/story/summary-block";
import { loadStory } from "@/lib/api/story-server";
import type { StoryCard } from "@/lib/api/types";

/**
 * One story, and where it came from.
 *
 * PROVENANCE IS THE SUBJECT, not a footnote. A story here is assembled from
 * several raw items across several sources, and until this page existed a
 * reader could not answer "where did this claim originally come from" — the
 * brief shows one link and a source count, which is a summary of provenance
 * rather than provenance.
 *
 * It reads the database through the same function the API route calls. See
 * loadStory for why a server component does not fetch its own API.
 */
export default async function StoryPage({ params }: PageProps<"/story/[slug]">) {
  const { slug } = await params;

  let story: Awaited<ReturnType<typeof loadStory>> = null;
  let reachable = true;
  try {
    story = await loadStory(slug);
  } catch (error) {
    // Logged, never rendered — the same rule Today follows. A driver's message
    // names columns and can carry the database host out of DATABASE_URL onto a
    // page somebody screenshots.
    console.error("[story] could not load", error);
    reachable = false;
  }

  // THE THREE OUTCOMES ARE THREE SCREENS, and two of them are not "empty".
  // A story that does not exist is a 404. A database that cannot be read is
  // NOT a missing story — telling a reader "no such story" when the truth is
  // "we could not look" is the absence-versus-failure defect on the one page
  // whose job is to be trusted about where things came from.
  if (!reachable) {
    return (
      <PageShell
        eyebrow={<LocalDate />}
        title="Good morning"
        summary={<span>This story is out of reach</span>}
        state="unreachable"
      >
        <div data-empty-state="true" className="border-edge text-ash border border-dashed p-6">
          <p className="text-ash-hi text-[15px] font-semibold">Cannot reach this story</p>
          <p data-empty-body="true" className="mt-2 max-w-prose text-[14px] leading-relaxed">
            The app is running but it could not read the story database, so this is not a missing
            story — it is a missing answer. Check that the database is running and that DATABASE_URL
            points at it, then reload. The reason is in the server log.
          </p>
        </div>
      </PageShell>
    );
  }

  if (!story) notFound();

  const published = story.publishedAt ? new Date(story.publishedAt) : null;

  return (
    <PageShell
      eyebrow={<LocalDate />}
      title={story.title}
      summary={
        story.primarySource ? (
          <span>
            {story.primarySource.name}
            {story.sourceCount > 1 ? ` and ${story.sourceCount - 1} other source(s)` : ""}
          </span>
        ) : undefined
      }
      state="brief"
    >
      {/* Marks the story read on open, which is what opening it means. It
          renders nothing; see the component for why it is not in an effect
          that also sets state. */}
      <MarkRead storyId={story.id} />

      {/* ON PAPER, LIKE A CARD, AND THIS IS NOT DECORATION. The shell is a
          dark BENCH surface; `text-ink` and the verification chip are PAPER
          tokens. Rendered straight onto the bench they came out dark on dark —
          the chip was an unreadable box and the source's own name was barely
          visible. The DOM was perfect: right elements, right text, right
          attributes. Only the picture showed it, which is why these get
          looked at rather than just taken. */}
      <div className="bg-paper text-ink mr-4 p-4 lg:mr-0">
        {/* THE BADGES BELONG ON PAPER TOO, and for the same reason as the body.
            The verification chip is built from PAPER tokens — text-ink inside a
            faint border — so on the dark shell it rendered as an unreadable box
            with a meter nobody could see. It reads correctly here, which is
            also where the card puts it. */}
        <div className="mb-3 flex items-center gap-3">
          <ContentTypeBadge type={story.contentType} />
          <VerificationChip level={story.verification} />
        </div>
        {story.verificationNote ? (
          <p className="text-soft border-faint border-l-2 pl-3 text-[14px] leading-relaxed">
            {story.verificationNote}
          </p>
        ) : null}

        <SummaryBlock story={story} />

        <StoryProvenance story={story} publishedAt={published} />

        <WhyRanked components={story.scoreComponents} total={story.score} />

        <div className="border-faint mt-6 border-t pt-4">
          <StoryActions story={story as unknown as StoryCard} />
        </div>
      </div>
    </PageShell>
  );
}
