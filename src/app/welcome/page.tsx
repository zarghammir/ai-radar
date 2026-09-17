import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { loadTopics } from "@/lib/api/catalogue-server";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { brand } from "@/config/brand";

export const metadata: Metadata = { title: "Welcome" };

/**
 * Rendered per request, never prerendered.
 *
 * This page READS THE TOPIC CATALOGUE, which changes as the pipeline ingests.
 * Without this Next prerenders it at build time: the subject list would be
 * frozen at whatever the database held when the image was built, and on a
 * build with no DATABASE_URL — which is how this project's CI builds — the
 * read fails once and "the list of subjects could not be read" is baked into
 * a static page forever. Nothing would look wrong; the page would simply
 * always say that.
 */
export const dynamic = "force-dynamic";

/**
 * A real page rather than a dialog over Today.
 *
 * It can be reached on purpose afterwards, it is linked from Settings, and it
 * needs none of the focus-trapping a modal would — a first screen that steals
 * the keyboard from a stranger is a bad first impression of an app that means
 * to be careful.
 */
export default async function WelcomePage() {
  const topics = await loadTopics();

  return (
    <PageShell eyebrow={brand.name} title="Welcome">
      <div className="bg-paper text-ink p-5 lg:p-8">
        <OnboardingFlow topics={topics} />
      </div>
    </PageShell>
  );
}
