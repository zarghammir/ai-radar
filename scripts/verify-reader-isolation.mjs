/**
 * The acceptance for the #91 ruling: two readers of the same instance do not
 * see each other's saves.
 *
 *   npx next build && node .next/standalone/server.js
 *   npm run verify:isolation
 *
 * Driven through the REAL path — a click on the Save button and a read of the
 * Saved screen — rather than by writing storage directly. Planted state would
 * meet the subject where the reader never goes.
 *
 * VERIFY_CONTROL=shared-identity gives the second browser the FIRST one's
 * storage, which is what "these two readers are the same reader" looks like
 * from inside the app. The isolation assertion must go red there. Without that
 * control this test asserts something that was already true before the change:
 * two fresh browsers have always started empty, and a test that only checks
 * they stay separate proves nothing about where the saves are kept.
 */
import { launchBrowser, requireServer } from "./lib/browser.mjs";
import { collectStoryIds } from "./lib/fixture-ids.mjs";
import { bailIfBroken, isFloorBail, sectionStart } from "./lib/floor.mjs";
import { markOnboarded } from "./lib/seed.mjs";

const base = process.argv[2] || process.env.VERIFY_URL || "http://127.0.0.1:3210";
await requireServer(base);

const CONTROL = process.env.VERIFY_CONTROL === "shared-identity";
const out = { control: CONTROL ? "shared-identity" : null };
const floor = [];
const browser = await launchBrowser();

/** Saves the card at `index` on Today, through the button a reader presses. */
async function saveNth(context, index) {
  const page = await context.newPage();
  await page.goto(`${base}/?length=all`, { waitUntil: "networkidle" });
  const landed = new URL(page.url()).pathname;
  if (landed !== "/") return { landed, savedId: null };
  const card = page.locator("article[data-story-id]").nth(index);
  const savedId = Number(await card.getAttribute("data-story-id"));
  await card.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(250);
  return { landed, savedId };
}

/** What this browser's Saved screen actually lists. */
async function savedIds(context) {
  const page = await context.newPage();
  await page.goto(`${base}/saved`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-screen-state]", { timeout: 5000 }).catch(() => {});
  const state = await page
    .getAttribute("[data-screen-state]", "data-screen-state")
    .catch(() => null);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("[data-screen-state='list'] article[data-story-id]")].map((el) =>
      Number(el.dataset.storyId),
    ),
  );
  return { state, ids };
}

try {
  await collectStoryIds(browser, base, 2);
  const mark = sectionStart(floor);

  const first = await browser.newContext({ viewport: { width: 390, height: 780 } });
  await markOnboarded(first, base);
  const a = await saveNth(first, 0);

  // The control hands the second browser the first one's storage, which is the
  // only thing distinguishing them. Everything else about the two is identical.
  const second = CONTROL
    ? await browser.newContext({
        viewport: { width: 390, height: 780 },
        storageState: await first.storageState(),
      })
    : await browser.newContext({ viewport: { width: 390, height: 780 } });
  await markOnboarded(second, base);
  const b = await saveNth(second, 1);

  out.firstBrowser = { landed: a.landed, saved: a.savedId };
  out.secondBrowser = { landed: b.landed, saved: b.savedId };

  // THE FLOOR. Everything below is about two saves being kept apart; this is
  // the two saves existing and being different. Without it, two browsers that
  // both failed to save anything would "not see each other's saves" perfectly.
  if (a.landed !== "/" || b.landed !== "/") {
    floor.push(`asked for Today and landed on ${a.landed} / ${b.landed}`);
  }
  if (!a.savedId || !b.savedId) floor.push("one of the two browsers saved nothing");
  if (a.savedId && a.savedId === b.savedId) {
    floor.push(`both browsers saved the same story (${a.savedId}); the test cannot separate them`);
  }
  bailIfBroken(floor, mark);

  const listA = await savedIds(first);
  const listB = await savedIds(second);
  out.firstBrowser.sees = listA;
  out.secondBrowser.sees = listB;

  if (listA.state !== "list" || listB.state !== "list") {
    floor.push(`Saved is "${listA.state}" / "${listB.state}", not "list" in both`);
  }
  if (!listA.ids.includes(a.savedId)) floor.push("the first browser does not see its own save");
  if (!listB.ids.includes(b.savedId)) floor.push("the second browser does not see its own save");

  // The assertion the ruling is about.
  if (listA.ids.includes(b.savedId)) {
    floor.push(`the first browser can see the second browser's save (${b.savedId})`);
  }
  if (listB.ids.includes(a.savedId)) {
    floor.push(`the second browser can see the first browser's save (${a.savedId})`);
  }

  /* ---- and the same question for a SETTING, not just a save ------------
   *
   * #94 moved briefLength onto the device. Two browsers choosing different
   * lengths must not move each other's — the identical property as the saves,
   * one field over, which is the whole reason that rule exists.
   */
  /* THE CONTROL GAP, NAMED WHERE IT APPLIES RATHER THAN ONLY IN A PR BODY.
   *
   * The saves assertion above has a control: VERIFY_CONTROL=shared-identity
   * gives the second browser the first one's storage and the assertion reddens.
   * THAT CONTROL CANNOT REDDEN THE ONE BELOW, and not because of its shape —
   * `second` is created before either browser writes a length, and a
   * storageState copy taken at creation cannot carry a write that happens
   * afterwards. A control that works here has to share a backing store, or
   * re-copy storage between the second browser's write and the first's read.
   *
   * So: the assertion below is repaired and can now fail, and it is UNCONTROLLED.
   * It has never been watched going red. Treat it accordingly until it has.
   */
  const settingMark = sectionStart(floor);
  /**
   * READ ONLY. Opens Settings and reports which length is checked.
   *
   * It is separate from setLength because the first version of this check was
   * INERT and nothing could have reddened it. The third step called setLength
   * again — which checks the radio, reloads, and reads back what it just
   * checked. So it set "Five minutes" on the first browser and then asserted
   * the first browser had "Five minutes". A genuinely shared preferences store
   * passes that: A sets five, B sets everything, A sets five again and reads
   * five. The leak is invisible and the message describing it can never print.
   *
   * The failure must be OBSERVED, never re-established by the observation.
   */
  const readLength = async (context) => {
    const page = await context.newPage();
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    const ready = await page
      .waitForSelector("[data-settings-state='ready']", { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!ready) return null;
    for (const option of ["Five minutes", "Ten minutes", "Everything"]) {
      if (await page.getByRole("radio", { name: option }).isChecked()) return option;
    }
    return null;
  };

  const setLength = async (context, label) => {
    const page = await context.newPage();
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    const ready = await page
      .waitForSelector("[data-settings-state='ready']", { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!ready) return null;
    await page.getByRole("radio", { name: label }).check();
    await page.waitForTimeout(250);
    await page.close();
    return readLength(context);
  };

  const lengthA = await setLength(first, /Five minutes/i);
  const lengthB = await setLength(second, /Everything/i);
  // READ, not set. This is the line the review blocked on.
  const lengthAAfter = await readLength(first);
  out.briefLength = { first: lengthA, second: lengthB, firstAfterSecondChanged: lengthAAfter };

  // The floor: both browsers actually reached Settings and stored something.
  if (!lengthA || !lengthB) floor.push("one of the two browsers could not set a brief length");
  bailIfBroken(floor, settingMark);
  if (lengthB !== "Everything")
    floor.push(`the second browser chose Everything and has ${lengthB}`);
  if (lengthAAfter !== "Five minutes") {
    floor.push(
      `the second browser's choice moved the first browser's brief length to ${lengthAAfter}`,
    );
  }

  await first.close();
  await second.close();
} catch (error) {
  if (!isFloorBail(error)) throw error;
} finally {
  await browser.close();
}

out.floor = { passed: floor.length === 0, failures: floor };
console.log(JSON.stringify(out, null, 2));
// Under the control the failures are the POINT, so the exit code inverts: a
// control that cannot go red has not tested anything.
if (CONTROL) {
  const caught = floor.some((f) => f.includes("can see the"));
  console.log(
    caught ? "CONTROL OK: isolation went red as it must" : "CONTROL FAILED: stayed green",
  );
  process.exit(caught ? 0 : 1);
}
if (floor.length > 0) process.exit(1);
