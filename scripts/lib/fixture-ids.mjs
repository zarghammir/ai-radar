/**
 * The ids of the stories actually on Today, read from the running app.
 *
 * The browser-driven scripts seed a reader's saved list, and they need ids
 * that exist. Typing them into the script works until a fixture changes its
 * id, and then every seeded run measures an EMPTY screen while the script
 * still claims to have seeded three stories — the floor fires, but only after
 * the run is spent. Reading them from the page cannot drift.
 *
 * It marks ITSELF as onboarded before looking. Without that the first-run gate
 * sends this page to /welcome, there are no articles on it, and the helper
 * would report "Today offered 0 stories" for a reason that has nothing to do
 * with Today.
 *
 * It seeds both sides through markOnboarded, so it works whichever mode the
 * build was compiled in.
 */
import { markOnboarded } from "./seed.mjs";

export async function collectStoryIds(browser, base, howMany) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    // The shared helper rather than an inline copy: it writes the onboarding
    // fact on BOTH sides, and this file is the fifth place that needed it. Its
    // own localStorage copy was write-once but live-inert, so against a
    // database this navigation would have landed on /welcome and the error
    // below would have blamed Today for offering no stories.
    await markOnboarded(context, base);
    const page = await context.newPage();
    // ?length=all so the ids come from the whole brief rather than whatever
    // fits the default budget.
    await page.goto(base + "/?length=all", { waitUntil: "networkidle" });
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll("article[data-story-id]")].map((el) =>
        Number(el.dataset.storyId),
      ),
    );
    const landed = new URL(page.url()).pathname;
    const usable = ids.filter((id) => Number.isInteger(id) && id > 0);
    if (landed !== "/") {
      throw new Error(
        `asked for Today and ended up on ${landed} — the onboarding bypass above is not working,` +
          ` so nothing that follows would be measuring Today`,
      );
    }
    if (usable.length < howMany) {
      throw new Error(
        `needed ${howMany} story ids to seed with and Today offered ${usable.length}` +
          ` — seeding anything now would measure an empty screen`,
      );
    }
    return usable.slice(0, howMany);
  } finally {
    await context.close();
  }
}
