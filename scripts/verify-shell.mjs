/**
 * Browser verification for the PR #31 review fixes — the four things axe
 * cannot see, because axe does not exercise keyboard interaction, does not
 * read which <meta> the browser is honouring, and does not take the network
 * away.
 *
 *   npx next build && npx next start -p 3210
 *   npm run verify:shell            # or: node scripts/verify-shell.mjs <url>
 *
 * Every check carries a FLOOR and the script exits 1 if it measured nothing.
 * That is not ceremony: with no service worker in control nothing is cached at
 * all, so "the 404 was not cached" comes back true while proving nothing about
 * the fix — passing hardest exactly when the feature is most broken.
 *
 * It prints what it measured rather than a verdict, so a reviewer can disagree
 * with the reading rather than having to write a fifth version of the probe.
 */
import { launchBrowser, requireServer } from "./lib/browser.mjs";

const base = process.argv[2] || process.env.VERIFY_URL || "http://127.0.0.1:3210";
await requireServer(base);

const out = {};
const floor = []; // an empty measurement is a FAILURE, not a pass

const browser = await launchBrowser();

try {
  /* ---- A. finding 5: the radio group must BE a radio group ------------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(base + "/settings", { waitUntil: "networkidle" });
    const radios = page.locator('[role="radio"]');
    const radioCount = await radios.count();
    // Without this, zero radios yields "nothing moved" and reads identically
    // to a broken widget — and "focus did not change" would be trivially true.
    if (radioCount !== 3) floor.push(`expected 3 radios on /settings, found ${radioCount}`);
    const tabindexes = await radios.evaluateAll((els) =>
      els.map((e) => e.getAttribute("tabindex")),
    );
    await radios.first().focus();
    const before = {
      focused: await page.evaluate(() => document.activeElement?.textContent?.trim()),
      checked: await radios.evaluateAll((els) => els.map((e) => e.getAttribute("aria-checked"))),
    };
    await page.keyboard.press("ArrowRight");
    const afterRight = {
      focused: await page.evaluate(() => document.activeElement?.textContent?.trim()),
      checked: await radios.evaluateAll((els) => els.map((e) => e.getAttribute("aria-checked"))),
    };
    await page.keyboard.press("End");
    const afterEnd = {
      focused: await page.evaluate(() => document.activeElement?.textContent?.trim()),
      checked: await radios.evaluateAll((els) => els.map((e) => e.getAttribute("aria-checked"))),
    };
    // One tab stop for the group: exactly one radio with tabindex 0.
    out.radioGroup = {
      radiosFound: radioCount,
      tabindexes,
      singleTabStop: tabindexes.filter((t) => t === "0").length === 1,
      before,
      afterArrowRight: afterRight,
      afterEnd,
      arrowMovesFocus: before.focused !== afterRight.focused,
      arrowMovesSelection: JSON.stringify(before.checked) !== JSON.stringify(afterRight.checked),
    };
    await ctx.close();
  }

  /* ---- B. finding 4: the meta actually IN FORCE must match the app ----- */
  {
    const ctx = await browser.newContext({
      colorScheme: "dark",
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();
    await page.goto(base + "/settings", { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: "Light" }).click();
    await page.waitForTimeout(250);
    out.themeColor = await page.evaluate(() => {
      const metas = [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => ({
        media: m.getAttribute("media") || "(none)",
        content: m.getAttribute("content"),
        applies: m.getAttribute("media")
          ? window.matchMedia(m.getAttribute("media")).matches
          : true,
      }));
      const inForce = metas.find((m) => m.applies);
      return {
        osScheme: "dark",
        chosenTheme: document.documentElement.dataset.theme,
        htmlHasDark: document.documentElement.classList.contains("dark"),
        appBench: getComputedStyle(document.body).backgroundColor,
        metas,
        metaInForce: inForce ? inForce.content : null,
      };
    });
    if (out.themeColor.metas.length < 2) {
      floor.push(`expected 2 theme-color metas, found ${out.themeColor.metas.length}`);
    }
    if (out.themeColor.metas.filter((m) => m.applies).length !== 1) {
      floor.push("expected exactly one theme-color meta to be in force");
    }
    await ctx.close();
  }

  /* ---- C. finding 2: a 404 must not poison the cache ------------------- */
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1800); // let the worker take control and precache
    const controlling = await page.evaluate(
      async () =>
        !!(await navigator.serviceWorker.getRegistration()) && !!navigator.serviceWorker.controller,
    );
    const liveStatus = await page
      .goto(base + "/definitely-not-a-page", { waitUntil: "domcontentloaded" })
      .then((r) => r && r.status());
    await page.waitForTimeout(800);
    const cached = await page.evaluate(async () => {
      const cache = await caches.open("ai-radar-shell-v1");
      const hit = await cache.match("/definitely-not-a-page");
      return hit ? { stored: true, cachedStatus: hit.status } : { stored: false };
    });
    await ctx.setOffline(true);
    const offlineOnPoisoned = await page
      .goto(base + "/definitely-not-a-page", { waitUntil: "domcontentloaded" })
      .then(async (r) => ({ status: r && r.status(), title: await page.title() }))
      .catch((e) => ({ threw: String(e.message).slice(0, 60) }));
    // The control the reviewer used: a URL never visited must still work.
    const offlineOnNeverVisited = await page
      .goto(base + "/never-visited-" + Date.now(), { waitUntil: "domcontentloaded" })
      .then(async (r) => ({ status: r && r.status(), title: await page.title() }))
      .catch((e) => ({ threw: String(e.message).slice(0, 60) }));
    await ctx.setOffline(false);
    // The check that matters most and fails most quietly: with no worker in
    // control, nothing is cached at all, so "the 404 was not cached" passes
    // while proving nothing about the fix.
    if (!controlling)
      floor.push("service worker was not controlling the page — the cache checks prove nothing");
    if (liveStatus !== 404)
      floor.push(`the 404 probe returned ${liveStatus}, so it never exercised the error path`);
    out.serviceWorker = {
      controlling,
      liveStatus,
      cached,
      offlineOnPoisoned,
      offlineOnNeverVisited,
    };
    await ctx.close();
  }
} finally {
  await browser.close();
}
out.floor = { passed: floor.length === 0, failures: floor };
console.log(JSON.stringify(out, null, 2));
if (floor.length > 0) process.exit(1);
