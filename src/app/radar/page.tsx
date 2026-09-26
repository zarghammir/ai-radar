import type { Metadata } from "next";
import { EmptyState, PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Live Radar" };

/**
 * NOT BUILT YET, AND THE SCREEN NOW SAYS SO.
 *
 * This page has never queried anything — it renders a fixed panel. What it
 * used to say was: "It fills as soon as sources are configured and the worker
 * completes its first sweep."
 *
 * EVERY CONDITION IN THAT SENTENCE WAS ALREADY SATISFIED. Sources are
 * configured, sweeps complete on schedule, and /api/radar answers with the
 * stories — fifteen of them on the day the owner read this panel and told us
 * the section was empty. So the copy named a remedy he had already completed
 * and promised an outcome that could never arrive, which left him only one
 * available conclusion: something is broken.
 *
 * It is this project's usual defect with the polarity reversed. Normally we
 * report an absence as an emptiness; here the screen reported UNBUILT as
 * PENDING. That is worse, because waiting is a reasonable thing to ask of
 * someone and it costs them nothing to notice they are doing it forever.
 *
 * THE RULE THIS FOLLOWS is the one already settled for gated controls: the
 * thing stays VISIBLE and SAYS WHY. "Not built yet" is the honest why. The
 * page keeps its place in the navigation because Radar is a real part of the
 * product and hiding it would be a second kind of lie.
 *
 * #14 builds it. The API it will read already exists and already works, which
 * is worth saying on the screen: the data is not missing, the page is.
 */
export default function RadarPage() {
  return (
    <PageShell
      eyebrow="Everything arriving"
      title="Live Radar"
      summary="The raw feed, newest first — not built yet."
    >
      <EmptyState
        title="This page is not built yet"
        body="Radar will show every item as it lands, rather than the ranked brief on Today. It is not waiting on your sources or on a sweep — those are working, and the stories are already being collected. The screen itself is the part that has not been built. Issue #14 is where it gets made."
      />
    </PageShell>
  );
}
