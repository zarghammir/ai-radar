import { brand } from "@/config/brand";

export const THEME_STORAGE_KEY = "ai-radar-theme";

/**
 * Runs before first paint so the correct theme is on <html> when the page
 * appears. Without this the browser paints light, then React swaps to dark and
 * the reader sees a white flash at seven in the morning.
 *
 * It also sets the <meta name="theme-color"> to match, so the browser chrome
 * and the notch area agree with the app instead of lagging a frame behind.
 */
export function ThemeScript() {
  const script = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var system = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = stored === "dark" || ((stored === "system" || !stored) && system);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = stored || "system";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? ${JSON.stringify(brand.themeColor.dark)} : ${JSON.stringify(brand.themeColor.light)});
  } catch (e) {
    /* localStorage can throw in private mode; the light default is fine. */
  }
})();
`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
