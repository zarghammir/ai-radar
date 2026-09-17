import { BriefList } from "@/components/today/brief-list";
import { ReadingMode } from "@/components/today/reading-mode";
import { EmptyState, PageShell } from "@/components/page-shell";
import { LocalDate } from "@/components/local-date";
import { briefSummary } from "@/lib/api/brief-summary";
import { getBrief, USING_FIXTURES } from "@/lib/api/client";
import type { BriefLengthParam } from "@/lib/api/types";

const LENGTHS: BriefLengthParam[] = ["5", "10", "all"];

function parseLength(value: string | string[] | undefined): BriefLengthParam {
  const first = Array.isArray(value) ? value[0] : value;
  return LENGTHS.includes(first as BriefLengthParam) ? (first as BriefLengthParam) : "10";
}

export default async function TodayPage({ searchParams }: PageProps<"/">) {
  const length = parseLength((await searchParams).length);
  const brief = await getBrief(length);
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
    >
      {brief.count === 0 ? (
        <EmptyState
          title="No brief yet"
          body={
            USING_FIXTURES
              ? "The ingestion worker has not run on this install. Once it has, this screen shows a ranked, bounded digest with a verification grade beside every story."
              : `Nothing arrived in the window that opened at ${brief.window.briefTime}. The worker keeps checking; this fills as soon as a sweep finds something.`
          }
        />
      ) : (
        <BriefList stories={brief.stories} />
      )}
    </PageShell>
  );
}
