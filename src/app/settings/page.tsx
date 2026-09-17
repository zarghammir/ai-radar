import type { Metadata } from "next";
import { brand } from "@/config/brand";
import { PageShell } from "@/components/page-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { InstallPrompt } from "@/components/install-prompt";

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

export default function SettingsPage() {
  return (
    <PageShell
      eyebrow={brand.name}
      title="Settings"
      summary="Self-hosted. Nothing here is sent anywhere."
    >
      <InstallPrompt />
      <div className="flex flex-col gap-4">
        <Section
          title="Appearance"
          hint="System follows your device. The choice is remembered on this device only."
        >
          <ThemeToggle />
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
          title="Sources, brief and notifications"
          hint="Not wired up yet. These land with the ingestion pipeline; this release is the shell, the theme and installability only."
        >
          {/* --soft and --faint-2, not --ash and --edge: this sits on paper,
              and bench colours on paper fail AA in dark. */}
          <p className="border-faint-2 text-soft border border-dashed p-4 text-[14px] leading-relaxed">
            Choosing sources, setting the time your brief is ready, and picking how you hear about
            it all arrive with the first working brief.
          </p>
        </Section>
      </div>
    </PageShell>
  );
}
