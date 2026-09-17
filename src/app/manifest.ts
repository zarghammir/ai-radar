import type { MetadataRoute } from "next";
import { brand } from "@/config/brand";

/**
 * Every value comes from src/config/brand.ts, so renaming the product renames
 * the installed app too. Served at /manifest.webmanifest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.name,
    short_name: brand.shortName,
    description: brand.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // The manifest spec has no media-scoped colour, so the splash is one
    // value for both themes and this is a forced choice, not an oversight.
    // Dark is chosen because docs/DESIGN.md calls it this world's native
    // ground and the app is opened early in the morning; a light splash was
    // the brighter flash of the two. Flip both to themeColor.light if the
    // owner would rather the splash match a light device.
    background_color: brand.themeColor.dark,
    theme_color: brand.themeColor.dark,
    categories: ["news", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
