import { EmptyState, PageShell } from "@/components/page-shell";

export default function TodayPage() {
  return (
    <PageShell
      eyebrow="Wednesday morning"
      title="Good morning"
      summary="Your brief will appear here once the worker has run."
    >
      <EmptyState
        title="No brief yet"
        body="The ingestion worker has not run on this install. Once it has, this screen shows a ranked, bounded digest: five minutes, ten minutes, or everything, with a verification grade beside every story."
      />
    </PageShell>
  );
}
