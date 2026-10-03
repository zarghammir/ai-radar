"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { HOME_HREF, menuItems } from "@/config/nav";
import { WELCOME_PATH } from "@/components/onboarding/first-run-gate";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

/**
 * NO NAVIGATION ON THE WELCOME SCREEN.
 *
 * The owner, on first run: "remove the left sidebar today, radar, saved". He is
 * right, and not only on taste. First run is the one screen with a single thing
 * to do, and it was offering four ways to leave before the reader had any idea
 * what the four were — a nav bar is a map of a place you have not been shown.
 *
 * HIDDEN HERE RATHER THAN IN THE LAYOUT, because the layout is a server
 * component and the route is only knowable on the client. The chrome already
 * reads the pathname to mark the current item, so this costs nothing new.
 */
function useChromeHidden() {
  return usePathname() === WELCOME_PATH;
}

/**
 * THE WHOLE NAVIGATION, AT EVERY WIDTH: the brand mark, and a ⋯ button holding
 * the two surfaces that are not the feed.
 *
 * WHAT THIS REPLACED. A 248px sidebar on desktop and a four-tab bar fixed to
 * the bottom on phones — two components, two lists, two sets of states to keep
 * in step, for an app the owner has now reduced to one feed. His words:
 * "remove left sidebar don't ned it maybe a mini dropdown that has saved and
 * settings in it". The phone bar goes with it, deliberately: it cost about 64px
 * of every screen to offer four tabs, two of which were the page you were
 * already on and a feed ordered the same way as this one.
 *
 * IT IS A <details>, NOT A JAVASCRIPT MENU, and that is the point. The feed
 * renders on the server and reads without JavaScript; a dropdown built from
 * useState would have made Saved and Settings unreachable in exactly the
 * situation where the rest of the page still worked. <details> opens on click
 * and on Enter or Space with no script at all, and it is in the tab order for
 * free. The effects below only ADD to that — close on Escape, on a click
 * outside, and on navigating — so with scripts off you lose the courtesies and
 * keep the navigation.
 *
 * IT IS A DISCLOSURE, NOT role="menu". WAI-ARIA Authoring Practices is explicit
 * that role="menu" is for application menus — the File/Edit kind, where arrow
 * keys move and Tab leaves the whole widget. A list of links to other pages is
 * a disclosure. Marking it up as a menu would make screen readers announce it
 * as one and trap Tab inside it, which is the wrong promise about what these
 * two items do: they are links, and they navigate.
 */
export function AppChrome() {
  const pathname = usePathname();
  const hidden = useChromeHidden();
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);

  const close = useCallback(() => {
    if (details.current?.open) details.current.open = false;
  }, []);

  /**
   * Closing is driven through the DOM node rather than React state so that the
   * element stays UNCONTROLLED. A controlled `open` would mean the server sends
   * a <details> whose open state React then owns — and the first thing a reader
   * with a slow connection does is click the button before hydration, which a
   * controlled element would snap shut again on hydrate.
   */
  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !details.current?.open) return;
      close();
      // Focus goes back to the button that opened it. Without this, dismissing
      // the menu drops the caret at the top of the document and a keyboard
      // reader starts the page again.
      summary.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      const node = details.current;
      if (!node?.open) return;
      if (event.target instanceof Node && node.contains(event.target)) return;
      close();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [close]);

  if (hidden) return null;

  const onHome = pathname === HOME_HREF;

  return (
    <header
      data-app-chrome="true"
      className="bg-sidebar border-edge sticky top-0 z-40 border-b pt-[env(safe-area-inset-top)]"
    >
      {/* The horizontal padding matches PageShell's, so the brand sits on the
          same line as the page title under it rather than near it. */}
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 py-2 pr-4 pl-10 lg:pr-10 lg:pl-16"
      >
        <Link
          href={HOME_HREF}
          aria-current={onHome ? "page" : undefined}
          className="focus-visible:ring-org -ml-1 flex min-h-11 items-center gap-2 rounded-xs px-1 focus-visible:ring-2 focus-visible:outline-none"
        >
          <span aria-hidden className="bg-org h-6 w-1.5" />
          <span className="font-label text-ash-hi text-[15px] font-bold tracking-[0.1em] uppercase">
            {brand.name}
          </span>
        </Link>

        <details ref={details} className="relative">
          <summary
            ref={summary}
            data-chrome-menu-button="true"
            aria-label="More"
            className="focus-visible:ring-org text-ash hover:bg-bench hover:text-ash-hi flex size-11 cursor-pointer list-none items-center justify-center rounded-xs focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
          >
            <MoreHorizontal aria-hidden className="size-5" />
          </summary>

          <ul
            data-chrome-menu="true"
            /* PAPER, SO THE TEXT COMES FROM THE PAPER FAMILY. --paper is light
               in BOTH themes ("you read on the print, the bench is what it sits
               on"), so the chrome's own --ash/--ash-hi, which are tuned for the
               dark bench, land at about 1.9:1 here. axe caught exactly that in
               8 of 8 dark states on the first run of this component. */
            className="bg-paper border-faint-2 absolute top-full right-0 z-50 mt-1 min-w-44 rounded-xs border py-1 shadow-[0_6px_18px_rgba(0,0,0,0.13)]"
          >
            {menuItems.map((item) => {
              const current = pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "focus-visible:ring-org hover:bg-faint flex min-h-11 items-center gap-2.5 px-3 text-[14.5px] focus-visible:ring-2 focus-visible:-outline-offset-2 focus-visible:outline-none",
                      current ? "text-ink font-bold" : "text-soft font-medium",
                    )}
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </details>
      </nav>
    </header>
  );
}
