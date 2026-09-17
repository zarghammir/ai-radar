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
 * These scripts drive the app on FIXTURES, where the reader's state lives in
 * localStorage. Against a real database the seeding below does nothing and the
 * state has to be put in the database instead.
 */
export async function collectStoryIds(browser, base, howMany) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    // Write-once, like markOnboarded in ./seed.mjs. addInitScript runs on
    // EVERY navigation, so an unguarded write puts the starting preferences
    // back over whatever the page has stored. It is harmless HERE — this
    // context does one goto and is closed in a finally — but it is the
    // identical pattern the sibling fixed, and the day someone adds a reload
    // it goes quiet in exactly the same way.
    await context.addInitScript(() => {
      try {
        const key = "ai-radar-fixture-preferences";
        if (localStorage.getItem(key) !== null) return;
        localStorage.setItem(key, JSON.stringify({ onboardedAt: "2026-09-01T00:00:00.000Z" }));
      } catch {}
    });
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
