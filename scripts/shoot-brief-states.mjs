/**
 * The Today screen in whichever state the database puts it in.
 *
 *   npx next start -p 3210 && npm run shots:brief -- --name=with-stories
 *   (point DATABASE_URL at an empty database, restart, then)
 *   npm run shots:brief -- --name=never-swept
 *
 * IN THE TREE, NOT IN /tmp. The last capture script for a feature lived in a
 * temporary file and its floor was reported in a pull request as though it
 * were committed. A reviewer went looking, could not find it, and could not
 * make it fail — which is worse than no floor, because the claim stops the
 * search for the gap it supposedly closes.
 *
 * THE FLOOR: an EMPTY brief must carry data-empty-reason. #148 exists because
 * the empty screen asserted "the database answered, so this is a quiet morning
 * rather than a fault" on a day the collector had written sixty-four stories.
 * Four reasons replaced that one sentence, and a screenshot of an empty brief
 * that cannot say which reason it is showing proves nothing about the fix.
 */
import { mkdir } from "node:fs/promises";
import { launchBrowser, requireServer } from "./lib/browser.mjs";
import { markOnboarded } from "./lib/seed.mjs";

const args = process.argv.slice(2);
const base =
  args.find((a) => !a.startsWith("--")) || process.env.VERIFY_URL || "http://127.0.0.1:3210";
const name = args.find((a) => a.startsWith("--name="))?.slice("--name=".length) ?? "brief";
await requireServer(base);

const DIR = "docs/screenshots/brief";
const floor = [];
const out = {};
const browser = await launchBrowser();

try {
  await mkdir(DIR, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 900 },
    colorScheme: "dark",
  });
  await markOnboarded(ctx, base);
  const page = await ctx.newPage();
  await page.goto(`${base}/?length=all&view=all`, { waitUntil: "networkidle" });

  const state = await page.getAttribute("[data-screen-state]", "data-screen-state");
  const reason = await page
    .getAttribute("[data-empty-reason]", "data-empty-reason")
    .catch(() => null);
  const stories = await page.locator("article h2 a").count();
  out.state = state;
  out.emptyReason = reason;
  out.stories = stories;

  if (!state) floor.push("no data-screen-state on the page");
  if (state === "quiet" && !reason) {
    floor.push(
      "the brief is empty and does NOT say which kind of empty — no data-empty-reason. " +
        "A picture of this proves nothing about #148; the screen could be back to one " +
        "flattened message.",
    );
  }
  if (state === "brief" && stories < 1) floor.push("state=brief but no stories rendered");

  // The renamed control (#147): the word "Everything" now belongs to the view
  // filter alone, so the budget's third option must NOT be called that.
  // SCOPED TO THE READING-BUDGET GROUP BY ITS OWN aria-label. The first
  // version matched `a[href*="length=all"]` and read "Built" — the VIEW
  // FILTER, whose links also carry a length. A control aimed at the wrong
  // element cannot fail for the reason it names: it would have reported the
  // rename intact no matter what the budget option said.
  const budget = await page
    .locator('[role="group"][aria-label="How long you have"] a')
    .last()
    .innerText()
    .catch(() => "");
  out.budgetOptionLabel = budget.trim();
  if (/everything/i.test(budget)) {
    floor.push(`the reading-budget option still reads "${budget.trim()}" — #147 renamed it`);
  }

  if (floor.length === 0) {
    await page.screenshot({ path: `${DIR}/today-${name}.png` });
    out.file = `today-${name}.png`;
  }
  await ctx.close();
} finally {
  await browser.close();
}

console.log(JSON.stringify(out, null, 2));
if (floor.length) {
  console.error("\nFLOOR BROKEN:");
  for (const f of floor) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nwrote ${DIR}/${out.file}`);
