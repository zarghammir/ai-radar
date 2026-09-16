/**
 * Central branding. Change these values to rename the project everywhere.
 * Nothing else in the codebase should hard-code the product name.
 */
export const brand = {
  name: "AI Radar",
  shortName: "AI Radar",
  tagline: "The AI developments you actually need to know today.",
  description:
    "An open-source AI intelligence app: a curated morning brief plus a live radar of news, research, releases, and early signals.",
  repository: "https://github.com/zarghammir/ai-radar",
  author: "Zargham Mir",
  /** Used for the PWA theme color and accent. */
  themeColor: { light: "#fafaf9", dark: "#0c0c0d" },
  accent: "#2563eb",
} as const;
