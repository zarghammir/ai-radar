"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BRIEF_VIEWS, VIEW_LABELS, parseView, type BriefView } from "@/lib/api/views";
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
 * and this widened position would return the identical rows.
 */
export function ViewFilter({ current }: { current: BriefView }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const length = params.get("length");

  return (
    <div className="mt-4">
      {/* THE PRIMARY CONTROL, AND IT HAS TO LOOK LIKE ONE (#154).
          Two rows of identically-styled segmented buttons read as five peers
          with no hierarchy — the owner's words were "two kinds of filters up
          there and three filters down there." This row is bigger, bolder and
          full width; the reading-time row below is a quiet line of text. One
          thing to decide, one thing to adjust. */}
      {/* CAPPED WIDTH, because a binary choice spanning 900px of desktop reads
          as crude rather than as important. At phone width the column is
          already narrower than this cap, so nothing changes where it matters
          most. */}
      <div role="group" aria-label="What kind of stories" className="flex max-w-md gap-2">
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
                "focus-visible:ring-org flex-1 rounded-xs border py-2.5 text-center text-[14.5px] font-bold focus-visible:ring-2 focus-visible:outline-none",
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
      {/* NO SENTENCE UNDER THE CONTROL. It used to carry "Adds the reporting
          around them: news, discussion, funding and policy" — which is the
          smell this redesign is about. The relationship now lives in the
          labels: "Launches" and "Launches + news" are visibly the same set plus
          something. */}
      <ViewMemory chosen={parseView(params.get("view"))} />
    </div>
  );
}

/**
 * Remembers the choice on this device — the CHOICE, not the resolved value.
 *
 * A COOKIE and not localStorage, for the same reason the brief length uses one:
 * Today is rendered on the server and filters in the query, so the view has to
 * reach the server before this device runs any JavaScript. localStorage cannot
 * do that. It carries one word, "built" or "all", and nothing else.
 *
 * IT TAKES THE URL'S VIEW AND NOT THE RESOLVED ONE, and the difference is the
 * whole of this component. The first version wrote on every render from the
 * view Today had settled on, so a reader who never touched the control had
 * `ai-radar-view=built` written on their first visit. From then on the stored
 * value could not distinguish "chose Built" from "never expressed a view, and
 * Built happened to be the default that day" — so the day the default changes,
 * everyone who never touched the control is silently pinned to the old one.
 * That is absence recorded as an answer, the same distinction parseView draws
 * one file over.
 *
 * `chosen` is null when the URL carried no ?view=, or carried one this build
 * does not recognise. Both mean the same thing here: this reader has not said.
 *
 * It renders nothing. Writing on render rather than on click is still
 * deliberate — arriving with ?view= in a shared link IS an expressed choice
 * and a click handler would miss it — and every link this control renders sets
 * ?view=, so a click still writes.
 */
function ViewMemory({ chosen }: { chosen: BriefView | null }) {
  // In an EFFECT, not in render. Writing a cookie is a side effect on an
  // external system, which is exactly what effects are for — and render runs
  // more than once. It sets no React state, so the rule against synchronous
  // setState in an effect does not apply here.
  useEffect(() => {
    if (chosen === null) return;
    try {
      document.cookie = `ai-radar-view=${encodeURIComponent(chosen)}; path=/; max-age=${
        60 * 60 * 24 * 365
      }; samesite=lax`;
    } catch {
      // Private mode refuses cookies. The choice still holds for this visit,
      // because it is also in the URL.
    }
  }, [chosen]);
  return null;
}
