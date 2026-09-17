import type { Metadata } from "next";
import { EmptyState, PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Saved" };

export default function SavedPage() {
  return (
    <PageShell eyebrow="The bin" title="Saved" summary="Nothing on the pins yet.">
      <EmptyState
        title="Nothing saved"
        body="Open a story and press Save, and it hangs here until you take it down. Saved stories keep their grade and their link to the original."
      />
    </PageShell>
  );
}
