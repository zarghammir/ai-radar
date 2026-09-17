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
import { bailIfBroken, isFloorBail } from "./lib/floor.mjs";
import { markOnboarded, markOnboardedOnServer } from "./lib/seed.mjs";

const base = process.argv[2] || process.env.VERIFY_URL || "http://127.0.0.1:3210";
await requireServer(base);

/** The brief must never be emptier than this for the assertions to mean anything. */
const MIN_STORIES = 2;

const out = {};
const floor = [];
const browser = await launchBrowser();
// Onboarding, written where a LIVE build keeps it. The localStorage seeding in
// each context covers fixture builds; this covers the other mode, which is the
// one CI switches to when #65 lands. Neither is required to succeed.
const onboardedOnServer = await markOnboardedOnServer(base);

const cards = (page) => page.locator("article h2 a");

try {
  /* ---- 1. the reading-length switch actually shortens the list ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    // The first-run gate is in the root layout, so an unseeded context asking
    // for Today is sent to /welcome and every locator below waits on a page
    // that is not there.
    await markOnboarded(ctx);
    const page = await ctx.newPage();

    await page.goto(`${base}/?length=all`, { waitUntil: "networkidle" });
    const all = await cards(page).count();
    await page.goto(`${base}/?length=10`, { waitUntil: "networkidle" });
    const ten = await cards(page).count();
    await page.goto(`${base}/?length=5`, { waitUntil: "networkidle" });
    const five = await cards(page).count();

    if (all < MIN_STORIES)
      floor.push(`only ${all} stories at length=all; the page is effectively empty`);
    if (five < 1) floor.push("length=5 rendered no stories at all");

    out.readingLength = {
      all,
      ten,
      five,
      shortens: five < all,
      // The contract: at least one story even if it exceeds the budget.
      neverEmpty: five >= 1,
    };
    if (!(five < all))
      floor.push(`the 5-minute brief did not shorten the list (${five} vs ${all})`);
    await ctx.close();
  }

  /* ---- 2. save toggles, and survives a reload -------------------------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    // The first-run gate is in the root layout, so an unseeded context asking
    // for Today is sent to /welcome and every locator below waits on a page
    // that is not there.
    await markOnboarded(ctx);
    const page = await ctx.newPage();
    await page.goto(`${base}/?length=all`, { waitUntil: "networkidle" });

    const saveButtons = page.getByRole("button", { name: /^Save$/ });
    const before = await saveButtons.count();
    if (before < 1) floor.push("no Save button on the page; nothing to toggle");
    // Before the click. With zero buttons the click throws a timeout and the
    // line above never prints — the same ordering defect the reviewer found in
    // verify-shell.mjs, one file over.
    bailIfBroken(floor);

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
    await markOnboarded(ctx);
    const page = await ctx.newPage();
    await page.goto(`${base}/?length=all`, { waitUntil: "networkidle" });

    const before = await cards(page).count();
    if (before < MIN_STORIES)
      floor.push(`only ${before} stories before hiding; too few to prove removal`);
    // Before the Hide click, for the same reason as the Save one above.
    bailIfBroken(floor);
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

  /* ---- 4. the story-count floor across every state the ticket names ---- */
  {
    const perState = {};
    for (const width of [390, 1440]) {
      for (const theme of ["light", "dark"]) {
        const ctx = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme: theme,
        });
        await markOnboarded(ctx);
        const page = await ctx.newPage();
        await page.addInitScript((t) => {
          try {
            localStorage.setItem("ai-radar-theme", t);
          } catch {}
        }, theme);
        await page.goto(`${base}/?length=all`, { waitUntil: "networkidle" });
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
