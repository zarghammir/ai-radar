import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@/config/brand";
import { loadAboutFacts } from "@/lib/api/about-server";
import { RelativeTime } from "@/components/relative-time";

/**
 * THE PAGE THE LINK IN A POST POINTS AT.
 *
 * The owner asked for "a proper marketing homepage", and the approved mock put
 * it here rather than at "/": "someone arriving from your LinkedIn post wants
 * to see the thing, not read why it exists". So "/" is still the app, the
 * welcome screen is still one question, and the argument for the product lives
 * on its own page where it can be as long as it likes.
 *
 * It is the one page in this app written for a stranger. Everything else
 * assumes you already decided to read it.
 */
export const metadata: Metadata = {
  title: "What AI Radar is",
  description: brand.description,
  openGraph: {
    title: `${brand.name} — ${brand.tagline}`,
    description: brand.description,
    type: "website",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: brand.name }],
  },
  twitter: {
    card: "summary",
    title: `${brand.name} — ${brand.tagline}`,
    description: brand.description,
  },
};

/**
 * RENDERED PER REQUEST, NOT AT BUILD TIME.
 *
 * Without this the page prerenders as static, and `next build` runs with no
 * DATABASE_URL — so the figures would be baked in as "unknown" at build time
 * and stay that way until the next deploy. Caught by reading the build output:
 * this route came back marked ○ (Static) with "[about] could not read the
 * figures" logged directly above it. Every number on this page would have been
 * missing in production while the page itself looked perfectly healthy.
 *
 * ISR with a revalidate window has the same opening problem in a milder form:
 * the first visitors after every deploy get the build's answer.
 */
export const dynamic = "force-dynamic";

/** A figure the page will print, or null when it is not known. */
function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-edge border-t pt-3">
      <p className="text-ash-hi font-mono text-[26px] leading-none font-bold tabular-nums">
        {value}
      </p>
      <p className="font-label text-ash mt-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase">
        {label}
      </p>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="font-mono text-[12px] font-bold tabular-nums">
        {String(n).padStart(2, "0")}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

export default async function AboutPage() {
  const facts = await loadAboutFacts();

  /**
   * ONLY THE FIGURES WE ACTUALLY HAVE. An unreachable database leaves this
   * array short rather than filling it with zeroes — see loadAboutFacts. The
   * two constants are always true and need no read.
   */
  const figures = [
    facts.sources === null ? null : { value: String(facts.sources), label: "sources, live" },
    facts.storiesThisWeek === null
      ? null
      : { value: String(facts.storiesThisWeek), label: "stories this week" },
    { value: "$0", label: "to run" },
    { value: "MIT", label: "licence" },
  ].filter((f) => f !== null);

  return (
    <div className="relative mx-auto w-full max-w-5xl px-4 pb-20 pl-10 lg:px-10 lg:pl-16">
      {/* The app's rail, so the pitch and the product are visibly one thing. */}
      <span
        aria-hidden
        className="bg-edge absolute top-0 bottom-0 left-2 w-2.5 lg:left-6"
        style={{
          background: "repeating-linear-gradient(180deg, transparent 0 9px, var(--edge) 9px 18px)",
        }}
      />

      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-5">
        <span className="flex items-center gap-2">
          <span aria-hidden className="bg-org h-6 w-1.5" />
          <span className="font-label text-ash-hi text-[15px] font-bold tracking-[0.1em] uppercase">
            {brand.name}
          </span>
        </span>
        <span className="flex items-center gap-4">
          <a
            href={brand.repository}
            className="text-ash hover:text-ash-hi focus-visible:ring-org inline-flex min-h-11 items-center rounded-xs px-1 text-[14px] underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
          >
            Source code
          </a>
          <Link
            href="/"
            className="bg-org text-org-on focus-visible:ring-org inline-flex min-h-11 items-center rounded-xs px-4 text-[14px] font-bold focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Open the app
          </Link>
        </span>
      </header>

      <div>
        <section className="pt-6 pb-10 lg:pt-12">
          <h1 className="text-ash-hi max-w-[18ch] text-[34px] leading-[1.05] font-bold tracking-tight text-balance lg:text-[52px]">
            Know what happened in AI today, in five minutes.
          </h1>
          <p className="text-ash mt-5 max-w-[56ch] text-[17px] leading-[1.5]">
            Every model, paper, release and funding round, ranked by how many independent sources
            carried it rather than by how loudly it was announced. Free, open source, and yours to
            run.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="bg-org text-org-on focus-visible:ring-org inline-flex min-h-11 items-center rounded-xs px-5 text-[15px] font-bold focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Open the app
            </Link>
            <a
              href="#install"
              className="border-ash text-ash-hi hover:bg-bench-2 focus-visible:ring-org inline-flex min-h-11 items-center rounded-xs border px-5 text-[15px] font-bold focus-visible:ring-2 focus-visible:outline-none"
            >
              Put it on your phone
            </a>
          </div>

          <p className="text-ash mt-4 text-[13px]">
            No account. Nothing to install unless you want to.
          </p>
        </section>

        <section aria-label="What it is running on right now">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
            {figures.map((f) => (
              <Figure key={f.label} value={f.value} label={f.label} />
            ))}
          </div>
          {facts.lastCollectedAt ? (
            <p className="text-ash mt-4 font-mono text-[12px]">
              Last collected <RelativeTime iso={facts.lastCollectedAt} />. It checks again every
              three hours.
            </p>
          ) : null}
        </section>

        {facts.topStories.length > 0 ? (
          <section className="mt-14">
            <h2 className="text-ash-hi text-[24px] font-bold tracking-tight lg:text-[30px]">
              On it right now
            </h2>
            {/* Not a screenshot. The three at the top of the feed as this page
                loaded, through the same function the feed itself calls. */}
            <ul className="mt-5 flex flex-col gap-2">
              {facts.topStories.map((story) => (
                <li key={story.slug}>
                  <Link
                    href={`/story/${story.slug}`}
                    className="bg-paper text-ink hover:bg-faint focus-visible:ring-org block p-4 focus-visible:ring-2 focus-visible:-outline-offset-2 focus-visible:outline-none"
                  >
                    <p className="text-[16px] leading-[1.3] font-bold text-balance lg:text-[18px]">
                      {story.title}
                    </p>
                    <p className="text-meta mt-1.5 font-mono text-[11px]">{story.source}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-ash mt-3 text-[13px]">
              Read as this page loaded.{" "}
              <Link href="/" className="underline underline-offset-2">
                The rest of today
              </Link>
              .
            </p>
          </section>
        ) : null}

        <section className="mt-16">
          <h2 className="text-ash-hi text-[24px] font-bold tracking-tight lg:text-[30px]">
            What it actually does
          </h2>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {[
              {
                title: "Ranks by corroboration",
                body: "A story that four independent outlets carried outranks one that a single blog announced. Then it decays: by two days old, a story is worth half what it was. That is why the top of the feed is today.",
              },
              {
                title: "Shows you where it came from",
                body: "Every story names its primary source and links the rest. Nothing is summarised to the point where you cannot go and check it, and the original is always one tap away.",
              },
              {
                title: "One feed, and it ends",
                body: "Five stories, ten, or everything. It is a brief, not a timeline — you finish it. Save what you want to come back to, hide what you do not, and both stay in your browser.",
              },
            ].map((card) => (
              <div key={card.title} className="bg-paper text-ink p-5">
                <h3 className="text-[16px] font-bold">{card.title}</h3>
                <p className="text-soft mt-2 text-[14px] leading-[1.5]">{card.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="install" className="mt-16 scroll-mt-6">
          <h2 className="text-ash-hi text-[24px] font-bold tracking-tight lg:text-[30px]">
            Put it on your phone
          </h2>
          <p className="text-ash mt-3 max-w-[56ch] text-[15px]">
            It is a web app, so there is no app store and no download. Added to your home screen it
            opens fullscreen with no browser bar, and still shows the stories you have already
            opened when you have no signal.
          </p>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="bg-paper text-ink p-5">
              <h3 className="font-label text-[11px] font-bold tracking-[0.14em] uppercase">
                iPhone
              </h3>
              <p className="text-soft mt-2 text-[13.5px]">
                <b className="text-ink">It has to be Safari.</b> Chrome and Firefox on iOS cannot
                install web apps.
              </p>
              <ol className="text-soft mt-3 space-y-2 text-[14px] leading-[1.45]">
                <Step n={1}>
                  Open <b className="text-ink">this page</b> in Safari
                </Step>
                <Step n={2}>
                  Tap <b className="text-ink">Share</b>, the square with an arrow at the bottom
                </Step>
                <Step n={3}>
                  Scroll down and tap <b className="text-ink">Add to Home Screen</b>
                </Step>
                <Step n={4}>
                  Tap <b className="text-ink">Add</b>, top right
                </Step>
              </ol>
            </div>

            <div className="bg-paper text-ink p-5">
              <h3 className="font-label text-[11px] font-bold tracking-[0.14em] uppercase">
                Android
              </h3>
              <p className="text-soft mt-2 text-[13.5px]">
                Chrome often offers this by itself, as a bar along the bottom. Either way works.
              </p>
              <ol className="text-soft mt-3 space-y-2 text-[14px] leading-[1.45]">
                <Step n={1}>
                  Open <b className="text-ink">this page</b> in Chrome
                </Step>
                <Step n={2}>
                  Tap the <b className="text-ink">⋮</b> menu, top right
                </Step>
                <Step n={3}>
                  Tap <b className="text-ink">Install app</b>, or Add to Home screen on older
                  versions
                </Step>
                <Step n={4}>
                  Tap <b className="text-ink">Install</b>
                </Step>
              </ol>
            </div>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-ash-hi text-[24px] font-bold tracking-tight lg:text-[30px]">
            What this demo is, honestly
          </h2>
          <p className="text-ash mt-3 max-w-[60ch] text-[15px] leading-[1.55]">
            One shared instance that anyone can open.{" "}
            <b className="text-ash-hi">What you save and what you hide stay in your own browser</b>{" "}
            and are not visible to anyone else, including whoever is running it. The settings —
            which topics are tracked, when the brief is cut — are shared by everyone looking at it,
            because this version has no accounts by design.
          </p>
          <p className="text-ash mt-3 max-w-[60ch] text-[15px] leading-[1.55]">
            Run your own copy and it is entirely yours. It needs Docker and nothing else, and no
            paid API key: the AI summaries and the social sources are optional plug-ins that the app
            runs perfectly well without.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a
              href={brand.repository}
              className="border-ash text-ash-hi hover:bg-bench-2 focus-visible:ring-org inline-flex min-h-11 items-center rounded-xs border px-5 text-[15px] font-bold focus-visible:ring-2 focus-visible:outline-none"
            >
              Read the code on GitHub
            </a>
            <Link
              href="/"
              className="bg-org text-org-on focus-visible:ring-org inline-flex min-h-11 items-center rounded-xs px-5 text-[15px] font-bold focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Open the app
            </Link>
          </div>
        </section>
      </div>

      <footer className="border-edge text-ash mt-16 border-t pt-5 text-[13px]">
        <p>
          {brand.name} by {brand.author}. MIT licensed — use it, fork it, run it for your team.
        </p>
      </footer>
    </div>
  );
}
