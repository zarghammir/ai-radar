"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { BriefLengthParam } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "ai-radar-brief-length";
const OPTIONS: { value: BriefLengthParam; label: string }[] = [
  { value: "5", label: "5 min" },
  { value: "10", label: "10 min" },
  { value: "all", label: "Everything" },
];

/**
 * How long you have. LINKS rather than buttons, so the choice is in the URL:
 * it survives a reload, it can be shared, and it works before JavaScript runs.
 *
 * Persistence is the small client piece below. Once PUT /api/preferences
 * exists, `briefLength` there becomes the cross-device default and this becomes
 * the per-visit override — the same split the theme already uses.
 */
export function ReadingMode({ current }: { current: BriefLengthParam }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const hasExplicitChoice = params.get("length") !== null;

  useEffect(() => {
    // Remember what the reader actually chose.
    if (hasExplicitChoice) {
      try {
        window.localStorage.setItem(STORAGE_KEY, current);
      } catch {
        // Private mode; the choice still holds for this visit.
      }
      return;
    }
    // Arriving with no choice in the URL: restore the last one, if it differs.
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (stored && stored !== current && OPTIONS.some((o) => o.value === stored)) {
      router.replace(`${pathname}?length=${stored}`);
    }
  }, [current, hasExplicitChoice, pathname, router]);

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
