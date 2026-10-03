import { Bookmark, Settings } from "lucide-react";

/**
 * ONE FEED, AND A SMALL MENU FOR EVERYTHING ELSE.
 *
 * The owner, on the sidebar: "remove left sidebar don't ned it maybe a mini
 * dropdown that has saved and settings in it". So there is no list of
 * destinations any more. The brand mark in the chrome returns you to the feed,
 * and these two — the only surfaces that are not the feed — live behind the
 * ⋯ button.
 *
 * WHAT WENT, AND WHY IT IS NOT COMING BACK BY ACCIDENT:
 *
 *  - Today. It is the app. A link to the page you are on, in a bar that is
 *    always on that page, is a tab for the room you are standing in.
 *  - Radar. #191 made Today newest-first on the owner's ruling ("Newest comes
 *    first, then the most important"), which is what Radar was for. Two feeds
 *    ordered the same way is one feed and a duplicate. The route still answers
 *    — nothing 404s and no bookmark breaks — but it is no longer offered, and
 *    retiring it properly is #194.
 *  - Research and Releases, gone since #102, for the same reason: the owner
 *    ruled one feed and one filter rather than sections.
 *
 * Adding anything here puts it in the dropdown, which is the only navigation
 * the app has at any width. There is no second list to keep in step — that
 * was the bug this shape removes.
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
