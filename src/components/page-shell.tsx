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
  children,
}: {
  eyebrow: ReactNode;
  title: string;
  /** A node rather than a string so a page can put structure in it. */
  summary?: ReactNode;
  /** Optional controls under the heading, e.g. the reading-length switch. */
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative mx-auto w-full max-w-5xl px-4 py-6 pl-10 lg:px-10 lg:py-10 lg:pl-16">
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
 */
export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-edge text-ash border border-dashed p-6">
      <p className="text-ash-hi text-[15px] font-semibold">{title}</p>
      <p className="mt-2 max-w-prose text-[14px] leading-relaxed">{body}</p>
    </div>
  );
}
