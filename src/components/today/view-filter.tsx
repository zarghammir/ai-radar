"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BRIEF_VIEWS, VIEW_LABELS, type BriefView } from "@/lib/api/views";
import { cn } from "@/lib/utils";

/**
 * The one control. Two positions, one tap, no menu.
 *
 * LINKS rather than buttons, like the reading-length switch beside it: the
 * choice is in the URL, so it survives a reload, it can be shared, and it works
 * before JavaScript runs. The durable answer is a cookie written on the click —
 * see ViewMemory below — because Today is rendered on the SERVER and has to
 * know which view to query before the browser has run anything.
 *
 * There are two positions and there will not be a third. With the fetch-time AI
 * gate in place every stored story is already AI-matched, so an "AI only" stop
 * and this "Everything" would return the identical rows.
 */
export function ViewFilter({ current }: { current: BriefView }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const length = params.get("length");

  return (
    <div className="mt-4">
      <div role="group" aria-label="What to show" className="flex gap-2">
        {BRIEF_VIEWS.map((view) => {
          const selected = view === current;
          const query = new URLSearchParams();
          query.set("view", view);
          if (length) query.set("length", length);
          return (
            <Link
              key={view}
              href={`${pathname}?${query.toString()}`}
              aria-current={selected ? "true" : undefined}
              className={cn(
                // --org marks WHERE YOU ARE. Palette law one, same as the
                // reading-length control.
                "focus-visible:ring-org flex-1 rounded-xs border py-2 text-center text-[12.5px] font-semibold focus-visible:ring-2 focus-visible:outline-none",
                selected
                  ? "bg-org border-org text-org-on"
                  : "border-edge text-ash hover:text-ash-hi",
              )}
            >
              {VIEW_LABELS[view].label}
            </Link>
          );
        })}
      </div>
      {/* The hint is for the position you are ON, not a legend for both: a
          reader needs to know what they are looking at, not what the other
          button would do. */}
      <p className="text-ash mt-1.5 text-[12.5px]">{VIEW_LABELS[current].hint}</p>
      <ViewMemory view={current} />
    </div>
  );
}

/**
 * Remembers the choice on this device.
 *
 * A COOKIE and not localStorage, for the same reason the brief length uses one:
 * Today is rendered on the server and filters in the query, so the view has to
 * reach the server before this device runs any JavaScript. localStorage cannot
 * do that. It carries one word, "built" or "all", and nothing else.
 *
 * It renders nothing. Writing on render rather than on click is deliberate —
 * arriving with ?view= in a shared link should be remembered too, and a click
 * handler would miss that.
 */
function ViewMemory({ view }: { view: BriefView }) {
  // In an EFFECT, not in render. Writing a cookie is a side effect on an
  // external system, which is exactly what effects are for — and render runs
  // more than once. It sets no React state, so the rule against synchronous
  // setState in an effect does not apply here.
  useEffect(() => {
    try {
      document.cookie = `ai-radar-view=${encodeURIComponent(view)}; path=/; max-age=${
        60 * 60 * 24 * 365
      }; samesite=lax`;
    } catch {
      // Private mode refuses cookies. The choice still holds for this visit,
      // because it is also in the URL.
    }
  }, [view]);
  return null;
}
