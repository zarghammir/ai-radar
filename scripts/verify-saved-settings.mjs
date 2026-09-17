/**
 * The behaviours issue #16 requires, driven in a real browser against a
 * production build.
 *
 *   npx next build && npx next start -p 3210
 *   npm run verify:saved
 *
 * Every check carries a FLOOR and the script exits 1 if it measured nothing.
 * The floor that matters most is the saved-card count: a Saved page rendering
 * ZERO cards would make "the tag filter narrows the list" trivially true (0 is
 * not more than 0), "the note survived a reload" vacuous (there was no note to
 * lose), and the whole run would sweep clean over a blank screen.
 *
 * VERIFY_CONTROL=skip-seed runs WITHOUT seeding anything, so the floor must
 * fail. A floor that has only ever passed is not yet known to be able to fail.
 *
 * ONE THING THIS CANNOT REACH, said plainly rather than left to be assumed:
 * the "unreachable" state of Saved and Settings. On fixtures an unreadable
 * store is caught and answered as an empty one, so there is no way from here
 * to make the read FAIL rather than come back empty. That mapping is covered
 * in src/lib/api/saved-store.test.ts, which drives the store directly and has
 * a control proving it reddens.
 */
import { launchBrowser, requireServer } from "./lib/browser.mjs";
import { collectStoryIds } from "./lib/fixture-ids.mjs";
import { bailIfBroken, isFloorBail } from "./lib/floor.mjs";

const base = process.argv[2] || process.env.VERIFY_URL || "http://127.0.0.1:3210";
await requireServer(base);

const CONTROL = process.env.VERIFY_CONTROL || null;
/** The bin must never be emptier than this for the assertions to mean anything. */
const MIN_SAVED = 2;

/** Read from the running app, never typed here — see lib/fixture-ids.mjs. */
const SEED_STORY_COUNT = 3;
/** Marks a context as already seeded; see seededContext below for why. */
const SEED_SENTINEL = "verify-saved-seeded";
const MARKS_TEMPLATE = [
  { note: null, tags: ["ship"], savedAt: "2026-09-15T09:00:00.000Z" },
  { note: null, tags: ["read-later"], savedAt: "2026-09-14T09:00:00.000Z" },
  { note: null, tags: [], savedAt: "2026-09-13T09:00:00.000Z" },
];

const out = { control: CONTROL };
const floor = [];
const browser = await launchBrowser();
const SEED_IDS = await collectStoryIds(browser, base, SEED_STORY_COUNT);
const SEED_MARKS = Object.fromEntries(SEED_IDS.map((id, i) => [id, MARKS_TEMPLATE[i]]));
out.seededIds = SEED_IDS;

/**
 * A browser whose reader has finished onboarding and has a full bin.
 *
 * SEEDED EXACTLY ONCE, behind a sentinel key. addInitScript runs on EVERY
 * navigation, a reload included, so an unguarded seed writes the starting
 * state back over the page each time — and then every "it survived a reload"
 * assertion below measures the seed being re-applied rather than anything the
 * app stored. That is worse than vacuous: the check destroys the evidence it
 * exists to look for. The first run of this script failed exactly that way,
 * and the note assertion was the one that would have hidden it, because a note
 * silently re-seeded to null looks identical to one that was never written.
 */
async function seededContext() {
  const context = await browser.newContext({ viewport: { width: 390, height: 780 } });
  if (CONTROL !== "skip-seed") {
    await context.addInitScript(
      ([ids, marks, sentinel]) => {
        try {
          if (localStorage.getItem(sentinel) === "1") return;
          localStorage.setItem(
            "ai-radar-fixture-preferences",
            JSON.stringify({ onboardedAt: "2026-09-01T00:00:00.000Z" }),
          );
          localStorage.setItem("ai-radar-fixture-saved", JSON.stringify(ids));
          localStorage.setItem("ai-radar-fixture-marks", JSON.stringify(marks));
          localStorage.setItem(sentinel, "1");
        } catch {}
      },
      [SEED_IDS, SEED_MARKS, SEED_SENTINEL],
    );
  }
  return context;
}

const cards = (page) => page.locator("[data-screen-state='list'] article");

try {
  /* ---- 1. a reader who has never been here lands on the welcome --------- */
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 780 } });
    const page = await context.newPage();
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.waitForURL(/\/welcome$/, { timeout: 5000 }).catch(() => {});
    const landed = new URL(page.url()).pathname;
    out.firstRun = { landed };
    if (landed !== "/welcome") {
      floor.push(`a first-run reader opened / and stayed on ${landed}`);
    }

    // Finishing must stop it asking again. A gate that fires every visit is
    // the same defect as one that never fires, from the other side.
    await page.getByRole("button", { name: /Skip, use the defaults/i }).click();
    await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 5000 });
    await page.goto(base + "/saved", { waitUntil: "networkidle" });
    const after = new URL(page.url()).pathname;
    out.firstRun.afterSkipping = after;
    if (after !== "/saved") {
      floor.push(`after finishing onboarding, /saved redirected to ${after}`);
    }
    await context.close();
  }

  /* ---- 2. onboarding writes what it asked for --------------------------- */
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 780 } });
    const page = await context.newPage();
    await page.goto(base + "/welcome", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Set it up/i }).click();
    await page.locator("input[type='time']").fill("06:15");
    await page.getByRole("button", { name: /^Next$/ }).click();
    await page.getByRole("button", { name: /Start reading/i }).click();
    await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 5000 });

    await page.goto(base + "/settings", { waitUntil: "networkidle" });
    await page.waitForSelector("[data-settings-state='ready']", { timeout: 5000 }).catch(() => {});
    const stored = await page
      .locator("input[type='time']")
      .inputValue()
      .catch(() => null);
    out.onboardingWrites = { briefTime: stored };
    if (stored !== "06:15") {
      floor.push(`onboarding asked for 06:15 and Settings shows ${stored}`);
    }
    await context.close();
  }

  /* ---- 3. the saved list, its notes, its tags and its read marks -------- */
  {
    const context = await seededContext();
    const page = await context.newPage();
    await page.goto(base + "/saved", { waitUntil: "networkidle" });
    // Tolerant on purpose. Under VERIFY_CONTROL=skip-seed nothing is seeded,
    // the first-run gate sends this to /welcome, and there is no screen-state
    // marker at all. A hard wait would THROW here, and the control would then
    // exit 1 for a crash rather than for the floor it exists to redden — which
    // proves nothing about the floor.
    await page.waitForSelector("[data-screen-state]", { timeout: 5000 }).catch(() => {});

    const state = await page
      .getAttribute("[data-screen-state]", "data-screen-state")
      .catch(() => null);
    const count = await cards(page).count();
    out.saved = { state, count };
    // THE FLOOR. Everything below is about a list; this is the list existing.
    if (state !== "list") floor.push(`Saved is in state "${state}", not "list"`);
    if (count < MIN_SAVED) floor.push(`Saved rendered ${count} cards, floor is ${MIN_SAVED}`);

    if (count >= MIN_SAVED) {
      /* a note survives a reload — the write reached the store, not just React */
      const note = "Read before the Friday review.";
      await page
        .getByRole("button", { name: /Add a note/i })
        .first()
        .click();
      await page.locator("textarea").first().fill(note);
      await page
        .getByRole("button", { name: /Save note/i })
        .first()
        .click();
      await page.waitForTimeout(250);
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector("[data-screen-state='list']", { timeout: 5000 });
      const survived = await page.getByText(note, { exact: false }).count();
      out.saved.noteSurvivedReload = survived > 0;
      if (survived === 0) floor.push("a saved note was gone after a reload");

      /* a tag can be added, and it narrows the list when filtered on */
      const tag = "verify-tag";
      await page.getByPlaceholder("Add a tag").first().fill(tag);
      await page.getByRole("button", { name: /^Add$/ }).first().click();
      await page.waitForTimeout(250);
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector("[data-screen-state='list']", { timeout: 5000 });
      const before = await cards(page).count();
      await page.getByRole("radio", { name: tag, exact: true }).click();
      await page.waitForTimeout(250);
      const after = await cards(page).count();
      out.saved.tagFilter = { before, after };
      if (!(after > 0 && after < before)) {
        floor.push(`filtering by "${tag}" went from ${before} cards to ${after}`);
      }

      /* read state survives a reload too */
      await page.getByRole("radio", { name: "All", exact: true }).click();
      await page.waitForTimeout(150);
      await page
        .getByRole("button", { name: /Mark read/i })
        .first()
        .click();
      await page.waitForTimeout(250);
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector("[data-screen-state='list']", { timeout: 5000 });
      const readMarks = await page.getByRole("button", { name: /^Read$/ }).count();
      out.saved.readSurvivedReload = readMarks;
      if (readMarks < 1) floor.push("a story marked read came back unread after a reload");

      /* the archive control is PRESENT and DISABLED until #70 lands. Asserted
         so that removing it, or quietly enabling a button with no endpoint
         behind it, fails here rather than in front of a reader. */
      const archive = page.getByRole("button", { name: /^Archive$/ }).first();
      const present = await archive.count();
      const disabled = present ? await archive.isDisabled() : null;
      out.saved.archive = { present, disabled };
      if (present < 1) floor.push("the Archive control is not on the card at all");
      else if (disabled !== true)
        floor.push("the Archive control is enabled, with no endpoint behind it");
    }
    await context.close();
  }

  /* ---- 4. settings writes, and Today obeys the saved brief length ------- */
  {
    const context = await seededContext();
    const page = await context.newPage();
    await page.goto(base + "/settings", { waitUntil: "networkidle" });
    // Tolerant for the same reason as above: the control run has no settings
    // panel to wait for, and a throw here would be a crash wearing a floor's
    // exit code.
    const ready = await page
      .waitForSelector("[data-settings-state='ready']", { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    out.settings = { ready };
    if (!ready) {
      floor.push('Settings never reached "ready", so none of its writes were exercised');
      await context.close();
      bailIfBroken(floor);
    }

    await page.getByRole("radio", { name: /Five minutes/i }).check();
    await page.waitForTimeout(250);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("[data-settings-state='ready']", { timeout: 5000 });
    const stillFive = await page.getByRole("radio", { name: /Five minutes/i }).isChecked();
    out.settings.briefLengthSurvivedReload = stillFive;
    if (!stillFive) floor.push("the brief length chosen in Settings was gone after a reload");

    /**
     * THE POINT OF WIRING IT, assertable again since #75.
     *
     * Today resolves its default length on the SERVER. On fixtures the
     * preferences live in localStorage, which the server cannot see, so this
     * assertion was RETIRED in #74 — it was a true failure about the harness
     * rather than about the app. #75 mirrors the chosen length into one cookie
     * the server can read, which is the only reason Settings changes Today on
     * a build with no database, and that is the only kind of build the owner
     * can currently see.
     *
     * Five minutes is provably shorter than everything, so a Today that
     * ignored the preference would show the same count for both.
     */
    await page.goto(base + "/", { waitUntil: "networkidle" });
    const atPreference = await page.locator("article h2 a").count();
    await page.goto(base + "/?length=all", { waitUntil: "networkidle" });
    const atAll = await page.locator("article h2 a").count();
    out.settings.today = { atPreference, atAll };
    if (atPreference < 1) floor.push("Today rendered nothing at the saved length");
    if (!(atPreference < atAll)) {
      floor.push(
        `Today showed ${atPreference} stories at the saved 5-minute length and ${atAll} at ?length=all — the preference is not reaching the server`,
      );
    }

    // And the override still wins for one visit, so the cookie has not turned
    // the URL into a suggestion.
    await page.goto(base + "/?length=all", { waitUntil: "networkidle" });
    const overrideWins = (await page.locator("article h2 a").count()) === atAll;
    out.settings.urlStillOverrides = overrideWins;
    if (!overrideWins) floor.push("?length= no longer overrides the saved preference");

    await context.close();
  }
} catch (error) {
  if (!isFloorBail(error)) throw error;
} finally {
  await browser.close();
}

out.floor = { passed: floor.length === 0, failures: floor, minSaved: MIN_SAVED };
console.log(JSON.stringify(out, null, 2));
if (floor.length > 0) process.exit(1);
