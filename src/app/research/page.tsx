import type { Metadata } from "next";
import { EmptyState, PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Research" };

export default function ResearchPage() {
  return (
    <PageShell
      eyebrow="Papers and preprints"
      title="Research"
      summary="arXiv and lab publications, filtered from the radar."
    >
      <EmptyState
        title="No papers yet"
        body="This is the radar narrowed to papers and preprints. It needs at least one research source enabled in Settings and one completed sweep."
      />
    </PageShell>
  );
}
