"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "@/config/nav";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

function useIsCurrent() {
  const pathname = usePathname();
  return (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
}

/**
 * Desktop navigation. Hidden below the lg breakpoint by a REAL CSS media query
 * (Tailwind's lg: is min-width:64rem), not by a class toggled in JavaScript —
 * the prototype switched on body.dev-desktop and the PR #23 review called that
 * out as something the shell must not copy.
 */
export function Sidebar() {
  const isCurrent = useIsCurrent();
  return (
    <nav
      aria-label="Main"
      className="bg-sidebar border-edge hidden w-62 shrink-0 flex-col border-r px-5 py-6 lg:flex"
    >
      <Link
        href="/"
        className="focus-visible:ring-org flex items-center gap-2 rounded-xs focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <span aria-hidden className="bg-org h-6 w-1.5" />
        <span className="font-label text-ash-hi text-[15px] font-bold tracking-[0.1em] uppercase">
          {brand.name}
        </span>
      </Link>

      <ul className="mt-7 flex flex-col gap-0.5">
        {navItems.map((item) => {
          const current = isCurrent(item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "group focus-visible:ring-org relative flex items-center gap-3 rounded-xs py-2 pr-3 pl-4 text-[14.5px] focus-visible:ring-2 focus-visible:outline-none",
                  current ? "text-ash-hi font-bold" : "text-ash hover:bg-bench font-medium",
                )}
              >
                {/* The orange bar marks where you are. The heavier label says
                    it too, so the state never rests on colour alone. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2",
                    current ? "bg-org" : "bg-transparent",
                  )}
                />
                <Icon aria-hidden className="size-4 shrink-0" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Mobile navigation. Shown only below lg, again by media query. Four tabs is
 * what fits 390px honestly; Research and Releases are reachable from Radar.
 */
export function BottomNav() {
  const isCurrent = useIsCurrent();
  const tabs = navItems.filter((i) => ["/", "/radar", "/saved", "/settings"].includes(i.href));
  return (
    <nav
      aria-label="Main"
      className="bg-sidebar border-edge fixed inset-x-0 bottom-0 z-40 flex border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {tabs.map((item) => {
        const current = isCurrent(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "focus-visible:ring-org relative flex flex-1 flex-col items-center gap-1 py-2.5 focus-visible:ring-2 focus-visible:outline-none",
              current ? "text-ash-hi" : "text-ash",
            )}
          >
            <span
              aria-hidden
              className={cn("absolute top-0 h-[3px] w-7", current ? "bg-org" : "bg-transparent")}
            />
            <Icon aria-hidden className="size-5" />
            <span
              className={cn(
                "font-label text-[11.5px] tracking-[0.09em]",
                current ? "font-bold" : "font-semibold",
              )}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
