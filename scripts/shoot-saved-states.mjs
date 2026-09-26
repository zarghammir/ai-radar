/**
 * The three things the Saved page can be, photographed at phone width.
 *
 *   npx next start -p 3210 && npm run shots:saved
 *
 * WHY THIS EXISTS. The owner reported "the save button doesn't work" from an
 * installed PWA. The button was fine. His device was holding a saved id with no
 * card to go with it, and the Saved page reported that as "Nothing saved" —
 * telling him the thing he had just saved did not exist. The two states below
 * that matter are UNREADABLE and EMPTY, and the whole fix is that they no
 * longer look the same.
 *
 * IT ASSERTS THE CASE, NOT THE PROSE. Every floor reads `data-screen-state` and
 * `data-unresolved`. Matching the sentence would pin the wording and pass on
 * the day the wording changes but the case is wrong, which is the failure this
 * screen already exists to prevent.
 *
 * WRITES ARE BUFFERED. Nothing reaches disk until every floor has passed, so a
 * red run and a green run cannot leave the same tree — PR #153, finding 2.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { launchBrowser, requireServer } from "./lib/browser.mjs";
import { markOnboarded } from "./lib/seed.mjs";

const args = process.argv.slice(2);
const base =
  args.find((a) => !a.startsWith("--")) || process.env.VERIFY_URL || "http://127.0.0.1:3210";
await requireServer(base);

const DIR = "docs/screenshots/saved";
const SAVED_KEY = "ai-radar-fixture-saved";
const MARKS_KEY = "ai-radar-fixture-marks";

/**
 * THE THREE CASES.
 *
 * `unreadable` is the owner's device: the id key landed and the marks key did
 * not. It is seeded as RAW STRINGS rather than produced by clicking, because
 * the whole point is that the app can no longer reach this state on its own —
 * the fix made saving atomic. A device that is already in it must still be told
 * the truth, and that is what this photographs.
 */
const CASES = [
  {
    name: "empty",
    seed: {},
    expect: { state: "empty", unresolved: "0" },
    shows: "a reader who has genuinely saved nothing",
  },
  {
    name: "unreadable",
    seed: { [SAVED_KEY]: "[1275]" },
    expect: { state: "unreachable", unresolved: "1" },
    shows: "the owner's device: a save this device cannot draw",
  },
  {
    name: "list",
    // NO SEED. This state is produced by PRESSING SAVE on a real story, not by
    // planting a card: a fabricated snapshot would photograph a screen no
    // reader can reach, and it would skip the very write this change rewrote.
    seed: {},
    viaClick: true,
    expect: { state: "list", unresolved: "0" },
    shows: "an ordinary save, made by clicking Save on today's brief",
  },
];

const floor = [];
const shots = [];
const pending = [];
const browser = await launchBrowser();

try {
  await mkdir(DIR, { recursive: true });

  for (const testCase of CASES) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: "dark",
    });
    await markOnboarded(ctx, base);
    await ctx.addInitScript((seed) => {
      try {
        for (const [key, value] of Object.entries(seed)) window.localStorage.setItem(key, value);
      } catch {
        // Reported by the floor below as a missing state, not swallowed here.
      }
    }, testCase.seed);

    const page = await ctx.newPage();

    if (testCase.viaClick) {
      // The reader's own route to a saved story: Today, then the button.
      await page.goto(`${base}/?length=all&view=all`, { waitUntil: "networkidle" });
      // Located by POSITION, never by the text "Save": a locator that selects
      // on the state you are about to change re-resolves after the click and
      // silently re-points at the next card that still says "Save".
      const button = page.locator("article").first().locator("button").first();
      if ((await button.count()) === 0) {
        floor.push(`${testCase.name}: no story card on Today, so nothing could be saved`);
        await ctx.close();
        continue;
      }
      const before = (await button.innerText()).trim();
      await button.click();
      await page.waitForTimeout(1200);
      const after = (await button.innerText()).trim();
      if (!(before === "Save" && after === "Saved")) {
        floor.push(
          `${testCase.name}: the button went "${before}" -> "${after}", expected Save -> Saved`,
        );
        await ctx.close();
        continue;
      }
    }

    await page.goto(`${base}/saved`, { waitUntil: "networkidle" });

    // The screen names "loading" deliberately, so waiting for the attribute to
    // stop being "loading" is a real wait rather than a sleep.
    const marker = page.locator("[data-screen-state]").first();
    try {
      await marker.waitFor({ timeout: 10000 });
      await page
        .locator('[data-screen-state]:not([data-screen-state="loading"])')
        .first()
        .waitFor({ timeout: 10000 });
    } catch {
      floor.push(`${testCase.name}: the screen never left "loading"`);
      await ctx.close();
      continue;
    }

    const state = await marker.getAttribute("data-screen-state");
    const unresolved = await marker.getAttribute("data-unresolved");

    if (state !== testCase.expect.state) {
      floor.push(
        `${testCase.name}: data-screen-state is "${state}", expected "${testCase.expect.state}"`,
      );
    }
    if (unresolved !== testCase.expect.unresolved) {
      floor.push(
        `${testCase.name}: data-unresolved is "${unresolved}", expected "${testCase.expect.unresolved}"`,
      );
    }

    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");

    // THE ONE PROSE ASSERTION, and it is a NEGATIVE on the sentence that caused
    // the bug report. "Nothing saved" on a device holding a save is the defect
    // itself, so it is worth pinning that those exact words cannot come back.
    if (testCase.name === "unreadable" && /Nothing saved/i.test(body)) {
      floor.push(`${testCase.name}: still says "Nothing saved" while holding an unresolved id`);
    }

    const file = `${DIR}/saved-${testCase.name}.png`;
    pending.push({ file, bytes: await page.screenshot({ fullPage: true }) });
    shots.push({ file, state, unresolved, shows: testCase.shows });
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ shots, floor }, null, 2));

if (floor.length > 0) {
  console.error(
    `\n${floor.length} floor failure(s) — these shots are NOT evidence:\n` +
      floor.map((f) => `  - ${f}`).join("\n") +
      `\n(${pending.length} screenshot(s) discarded rather than left on disk)`,
  );
  process.exit(1);
}

for (const shot of pending) await writeFile(shot.file, shot.bytes);
console.log(`\n${pending.length} shots written to ${DIR}`);
