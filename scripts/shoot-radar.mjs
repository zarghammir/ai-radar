/**
 * #14's acceptance, measured, and the pictures that go with it.
 *
 *   npx next build && npx next start -p 3210
 *   npm run shots:radar
 *
 * WHAT #14 ASKS TO BE SHOWN, and so what this measures rather than asserts in
 * a comment:
 *   - choosing Research shows only papers;
 *   - Importance order matches the order /api/radar returns;
 *   - a URL carrying filters restores them;
 *   - the keyboard reaches every chip.
 *
 * THE ORDER CHECK COMPARES THE PAGE AGAINST THE API, not against itself. A
 * page that sorts client-side would pass any check written purely on rendered
 * rows while quietly disagreeing with the pagination the "Load more" button
 * continues — the cursor is the API's, so the page's order has to be too.
 *
 * NOTHING IS WRITTEN UNTIL EVERY FLOOR HAS PASSED, the rule
 * shoot-brief-states.mjs set: a red run and a green run must not leave an
 * identical working tree, or the images from a failed run get committed as
 * evidence of nothing.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { launchBrowser, requireServer } from "./lib/browser.mjs";
import { markOnboarded } from "./lib/seed.mjs";

const args = process.argv.slice(2);
const base =
  args.find((a) => !a.startsWith("--")) || process.env.VERIFY_URL || "http://127.0.0.1:3210";
await requireServer(base);

const DIR = "docs/screenshots/radar";
const VIEWS = [
  { key: "laptop-light", width: 1440, height: 1000, colorScheme: "light" },
  { key: "laptop-dark", width: 1440, height: 1000, colorScheme: "dark" },
  { key: "phone-light", width: 390, height: 900, colorScheme: "light" },
  { key: "phone-dark", width: 390, height: 900, colorScheme: "dark" },
];
const CHIPS = ["all", "news", "research", "models", "releases", "community"];
/** Below this the order comparison proves too little to be worth a floor. */
const MIN_ROWS = 3;

const floor = [];
const shots = [];
const checks = [];
const pending = [];
const browser = await launchBrowser();

const rows = (page) => page.locator("article[data-story-id]");
const ids = (page) =>
  rows(page).evaluateAll((els) => els.map((el) => Number(el.dataset.storyId)));

async function apiIds(path) {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return (await res.json()).stories.map((s) => s.id);
}

try {
  await mkdir(DIR, { recursive: true });

  for (const view of VIEWS) {
    const ctx = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      colorScheme: view.colorScheme,
    });
    await markOnboarded(ctx, base);
    const page = await ctx.newPage();
    await page.goto(`${base}/radar`, { waitUntil: "networkidle" });

    const state = await page.getAttribute("[data-screen-state]", "data-screen-state");
    const count = await rows(page).count();
    if (state !== "feed" || count < MIN_ROWS) {
      floor.push(
        `${view.key}: /radar is "${state}" with ${count} rows — ` +
          "these pictures would show an empty screen, not the feed",
      );
      await ctx.close();
      continue;
    }

    for (const chip of CHIPS) {
      if ((await page.locator(`[data-radar-chip="${chip}"]`).count()) !== 1) {
        floor.push(`${view.key}: no "${chip}" chip`);
      }
    }

    pending.push({ file: `${DIR}/feed-${view.key}.png`, bytes: await page.screenshot() });
    shots.push({ file: `feed-${view.key}.png`, width: view.width, theme: view.colorScheme, rows: count });

    // CHOOSING RESEARCH SHOWS ONLY PAPERS. Clicked, not navigated: a chip that
    // cannot be operated at 390px is the defect the picture is meant to catch.
    await page.locator('[data-radar-chip="research"]').click();
    await page.waitForURL(/kind=research/, { timeout: 8000 });
    await page.waitForLoadState("networkidle");

    const types = await rows(page).evaluateAll((els) => [
      ...new Set(els.map((el) => el.dataset.contentType)),
    ]);
    const stray = types.filter((t) => t !== "RESEARCH" && t !== "PAPER");
    if (stray.length) floor.push(`${view.key}: Research also shows ${stray.join(", ")}`);
    const selected = await page.getAttribute('[data-radar-chip="research"]', "aria-current");
    if (selected !== "true") floor.push(`${view.key}: the Research chip does not read as chosen`);
    checks.push({ view: view.key, check: "research shows only papers", types });

    pending.push({ file: `${DIR}/research-${view.key}.png`, bytes: await page.screenshot() });
    shots.push({
      file: `research-${view.key}.png`,
      width: view.width,
      theme: view.colorScheme,
      rows: await rows(page).count(),
    });

    // THE URL RESTORES THE FILTERS. Loaded cold, so nothing in memory can be
    // carrying the state the link is supposed to carry.
    const url = "/radar?kind=research&sort=importance&range=30d";
    await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
    const chosen = await page
      .locator('[aria-current="true"][data-radar-chip], [aria-current="true"][data-radar-option]')
      .evaluateAll((els) =>
        els.map((el) => el.dataset.radarChip ?? el.dataset.radarOption).sort(),
      );
    const wanted = ["research", "range:30d", "sort:importance"].sort();
    if (JSON.stringify(chosen) !== JSON.stringify(wanted)) {
      floor.push(`${view.key}: ${url} restored ${JSON.stringify(chosen)}, not ${JSON.stringify(wanted)}`);
    }
    checks.push({ view: view.key, check: "a filtered URL restores its controls", chosen });

    // IMPORTANCE ORDER IS THE API'S ORDER.
    const page_ids = await ids(page);
    const api_ids = (
      await apiIds("/api/radar?sort=importance&since=30d&type=RESEARCH&type=PAPER")
    ).slice(0, page_ids.length);
    if (JSON.stringify(page_ids) !== JSON.stringify(api_ids)) {
      floor.push(
        `${view.key}: importance order differs from /api/radar — ` +
          `page ${JSON.stringify(page_ids.slice(0, 5))}, api ${JSON.stringify(api_ids.slice(0, 5))}`,
      );
    }
    checks.push({ view: view.key, check: "importance matches the API", compared: page_ids.length });

    // THE KEYBOARD REACHES EVERY CHIP. Tab from the top of the document until
    // each one has held focus; a chip that tabbing cannot reach is unusable
    // for a reader who does not point at things.
    await page.goto(`${base}/radar`, { waitUntil: "networkidle" });
    await page.locator("body").press("Tab");
    const reached = new Set();
    for (let i = 0; i < 60 && reached.size < CHIPS.length; i++) {
      const chip = await page.evaluate(() => document.activeElement?.dataset?.radarChip ?? null);
      if (chip) reached.add(chip);
      await page.keyboard.press("Tab");
    }
    const unreachable = CHIPS.filter((c) => !reached.has(c));
    if (unreachable.length) {
      floor.push(`${view.key}: tabbing never reached ${unreachable.join(", ")}`);
    }
    checks.push({ view: view.key, check: "every chip is tab-reachable", reached: [...reached] });

    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ base, checks, shots, floor }, null, 2));
if (floor.length) {
  console.error("\nFLOOR BROKEN — nothing was written. These shots are not evidence:");
  for (const f of floor) console.error(`  - ${f}`);
  console.error(`  (${pending.length} screenshot(s) discarded rather than left on disk)`);
  process.exit(1);
}
for (const shot of pending) await writeFile(shot.file, shot.bytes);
console.log(`\n${pending.length} shots written to ${DIR}`);
