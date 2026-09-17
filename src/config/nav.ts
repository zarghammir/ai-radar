import { Bookmark, Radar, Settings, Sun } from "lucide-react";

/**
 * The six surfaces. Order is the reading order: the brief first, then
 * everything arriving, then the two filtered views, then your own pile,
 * then configuration.
 */
// NO Research and NO Releases, since #102. The owner ruled one feed and one
// filter rather than sections — "I don't want to have another page… it's just
// a filter" — so those two are positions on Today's view control now, not
// destinations. Adding them back here would restore exactly the sections the
// ruling removed.
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
 * Every surface is reachable at every width. An earlier version filtered this
 * list down to four tabs and left Research and Releases in the sidebar, which
 * is `display:none` below lg — so on a phone they were URL-only, unclickable
 * and outside the tab order. There is no "More" menu; do not reintroduce one
 * without building it.
 */
export const bottomNavItems = navItems;
