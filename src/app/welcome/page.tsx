import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { brand } from "@/config/brand";
import { getTopics } from "@/lib/api/client";
import type { TopicSummary } from "@/lib/api/types";

export const metadata: Metadata = { title: "Welcome" };

/**
 * `null` means the catalogue could not be READ, which is a different answer
 * from an empty list. The last step says something different for each.
 */
async function loadTopics(): Promise<TopicSummary[] | null> {
  try {
    return await getTopics();
  } catch (error) {
    console.error("welcome: could not read the topic catalogue", error);
    return null;
  }
}

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
