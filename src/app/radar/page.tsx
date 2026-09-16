import type { Metadata } from "next";
import { EmptyState, PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Live Radar" };

export default function RadarPage() {
  return (
    <PageShell
      eyebrow="Everything arriving"
      title="Live Radar"
      summary="Every item as it lands, newest first."
    >
      <EmptyState
        title="Nothing has arrived yet"
        body="Radar shows the raw feed rather than the ranked brief. It fills as soon as sources are configured and the worker completes its first sweep."
      />
    </PageShell>
  );
}
