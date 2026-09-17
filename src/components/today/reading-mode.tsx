"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { BriefLengthParam } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const OPTIONS: { value: BriefLengthParam; label: string }[] = [
  { value: "5", label: "5 min" },
  { value: "10", label: "10 min" },
  { value: "all", label: "Everything" },
];

/**
 * How long you have. LINKS rather than buttons, so the choice is in the URL:
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
    <div className="mt-4 flex gap-2" role="group" aria-label="How long you have">
      {OPTIONS.map((option) => {
        const selected = option.value === current;
        return (
          <Link
            key={option.value}
            href={`${pathname}?length=${option.value}`}
            aria-current={selected ? "true" : undefined}
            className={cn(
              "focus-visible:ring-org flex-1 rounded-xs border py-2 text-center text-[12.5px] font-semibold focus-visible:ring-2 focus-visible:outline-none",
              selected ? "bg-org border-org text-org-on" : "border-edge text-ash hover:text-ash-hi",
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}
