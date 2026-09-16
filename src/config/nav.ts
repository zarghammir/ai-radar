import { Bookmark, FlaskConical, Package, Radar, Settings, Sun } from "lucide-react";

/**
 * The six surfaces. Order is the reading order: the brief first, then
 * everything arriving, then the two filtered views, then your own pile,
 * then configuration.
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
    href: "/research",
    label: "Research",
    icon: FlaskConical,
    description: "Papers and preprints",
  },
  {
    href: "/releases",
    label: "Releases",
    icon: Package,
    description: "Models and products",
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

/** The tabs that fit a 390px bottom bar. Research and Releases live in "More". */
export const primaryNav = navItems.filter((i) =>
  ["/", "/radar", "/saved", "/settings"].includes(i.href),
);
