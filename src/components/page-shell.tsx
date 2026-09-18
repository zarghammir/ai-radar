import type { ReactNode } from "react";

/**
 * The frame every surface shares: a sprocket rail down the left edge, a
 * heading block, and the content. The rail is the world's signature and it is
 * present at both sizes, per docs/DESIGN.md section 6.
 */
export function PageShell({
  eyebrow,
  title,
  summary,
  controls,
  state,
  children,
}: {
  eyebrow: ReactNode;
  title: string;
  /** A node rather than a string so a page can put structure in it. */
  summary?: ReactNode;
  /** Optional controls under the heading, e.g. the reading-length switch. */
  controls?: ReactNode;
  /**
   * Which state this screen is in, exposed to the DOM as `data-screen-state`.
   *
   * It exists so a check can assert WHICH state it is looking at rather than
   * inferring one from an absence. "No stories rendered" is true of a quiet
   * morning AND of a database we cannot reach, and those are different facts —
   * an assertion that cannot tell them apart passes for the broken one.
   */
  state?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-screen-state={state}
      className="relative mx-auto w-full max-w-5xl px-4 py-6 pl-10 lg:px-10 lg:py-10 lg:pl-16"
    >
      {/* The rail. Decorative, so it is hidden from assistive technology. */}
      <span
        aria-hidden
        className="bg-edge absolute top-0 bottom-0 left-2 w-2.5 lg:left-6"
        style={{
          background: "repeating-linear-gradient(180deg, transparent 0 9px, var(--edge) 9px 18px)",
        }}
      />
      <header>
        <p className="text-ash text-[13px]">{eyebrow}</p>
        <h1 className="text-ash-hi mt-1 text-[27px] leading-tight font-bold tracking-tight text-balance lg:text-[34px]">
          {title}
        </h1>
        {/* empty:hidden on the CONTAINER, not a check at each call site. An
            element is always truthy, so a `summary` that renders null still
            draws this div and its margin; the ternary cannot see that. */}
        {summary ? <div className="text-ash mt-2 text-[13.5px] empty:hidden">{summary}</div> : null}
        {controls}
      </header>
      <div className="mt-6">{children}</div>
    </div>
  );
}

/**
 * An honest empty state. It says what is missing and what will fill it, rather
 * than pretending the surface is finished.
 *
 * THE TWO DATA ATTRIBUTES ARE FOR CI AND ARE NOT DECORATION. The check that an
 * empty Today explains itself used to grep the page for a phrase, so a correct
 * copy edit reddened it — twice. An assertion can now ask whether the reader
 * was told ANYTHING, by finding this block and measuring the length of its
 * body, without any opinion about the words in it. Marker-without-explanation
 * is the defect worth catching; a rewritten sentence is not.
 *
 * THEY CARRY AN EXPLICIT "true" RATHER THAN BEING BARE, for two reasons that
 * are both about the reader and neither about React.
 *
 * It matches `data-screen-state={state}` a few lines up, and every other data
 * attribute in this codebase, all of which are written with a value.
 *
 * And the literal `="true"` is what lets a text search tell this attribute
 * apart from its own escaped twin. A Next.js document carries the page TWICE:
 * once as DOM HTML, once as the RSC flight payload, JSON-escaped inside a
 * script tag. So `data-empty-body` occurs twice in one response — as
 * `data-empty-body="true"` and as `data-empty-body\":\"true\"` — and the
 * payload copy comes FIRST. A pattern loose enough to match both, taking the
 * first hit, reads the payload and captures nothing. Requiring `="true"`
 * cannot match the escaped form, because that one has `\":\"` between the
 * name and the value. See the check in .github/workflows/ci.yml and #115.
 *
 * WHAT THIS COMMENT USED TO SAY, AND WHY IT IS NOT SAYING IT ANY MORE. It
 * claimed that a bare `data-empty-body` never reaches the server-rendered
 * HTML. THAT IS FALSE — React renders the bare form as `data-empty-body="true"`
 * exactly as the explicit one, and changing it altered no output at all. The
 * zero-length reading that prompted it had the other cause above. The
 * retraction is here rather than only in the commit that made it, because a
 * commit message is read once by whoever opens that commit and a docblock on
 * an exported component is read by everyone who touches it — and this one was
 * phrased as an evidenced finding, which is the kind of wrong sentence that
 * gets believed and propagated. Anyone meeting a bare boolean data attribute
 * elsewhere should not "fix" working markup on this comment's authority.
 */
export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div data-empty-state="true" className="border-edge text-ash border border-dashed p-6">
      <p className="text-ash-hi text-[15px] font-semibold">{title}</p>
      <p data-empty-body="true" className="mt-2 max-w-prose text-[14px] leading-relaxed">
        {body}
      </p>
    </div>
  );
}
