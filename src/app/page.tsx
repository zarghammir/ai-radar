import { BriefList } from "@/components/today/brief-list";
import { ReadingMode } from "@/components/today/reading-mode";
import { ViewFilter } from "@/components/today/view-filter";
import { EmptyState, PageShell } from "@/components/page-shell";
import { LocalDate } from "@/components/local-date";
import { briefSummary, emptyBriefReason } from "@/lib/api/brief-summary";
import { loadBrief } from "@/lib/api/brief-server";
import { defaultBriefLength, defaultView } from "@/lib/api/brief-length";
import { parseView } from "@/lib/api/views";
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
  const params = await searchParams;
  const chosen = parseLength(params.length);
  const length = chosen ?? (await defaultBriefLength());

  // The URL is this visit's answer; the cookie is what this device chose last
  // time; "built" is the app's answer for a reader who has said nothing. Same
  // three-step shape as the length above, and the same reason the durable half
  // is a cookie: this page is rendered on the server and filters in the query,
  // so the view has to arrive before the device runs any JavaScript.
  const view = parseView(params.view) ?? (await defaultView());

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
  // `brief` staying null IS the third state. There was a second `unreachable`
  // flag here after the rebase, left over from the version of this screen that
  // printed the driver's message; with that gone it recorded a fact nothing
  // read. A clean line-merge can leave code that compiles and means nothing.
  let brief: Awaited<ReturnType<typeof loadBrief>> | null = null;
  try {
    brief = await loadBrief(length, view);
  } catch (error) {
    // Logged, never rendered. The driver's message is the failed SQL including
    // column names: meaningless to the person looking at the screen, and not
    // something a page should put in front of them — a connection error can
    // also carry the host and the credentials out of DATABASE_URL onto a page
    // somebody screenshots. The screen says what to check; the server log says
    // what broke. Every surface added in #16 answers a failed read the same
    // way, so this is now the app's rule rather than this page's habit.
    console.error("[today] could not load the brief", error);
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
  const emptyReason = emptyBriefReason(brief);

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
      controls={
        <>
          <ViewFilter current={view} />
          <ReadingMode current={length} />
        </>
      }
      state={brief.count === 0 ? "quiet" : "brief"}
    >
      {brief.count === 0 ? (
        // WHY IT IS EMPTY, FROM THE COLLECTOR'S OWN RECORD (#148).
        //
        // This used to assert "the database answered, so this is a quiet
        // morning rather than a fault" — honest about what it had checked and
        // wrong about the cause. The owner read it on a day the collector had
        // written sixty-four stories. The screen argued him out of the truth.
        //
        // emptyBriefReason has four answers and one of them is actionable: if
        // things HAVE arrived since the window opened and none are here, the
        // reader is looking at a filter or a brief time in the wrong timezone,
        // not at a quiet day. The kind is in the DOM so a check can assert
        // WHICH case without matching prose.
        <div data-empty-reason={emptyReason.kind}>
          <EmptyState title={emptyReason.title} body={emptyReason.body} />
        </div>
      ) : (
        <BriefList stories={brief.stories} />
      )}
    </PageShell>
  );
}
