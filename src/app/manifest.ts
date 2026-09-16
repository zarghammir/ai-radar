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
    background_color: brand.themeColor.light,
    theme_color: brand.themeColor.light,
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
