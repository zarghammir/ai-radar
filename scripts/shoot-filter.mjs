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

const args = process.argv.slice(2);
const base =
  args.find((a) => !a.startsWith("--")) || process.env.VERIFY_URL || "http://127.0.0.1:3210";

/**
 * Which sections to run. They are independent by design and they need
 * DIFFERENT BUILDS, which is the reason this flag exists rather than a
 * convenience: the pair needs a corpus containing both built and non-built
 * things, and the quiet shot needs a build whose brief window comes from the
 * preferences API. Without the flag, running on live data bails at the pair's
 * floor and never reaches the quiet section at all.
 */
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? "all";
if (!["all", "pair", "quiet"].includes(only)) {
  console.error(`--only must be one of all|pair|quiet, got "${only}"`);
  process.exit(2);
}
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
    .locator('[role="group"][aria-label="What kind of stories"] a[aria-current="true"]')
    .textContent();
  const want = expectView === "built" ? "Built" : "Built + news";
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
  if (only !== "quiet") {
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
          `there is no difference to photograph, so no files were written. ` +
          `DO NOT take these shots by hand instead, and do not delete this check: ` +
          `both produce a pair of pictures that look like proof the filter works ` +
          `while showing that it did not. Find out why the sets match first.`,
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
  if (only !== "quiet") {
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

  /* ---- the honest empty state, reached the way a reader reaches it ------ */
  //
  // NOT PLANTED. The brief time is moved forward through the real preferences
  // API so the reading window genuinely opens a minute ago and genuinely has
  // nothing in it. A screenshot of a state produced by stubbing the query would
  // prove the stub works. This proves the page works.
  //
  // The original brief time is restored in the `finally` below whatever
  // happens, because leaving a dev database with a 17:44 brief window would
  // make every later run of verify-today measure an empty page and blame the
  // app.
  let originalBriefTime = null;
  if (only !== "pair")
    try {
      const mark = sectionStart(floor);
      const prefs = await fetch(`${base}/api/preferences`).then((r) => r.json());
      originalBriefTime = prefs.briefTime;
      const tz = prefs.timezone;

      const aMinuteAgo = new Date(Date.now() - 60_000);
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(aMinuteAgo);
      const at = (type) => parts.find((part) => part.type === type).value;
      const briefTime = `${at("hour")}:${at("minute")}`;

      const put = await fetch(`${base}/api/preferences`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ briefTime }),
      });
      if (!put.ok) floor.push(`could not move the brief time to ${briefTime}: HTTP ${put.status}`);
      bailIfBroken(floor, mark);

      const ctx = await browser.newContext({ viewport: PHONE, colorScheme: "dark" });
      await markOnboarded(ctx, base);
      const page = await ctx.newPage();
      await page.goto(`${base}/?view=built`, { waitUntil: "networkidle" });

      // The window really is empty, rather than the page having failed to render
      // its cards. Without this the shot below could be of a broken list.
      const stillThere = await cards(page).count();
      if (stillThere !== 0)
        floor.push(`the brief window was moved to ${briefTime} and ${stillThere} stories remain`);

      // The same property the CI check asserts, and for the same reason: the
      // screen has to TELL the reader something. No opinion about the words.
      //
      // COUNTED BEFORE IT IS READ. The first version called .textContent()
      // straight away, and when the empty state was not on the page at all —
      // which is exactly what happens in fixture mode, where the brief window
      // comes from the fixture store and not from the preferences this section
      // just moved — Playwright waited thirty seconds and threw. The run died on
      // a TimeoutError naming a locator, with the floor never printed and four
      // good screenshots already on disk looking like the output of a failed run.
      // That is precisely the defect scripts/lib/floor.mjs was written for, in a
      // file I added hours after writing that comment.
      const emptyStates = await page.locator("[data-empty-body]").count();
      if (emptyStates === 0) {
        floor.push(
          `the brief window was moved to ${briefTime} and the page still shows no empty state — ` +
            `if this is a fixture-mode build, the window comes from the fixture store rather than ` +
            `from preferences, so the quiet shot has to be taken against a live-data build`,
        );
      } else {
        const said = (await page.locator("[data-empty-body]").first().textContent()) ?? "";
        if (said.trim().length < 60)
          floor.push(`the quiet page explained itself in ${said.trim().length} characters`);
      }
      bailIfBroken(floor, mark);

      await shoot(page, {
        name: "today-quiet-phone-dark",
        expectView: "built",
        expectState: "quiet",
        what: `A genuinely quiet day: the window opened at ${briefTime} and nothing has been built since. The database ANSWERED — this is not the unreachable state.`,
      });

      await ctx.close();
    } finally {
      if (originalBriefTime) {
        const restore = await fetch(`${base}/api/preferences`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ briefTime: originalBriefTime }),
        });
        console.log(`brief time restored to ${originalBriefTime}: HTTP ${restore.status}`);
        if (!restore.ok) floor.push(`FAILED TO RESTORE briefTime to ${originalBriefTime}`);
      }
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
