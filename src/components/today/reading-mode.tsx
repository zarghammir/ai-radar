"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { BriefLengthParam } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const OPTIONS: { value: BriefLengthParam; label: string }[] = [
  { value: "5", label: "5 min" },
  { value: "10", label: "10 min" },
  // #147/#154: no word appears in two controls. The filter above owns
  // "Built"; this one owns the reading time.
  { value: "all", label: "Full brief" },
];

/**
 * How much to read. LINKS rather than buttons, so the choice is in the URL:
 * it survives a reload, it can be shared, and it works before JavaScript runs.
 *
 * This is the OVERRIDE FOR ONE VISIT. The durable default is `briefLength` in
 * preferences, which Today reads when the URL says nothing — the same split
 * the theme uses between a device and an account.
 *
 * There used to be a localStorage copy here, remembering the last choice per
 * device. It is gone: once the preference became the default, the two were two
 * answers to one question, and the device's older memory would have quietly
 * overridden a length the reader had just chosen in Settings — leaving that
 * control looking broken.
 */
export function ReadingMode({ current }: { current: BriefLengthParam }) {
  const pathname = usePathname();

  return (
    /*
     * THE SECONDARY CONTROL, AND IT LOOKS SECONDARY (#154).
     *
     * This used to be a second row of segmented buttons identical to the
     * filter above it — five boxes in two rows, reading as five peers. The
     * owner: "two kinds of filters up there and three filters down there."
     * It is now a quiet line of text: a label, three choices, no boxes.
     *
     * IT DELIBERATELY DOES NOT USE --org. The accent marks WHERE YOU ARE, and
     * when both controls used it the screen had two competing orange blocks
     * and no hierarchy. Giving the accent to the primary control ALONE is what
     * makes the hierarchy visible at a glance rather than explained.
     *
     * The selected choice is carried by WEIGHT AND AN UNDERLINE, not by colour
     * — the same rule the verification chip follows, and it keeps this legible
     * to anyone who cannot separate the accent from the text.
     */
    <div
      className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12.5px]"
      role="group"
      aria-label="How much to read"
    >
      {/* text-ash, NOT text-soft. The accessibility sweep caught text-soft
          failing contrast at this size on the dark theme — a quiet control
          still has to be readable, and "secondary" is a matter of weight and
          position, not of being harder to see. The options beside it already
          use text-ash and pass. */}
      <span className="text-ash">Reading time</span>
      {OPTIONS.map((option, i) => {
        const selected = option.value === current;
        return (
          <span key={option.value} className="flex items-baseline gap-2">
            {i > 0 ? (
              <span aria-hidden className="text-faint">
                ·
              </span>
            ) : null}
            <Link
              href={`${pathname}?length=${option.value}`}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "focus-visible:ring-org inline-block rounded-xs py-1 focus-visible:ring-2 focus-visible:outline-none",
                selected
                  ? "text-ash-hi font-bold underline underline-offset-4"
                  : "text-ash hover:text-ash-hi",
              )}
            >
              {option.label}
            </Link>
          </span>
        );
      })}
    </div>
  );
}
