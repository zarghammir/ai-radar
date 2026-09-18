/**
 * The pictures #102's acceptance needs, taken from a production build.
 *
 *   npx next build && npx next start -p 3210
 *   npm run shots:filter
 *
 * WHY THIS IS A SCRIPT AND NOT A BROWSER AND A KEYBOARD. Every screenshot in
 * docs/ before this file was taken by hand, which is how #108 reached a
 * reviewer with no pictures at all and how seven shell shots came to show a
 * six-tab navigation bar the app has not had since #102. A picture taken by
 * hand has no floor, records nothing about what it was pointed at, and cannot
 * be retaken by anyone else.
 *
 * WHAT MAKES THESE PARTICULAR SHOTS EVIDENCE. #102's acceptance is that the
 * two positions of the view control return DIFFERENT SETS. A picture can prove
 * that — the story count is rendered in the summary line, so two shots at the
 * same moment with two different counts is the property, visible. But only if
 * the counts really differ, so this script MEASURES the two counts and REFUSES
 * TO WRITE THE FILES if they do not. A screenshot pair that quietly shows the
 * same number twice would look like evidence and prove the opposite.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { launchBrowser, requireServer } from "./lib/browser.mjs";
import { bailIfBroken, isFloorBail, sectionStart } from "./lib/floor.mjs";
import { markOnboarded } from "./lib/seed.mjs";

const base = process.argv[2] || process.env.VERIFY_URL || "http://127.0.0.1:3210";
await requireServer(base);

const DIR = "docs/screenshots/filter";
/** Below this the comparison is not worth photographing: 1 vs 2 proves little. */
const MIN_BUILT = 2;

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1440, height: 900 };

const floor = [];
const shots = [];
const browser = await launchBrowser();
let onboarded = false;

const cards = (page) => page.locator("article h2 a");
const screenState = (page) =>
  page.locator("[data-screen-state]").first().getAttribute("data-screen-state");

/**
 * Take one shot, having first proved the page is the page we think it is.
 * The route, the screen state and the control's own position are all checked
 * BEFORE the shutter, because a shot of the wrong page is worse than none: it
 * is wrong evidence with a confident filename.
 */
async function shoot(page, { name, expectView, expectState, what }) {
  const state = await screenState(page);
  if (state !== expectState) {
    floor.push(`${name}: expected data-screen-state="${expectState}", found "${state}"`);
    return null;
  }
  const selected = await page
    .locator('[role="group"][aria-label="What to show"] a[aria-current="true"]')
    .textContent();
  const want = expectView === "built" ? "Built" : "Everything";
  if ((selected ?? "").trim() !== want) {
    floor.push(`${name}: the control reads "${(selected ?? "").trim()}", expected "${want}"`);
    return null;
  }
  const file = `${DIR}/${name}.png`;
  await page.screenshot({ path: file });
  shots.push({ file, what, url: page.url() });
  return file;
}

try {
  await mkdir(DIR, { recursive: true });

  /* ---- the two positions, at the same moment, on the same device -------- */
  {
    const mark = sectionStart(floor);
    const ctx = await browser.newContext({ viewport: PHONE, colorScheme: "dark" });
    onboarded = await markOnboarded(ctx, base);
    const page = await ctx.newPage();

    await page.goto(`${base}/?view=built`, { waitUntil: "networkidle" });
    const built = await cards(page).count();
    if (built < MIN_BUILT)
      floor.push(`only ${built} stories on Built; the pair cannot show a difference worth seeing`);
    bailIfBroken(floor, mark);
    await shoot(page, {
      name: "today-built-phone-dark",
      expectView: "built",
      expectState: "brief",
      what: `The app as it opens. ${built} things people built.`,
    });

    await page.goto(`${base}/?view=all`, { waitUntil: "networkidle" });
    const all = await cards(page).count();

    // THE PROPERTY. Not a nicety: if these are equal the filter is not
    // filtering, and two photographs of the same number would be presented as
    // proof that it does.
    if (!(all > built))
      floor.push(
        `the two positions returned the SAME SET (${built} on Built, ${all} on Everything) — ` +
          `there is no difference to photograph, so no files were written`,
      );
    bailIfBroken(floor, mark);
    await shoot(page, {
      name: "today-all-phone-dark",
      expectView: "all",
      expectState: "brief",
      what: `One tap wider: ${all} stories, the same moment. ${all - built} more than Built.`,
    });

    await ctx.close();
  }

  /* ---- the same pair on a laptop, where both fit above the fold --------- */
  {
    const mark = sectionStart(floor);
    const ctx = await browser.newContext({ viewport: LAPTOP, colorScheme: "light" });
    await markOnboarded(ctx, base);
    const page = await ctx.newPage();

    await page.goto(`${base}/?view=built`, { waitUntil: "networkidle" });
    const built = await cards(page).count();
    bailIfBroken(floor, mark);
    await shoot(page, {
      name: "today-built-laptop-light",
      expectView: "built",
      expectState: "brief",
      what: `The control and the count in one frame: ${built} built things.`,
    });

    await page.goto(`${base}/?view=all`, { waitUntil: "networkidle" });
    const all = await cards(page).count();
    if (!(all > built)) floor.push(`laptop pair returned the same set (${built} vs ${all})`);
    bailIfBroken(floor, mark);
    await shoot(page, {
      name: "today-all-laptop-light",
      expectView: "all",
      expectState: "brief",
      what: `The same frame widened: ${all}.`,
    });

    await ctx.close();
  }

  await writeFile(`${DIR}/shots.json`, JSON.stringify({ base, shots }, null, 2) + "\n");
} catch (error) {
  if (!isFloorBail(error)) throw error;
} finally {
  await browser.close();
}

console.log(JSON.stringify({ base, onboarded, shots }, null, 2));

if (floor.length) {
  console.error("\nFLOOR BROKEN — these shots are not evidence:");
  for (const line of floor) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`\n${shots.length} shots written to ${DIR}`);
