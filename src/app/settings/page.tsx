import type { Metadata } from "next";
import { brand } from "@/config/brand";
import { PageShell } from "@/components/page-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { InstallPrompt } from "@/components/install-prompt";
import { PreferenceSections } from "@/components/settings/preference-sections";
import { getTopics } from "@/lib/api/client";
import type { TopicSummary } from "@/lib/api/types";

export const metadata: Metadata = { title: "Settings" };

const GRADES = [
  { bars: 4, word: "Primary source", def: "The company, lab or author published it themselves." },
  { bars: 3, word: "Corroborated", def: "Two or more independent outlets report the same thing." },
  { bars: 2, word: "Emerging", def: "One outlet so far. Probably true, not yet confirmed." },
  { bars: 1, word: "Unverified", def: "A rumour, a leak or an anonymous claim. Read it as such." },
];

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-paper text-ink p-5">
      <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
      {hint ? <p className="text-soft mt-2 text-[13px] leading-relaxed">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * The catalogue of subjects, read on the server.
 *
 * `null` means the read FAILED and is a different answer from an empty list,
 * which means there are no subjects yet. The Interests panel says something
 * different for each; collapsing them would tell a reader with a broken
 * database that the app has simply not learned any subjects.
 */
async function loadTopics(): Promise<TopicSummary[] | null> {
  try {
    return await getTopics();
  } catch (error) {
    console.error("settings: could not read the topic catalogue", error);
    return null;
  }
}

export default async function SettingsPage() {
  const topics = await loadTopics();

  return (
    <PageShell
      eyebrow={brand.name}
      title="Settings"
      summary="Self-hosted. Nothing here is sent anywhere."
    >
      <InstallPrompt />
      <div className="flex flex-col gap-4">
        <PreferenceSections topics={topics} />

        <Section
          title="Appearance"
          hint="System follows your device. The choice is remembered on this device only."
        >
          <ThemeToggle />
        </Section>

        <Section
          title="Starting over"
          hint="The three questions this app asks when it first opens. Nothing you have saved is touched by going through them again."
        >
          <a
            href="/welcome"
            className="focus-visible:ring-org border-faint-2 text-soft hover:bg-faint inline-block rounded-xs border px-3 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none"
          >
            Run the welcome again
          </a>
        </Section>

        <Section
          title="What the grades mean"
          hint="Every story carries one, kept separate from what kind of thing the story is, so a rumour about a model release is labelled as both."
        >
          <dl className="flex flex-col gap-3">
            {GRADES.map((grade) => (
              // dt and dd must be DIRECT children of this div, or axe's
              // definition-list and dlitem rules both fail.
              <div key={grade.word} className="grid grid-cols-[auto_1fr] gap-x-3">
                <dt className="font-label col-span-2 flex items-center gap-2 text-[11px] font-bold tracking-[0.12em] uppercase">
                  <span aria-hidden className="flex shrink-0 gap-0.5">
                    {[0, 1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className={
                          i < grade.bars
                            ? "bg-ink block h-2.5 w-1.5"
                            : "bg-faint-2 block h-2.5 w-1.5"
                        }
                      />
                    ))}
                  </span>
                  {grade.word}
                </dt>
                <dd className="text-soft col-span-2 mt-0.5 text-[13px] leading-relaxed">
                  {grade.def}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section
          title="Where stories come from"
          hint="The list of sources is fixed for now. Turning one off needs an endpoint that does not exist yet, so the switches are not drawn rather than drawn dead."
        >
          {/* --soft and --faint-2, not --ash and --edge: this sits on paper,
              and bench colours on paper fail AA in dark. */}
          <p className="border-faint-2 text-soft border border-dashed p-4 text-[14px] leading-relaxed">
            Every source the app reads is listed in the repository and each story names the one it
            came from. Choosing which to follow arrives with the endpoint that can store the choice.
          </p>
        </Section>
      </div>
    </PageShell>
  );
}
