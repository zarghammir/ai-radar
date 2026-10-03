import { Bookmark, Radar, Settings, Sun } from "lucide-react";

/**
 * THE SURFACES, in reading order: the brief first, then everything arriving,
 * then your own pile, then configuration. Deliberately not counted here — the
 * count is the thing that rotted when #102 removed two of them, and a number
 * in a comment is a claim that has to be re-checked on every edit.
 *
 * NO Research and NO Releases, since #102. The owner ruled one feed and one
 * filter rather than sections — "I don't want to have another page… it's just
 * a filter" — so those two are positions on Today's view control now, not
 * destinations. Adding them back here would restore exactly the sections the
 * ruling removed.
 */
export const navItems = [
  {
    href: "/",
    label: "Today",
    icon: Sun,
    description: "Today's brief",
  },
  {
    href: "/radar",
    label: "Radar",
    icon: Radar,
    description: "Everything arriving",
  },
  {
    href: "/saved",
    label: "Saved",
    icon: Bookmark,
    description: "Your pile",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    description: "Sources, brief and theme",
  },
] as const;

export type NavItem = (typeof navItems)[number];

/**
 * THE PHONE BAR IS THE WHOLE LIST, AND STAYS THAT WAY. An earlier version
 * filtered it down to four tabs and left Research and Releases in the sidebar,
 * which is `display:none` below lg — so on a phone they were URL-only,
 * unclickable and outside the tab order.
 *
 * The owner, on 2026-10-03, after seeing a build without it: "For the phone,
 * you need to keep the sidebar… bring back the tabs on the mobile version.
 * Keep it as it is." So it is the list, unfiltered, exactly as it was.
 */
export const bottomNavItems = navItems;

/**
 * WHAT THE ⋯ MENU HOLDS ON A LAPTOP, and why it is shorter than the bar above.
 *
 * The owner named its contents: "remove left sidebar don't ned it maybe a mini
 * dropdown that has saved and settings in it." Today is not in it because the
 * brand mark beside the button already goes there, and a link to the page you
 * are standing on is not navigation.
 *
 * RADAR IS NOT IN IT EITHER, AND THAT IS A KNOWN GAP rather than an oversight.
 * It is reachable from the phone bar and not from a laptop, which is the mirror
 * image of the #102 defect this file's other comment describes. It is left that
 * way on purpose for as long as #194 is open — that issue asks whether Radar
 * survives at all, now that #191 made Today newest-first and did the job Radar
 * existed for. If the answer is that it stays, it belongs here; if it goes, the
 * gap goes with it. Adding it here first would be answering his question for
 * him.
 */
export const menuItems = [
  {
    href: "/saved",
    label: "Saved",
    icon: Bookmark,
    description: "Your pile",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    description: "Sources, brief and theme",
  },
] as const;

export type MenuItem = (typeof menuItems)[number];

/** Where the brand mark goes. The feed is home. */
export const HOME_HREF = "/";
