import type { Metadata } from "next";
import { brand } from "@/config/brand";
import { PageShell } from "@/components/page-shell";
import { loadTopics } from "@/lib/api/catalogue-server";
import { ThemeToggle } from "@/components/theme-toggle";
import { InstallPrompt } from "@/components/install-prompt";
import { PreferenceSections } from "@/components/settings/preference-sections";

export const metadata: Metadata = { title: "Settings" };

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
          title="Where your saves live"
          hint="Ruled by the owner on #91: the news is the same for everyone, so it is shared; what you keep is yours, so it is not."
        >
          {/* The sentence the ruling requires, in the reader's language. No
              mention of localStorage, and no apology — the objection that
              settled the decision was "if they close the browser they lose the
              saves", which is FALSE, so this must not imply fragility either.
              It says what is true and what the one real limit is. */}
          <p className="text-soft text-[14px] leading-relaxed">
            <b className="text-ink font-semibold">Saved stories are kept in this browser.</b> They
            survive closing the tab, quitting and restarting your computer. They do not follow you
            to another browser or another device, and clearing your browsing data clears them.
          </p>
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
