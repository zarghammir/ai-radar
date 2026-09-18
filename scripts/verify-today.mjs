/**
 * The four behaviours issue #13 requires, driven in a real browser against a
 * production build.
 *
 *   npx next build && npx next start -p 3210
 *   npm run verify:today
 *
 * Every check carries a FLOOR and the script exits 1 if it measured nothing.
 * The floor that matters most here is the story count: a Today page rendering
 * ZERO cards would make "the 5-minute switch shortens the list" trivially true
 * (0 is not more than 0), "hide removed the card" trivially true (there was no
 * card), and the whole run would sweep clean while the page was blank.
 */
import { launchBrowser, requireServer } from "./lib/browser.mjs";
import { bailIfBroken, isFloorBail, sectionStart } from "./lib/floor.mjs";
import { markOnboarded } from "./lib/seed.mjs";

// VIEW PINNED TO "all" THROUGHOUT THIS FILE. #102 made the app open on built
// things, which is 4 of the 7 fixture stories — and a 5-minute budget cannot
// shorten a 4-story list, so the reading-length assertions below started failing
// on a filter that was working perfectly. The two are separate axes: this file
// measures LENGTH, so it holds the view still. The default view is exercised by
// the accessibility sweep and by the empty-state step in CI.
const base = process.argv[2] || process.env.VERIFY_URL || "http://127.0.0.1:3210";
await requireServer(base);

/** The brief must never be emptier than this for the assertions to mean anything. */
const MIN_STORIES = 2;

const out = {};
const floor = [];
const browser = await launchBrowser();
// Whether the LIVE half of the seeding applied. markOnboarded writes both
// sides in one call, so a context cannot end up half-seeded by a forgotten
// line — which is exactly how verify-saved-settings was missed.
let onboardedOnServer = false;

const cards = (page) => page.locator("article h2 a");

try {
  /* ---- 1. the reading-length switch actually shortens the list ---------- */
  {
    const mark = sectionStart(floor);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    // The first-run gate is in the root layout, so an unseeded context asking
    // for Today is sent to /welcome and every locator below waits on a page
    // that is not there.
    onboardedOnServer = await markOnboarded(ctx, base);
    const page = await ctx.newPage();

    await page.goto(`${base}/?length=all&view=all`, { waitUntil: "networkidle" });
    const all = await cards(page).count();
    await page.goto(`${base}/?length=10&view=all`, { waitUntil: "networkidle" });
    const ten = await cards(page).count();
    await page.goto(`${base}/?length=5&view=all`, { waitUntil: "networkidle" });
    const five = await cards(page).count();

    if (all < MIN_STORIES)
      floor.push(`only ${all} stories at length=all; the page is effectively empty`);
    if (five < 1) floor.push("length=5 rendered no stories at all");

    // A COUNT FLOOR IS NOT ENOUGH HERE, and that gap is why this file went red
    // on a working build. MIN_STORIES guards against an empty page, but the
    // assertion below needs something stronger: the brief has to run LONGER
    // than five minutes before a five-minute budget can shorten anything. Five
    // one-minute stories clear MIN_STORIES easily and still leave `five < all`
    // impossible to satisfy, so the check reports that the reading-length
    // switch is broken on a switch that is working.
    //
    // The same hole existed in verify-saved-settings.mjs and is fixed there
    // too. The general shape: a test whose quantity cannot vary across the
    // defect is vacuous, and a vacuous test that FAILS is worse than one that
    // passes, because it sends the next person hunting a bug that is not there.
    const wholeBrief = await fetch(`${base}/api/brief?view=all&length=all`).then((r) => r.json());
    if (!(wholeBrief.readingMinutes > 5)) {
      floor.push(
        `the corpus is too short to measure the reading-length switch: the whole brief runs ` +
          `${wholeBrief.readingMinutes} minute(s), so a 5-minute budget has nothing to cut. ` +
          `Seed more stories rather than relaxing the assertion below.`,
      );
    }
    bailIfBroken(floor, mark);

    out.readingLength = {
      all,
      ten,
      five,
      shortens: five < all,
      // The contract: at least one story even if it exceeds the budget.
      neverEmpty: five >= 1,
    };
    if (!(five < all))
      floor.push(
        `the 5-minute brief did not shorten the list (${five} vs ${all}) and the whole brief runs ` +
          `${wholeBrief.readingMinutes} minutes, so the budget HAD something to cut`,
      );
    await ctx.close();
  }

  /* ---- 2. save toggles, and survives a reload -------------------------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    // The first-run gate is in the root layout, so an unseeded context asking
    // for Today is sent to /welcome and every locator below waits on a page
    // that is not there.
    onboardedOnServer = await markOnboarded(ctx, base);
    const mark = sectionStart(floor);
    const page = await ctx.newPage();
    await page.goto(`${base}/?length=all&view=all`, { waitUntil: "networkidle" });

    const saveButtons = page.getByRole("button", { name: /^Save$/ });
    const before = await saveButtons.count();
    if (before < 1) floor.push("no Save button on the page; nothing to toggle");
    // Before the click. With zero buttons the click throws a timeout and the
    // line above never prints — the same ordering defect the reviewer found in
    // verify-shell.mjs, one file over.
    bailIfBroken(floor, mark);

    await saveButtons.first().click();
    await page.waitForTimeout(250);
    const savedNow = await page.getByRole("button", { name: /^Saved$/ }).count();

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(250);
    const savedAfterReload = await page.getByRole("button", { name: /^Saved$/ }).count();

    out.save = {
      saveButtonsBefore: before,
      savedAfterClick: savedNow,
      savedAfterReload,
      togglesAndPersists: savedNow >= 1 && savedAfterReload >= 1,
    };
    if (savedNow < 1) floor.push("clicking Save did not produce a Saved state");
    await ctx.close();
  }

  /* ---- 3. hide removes the card, and it stays hidden ------------------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    // The first-run gate is in the root layout, so an unseeded context asking
    // for Today is sent to /welcome and every locator below waits on a page
    // that is not there.
    onboardedOnServer = await markOnboarded(ctx, base);
    const mark = sectionStart(floor);
    const page = await ctx.newPage();
    await page.goto(`${base}/?length=all&view=all`, { waitUntil: "networkidle" });

    const before = await cards(page).count();
    if (before < MIN_STORIES)
      floor.push(`only ${before} stories before hiding; too few to prove removal`);
    // Before the Hide click, for the same reason as the Save one above.
    bailIfBroken(floor, mark);
    const firstTitle = before > 0 ? await cards(page).first().innerText() : null;

    await page
      .getByRole("button", { name: /^Hide$/ })
      .first()
      .click();
    await page.waitForTimeout(250);
    const after = await cards(page).count();

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(250);
    const afterReload = await cards(page).count();
    const titlesAfterReload = await cards(page).allInnerTexts();

    out.hide = {
      before,
      afterHide: after,
      afterReload,
      removedOne: after === before - 1,
      staysHidden: afterReload === before - 1,
      hiddenTitleGone: firstTitle ? !titlesAfterReload.includes(firstTitle) : null,
    };
    if (after !== before - 1) floor.push(`hiding changed the count from ${before} to ${after}`);
    await ctx.close();
  }

  /* ---- 3b. the three screen states are TOLD APART, not inferred ---------
   *
   * "No stories rendered" is true of a quiet morning AND of a database we
   * cannot reach. An assertion that cannot separate them passes for the broken
   * one, so each state names itself in the DOM and this reads the name.
   *
   * Run against a live database:   npm run verify:today
   * Run against an empty one:      seed nothing, then the same command
   * Run against no database:       DATABASE_URL=postgres://nope/nope npm start
   */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    // This block was written BEFORE the first-run gate existed and arrived in
    // this tree through the rebase onto it. Unseeded, it is sent to /welcome,
    // there is no data-screen-state marker, and the floor below fires "the
    // states cannot be told apart" — about a page that has no states because
    // it is the wrong page. A rebase can import a pre-gate assumption into a
    // post-gate tree, and neither the merge nor the type checker can see it.
    onboardedOnServer = await markOnboarded(ctx, base);
    const mark = sectionStart(floor);
    const page = await ctx.newPage();
    await page.goto(`${base}/?length=all&view=all`, { waitUntil: "networkidle" });
    const landed = new URL(page.url()).pathname;
    if (landed !== "/") floor.push(`the screen-state check asked for / and landed on ${landed}`);
    bailIfBroken(floor, mark);
    const state = await page.getAttribute("[data-screen-state]", "data-screen-state");
    const storyCount = await cards(page).count();
    const text = (await page.locator("main").innerText()).toLowerCase();

    out.screenState = {
      state,
      storyCount,
      // The distinction a reader has to be able to make without knowing what a
      // database is: one of these says nothing happened, the other says we do
      // not know what happened.
      saysQuietMorning: text.includes("quiet morning"),
      saysCannotReach: text.includes("cannot reach"),
    };

    if (!state) floor.push("no data-screen-state on the page; the states cannot be told apart");
    if (!["brief", "quiet", "unreachable"].includes(state ?? "")) {
      floor.push(`unexpected screen state ${JSON.stringify(state)}`);
    }
    // Whatever state it is in, it must be INTERNALLY consistent: the marker,
    // the story count and the words on screen must agree.
    if (state === "brief" && storyCount < 1) floor.push("state=brief but no stories rendered");
    if (state === "quiet" && storyCount > 0) floor.push("state=quiet but stories rendered");
    if (state === "unreachable" && !out.screenState.saysCannotReach) {
      floor.push("state=unreachable but the screen does not say it cannot reach anything");
    }
    if (state === "quiet" && out.screenState.saysCannotReach) {
      floor.push("a quiet morning is being described as a failure");
    }
    if (state === "unreachable" && out.screenState.saysQuietMorning) {
      floor.push("an unreachable database is being described as a quiet morning");
    }
    await ctx.close();
  }

  /* ---- 4. the story-count floor across every state the ticket names ---- */
  {
    const perState = {};
    for (const width of [390, 1440]) {
      for (const theme of ["light", "dark"]) {
        const ctx = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme: theme,
        });
        onboardedOnServer = await markOnboarded(ctx, base);
        const page = await ctx.newPage();
        await page.addInitScript((t) => {
          try {
            localStorage.setItem("ai-radar-theme", t);
          } catch {}
        }, theme);
        await page.goto(`${base}/?length=all&view=all`, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        const count = await cards(page).count();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        perState[`${width}/${theme}`] = { stories: count, horizontalOverflow: overflow };
        if (count < MIN_STORIES) floor.push(`${width}/${theme} rendered ${count} stories`);
        if (overflow > 0) floor.push(`${width}/${theme} overflows horizontally by ${overflow}px`);
        await ctx.close();
      }
    }
    out.states = perState;
  }
} catch (error) {
  // A bail is a reported failure, not a crash — no stack trace over the floor.
  if (!isFloorBail(error)) throw error;
} finally {
  await browser.close();
}

out.onboardedOnServer = onboardedOnServer;
out.floor = { passed: floor.length === 0, failures: floor, minStories: MIN_STORIES };
console.log(JSON.stringify(out, null, 2));
if (floor.length > 0) process.exit(1);
