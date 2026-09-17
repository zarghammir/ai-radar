/**
 * Central branding. Change these values to rename the project everywhere.
 * Nothing else in the codebase should hard-code the product name.
 *
 * The palette is the one the owner signed off on issue #11. The visual world
 * is "The Select Rail"; docs/DESIGN.md is the full system and the two palette
 * laws. src/app/globals.css carries the same values as CSS custom properties,
 * and app/manifest.ts reads the PWA colours from here.
 */
export const brand = {
  name: "AI Radar",
  shortName: "AI Radar",
  tagline: "The AI developments you actually need to know today.",
  description:
    "An open-source AI intelligence app: a curated morning brief plus a live radar of news, research, releases, and early signals.",
  repository: "https://github.com/zarghammir/ai-radar",
  author: "Zargham Mir",

  /**
   * PWA theme colour and the browser chrome behind the app, per theme.
   * These are the bench: the surface the app sits on, not the paper you read on.
   */
  themeColor: { light: "#e4e3de", dark: "#0b0c0e" },

  /**
   * The one reserved colour. It marks what is LIVE or WHERE YOU ARE and
   * nothing else. See palette law one in docs/DESIGN.md section 2.
   */
  accent: "#f0531c",

  /**
   * The accent as TEXT. Safe on the bench in both themes and on paper in light
   * only; on paper in dark it is 3.17:1 and fails AA. Palette law two.
   */
  accentText: { light: "#b3380b", dark: "#f0531c" },
} as const;
