import { BriefList } from "@/components/today/brief-list";
import { ReadingMode } from "@/components/today/reading-mode";
import { EmptyState, PageShell } from "@/components/page-shell";
import { LocalDate } from "@/components/local-date";
import { briefSummary } from "@/lib/api/brief-summary";
import { loadBrief } from "@/lib/api/brief-server";
import { defaultBriefLength } from "@/lib/api/brief-length";
import type { BriefLengthParam } from "@/lib/api/types";

const LENGTHS: BriefLengthParam[] = ["5", "10", "all"];

/** Null when the reader has not chosen a length for this visit, so the caller
 *  can fall back to the one they saved rather than to a constant. */
function parseLength(value: string | string[] | undefined): BriefLengthParam | null {
  const first = Array.isArray(value) ? value[0] : value;
  return LENGTHS.includes(first as BriefLengthParam) ? (first as BriefLengthParam) : null;
}

export default async function TodayPage({ searchParams }: PageProps<"/">) {
  // From #16: the stored preference is the default, ?length= overrides it for
  // one visit. defaultBriefLength has its own catch and answers ten minutes
  // when preferences cannot be read, so it cannot be the thing that throws
  // below — an unreachable database shows the unreachable screen, not a page
  // that failed while deciding how long it should be.
  const chosen = parseLength((await searchParams).length);
  const length = chosen ?? (await defaultBriefLength());

  /**
   * THREE STATES, and two of them must never look alike.
   *
   *   stories        — the brief
   *   count === 0    — a quiet morning: the worker ran and nothing arrived
   *   the call threw — we could not reach the stories at all
   *
   * An empty database and an unreachable one both produce "no stories" if you
   * only look at the length of an array. They are not the same thing: one means
   * nothing happened, the other means we do not know what happened. Without
   * this catch the third state is an unhandled error and the reader gets the
   * framework's crash page instead of a screen anyone designed.
   */
  let brief: Awaited<ReturnType<typeof loadBrief>> | null = null;
  let unreachable = false;
  try {
    brief = await loadBrief(length);
  } catch (error) {
    // Logged, never rendered. The driver's message is the failed SQL including
    // column names: meaningless to the person looking at the screen, and not
    // something a page should put in front of them — a connection error can
    // also carry the host and the credentials out of DATABASE_URL onto a page
    // somebody screenshots. The screen says what to check; the server log says
    // what broke. Every surface added in #16 answers a failed read the same
    // way, so this is now the app's rule rather than this page's habit.
    console.error("[today] could not load the brief", error);
    unreachable = true;
  }

  if (!brief) {
    return (
      <PageShell
        eyebrow={<LocalDate />}
        title="Good morning"
        summary={<span>Your stories are out of reach</span>}
        state="unreachable"
      >
        <EmptyState
          title="Cannot reach your stories"
          body={
            "The app is running but it could not read the story database, so this is not " +
            "a quiet morning — it is a missing answer. Check that the database is running " +
            "and that DATABASE_URL points at it, then reload. The reason is in the server log."
          }
        />
      </PageShell>
    );
  }

  const summary = briefSummary(brief);

  return (
    <PageShell
      eyebrow={<LocalDate />}
      title="Good morning"
      summary={
        brief.count === 0 ? (
          <span>Nothing in this brief yet</span>
        ) : (
          <span className="tabular-nums">
            {summary.count}
            {summary.minutes ? ` · ${summary.minutes}` : null}
            {summary.unread ? ` · ${summary.unread}` : null}
            {/* The brief always returns at least one story, so a single long
                story can exceed the chosen budget. Say so rather than let the
                number look like an arithmetic error. */}
            {summary.overBudget ? (
              <span className="text-ash block text-[13px]">{summary.overBudget}</span>
            ) : null}
          </span>
        )
      }
      controls={<ReadingMode current={length} />}
      state={brief.count === 0 ? "quiet" : "brief"}
    >
      {brief.count === 0 ? (
        <EmptyState
          title="No brief yet"
          body={`Nothing has arrived since your brief window opened at ${brief.window.briefTime}. The database answered, so this is a quiet morning rather than a fault. It fills as soon as the worker's next sweep finds something.`}
        />
      ) : (
        <BriefList stories={brief.stories} />
      )}
    </PageShell>
  );
}
