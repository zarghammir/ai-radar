import type { Metadata } from "next";
import { EmptyState, PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Releases" };

export default function ReleasesPage() {
  return (
    <PageShell
      eyebrow="Models and products"
      title="Releases"
      summary="What shipped, from the companies that shipped it."
    >
      <EmptyState
        title="No releases yet"
        body="This is the radar narrowed to model and product releases. Company blogs are the primary sources here, so items will usually arrive graded Primary source."
      />
    </PageShell>
  );
}
