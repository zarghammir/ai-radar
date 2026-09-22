/**
 * The Today screen's controls, at the three widths the owner actually uses.
 *
 *   npx next start -p 3210 && npm run shots:brief
 *   npm run shots:brief -- --name=empty        (against an empty database)
 *
 * WHY THREE WIDTHS AND BOTH POSITIONS. The controls were rejected on sight —
 * "two kinds of filters up there and three filters down there" — so the
 * evidence has to be what a person sees, not what the DOM contains, at every
 * size and in both states of the primary control. He reads this on a phone.
 *
 * IT CLICKS. Each position is reached by clicking the control, not by typing a
 * URL, because a control that cannot be operated at 390px is the defect this
 * is meant to catch.
 */
import { mkdir } from "node:fs/promises";
import { launchBrowser, requireServer } from "./lib/browser.mjs";
import { markOnboarded } from "./lib/seed.mjs";

const args = process.argv.slice(2);
const base =
  args.find((a) => !a.startsWith("--")) || process.env.VERIFY_URL || "http://127.0.0.1:3210";
const name = args.find((a) => a.startsWith("--name="))?.slice("--name=".length) ?? "stories";
await requireServer(base);

const DIR = "docs/screenshots/controls";
const WIDTHS = [
  { key: "desktop", width: 1440, height: 1000, colorScheme: "light" },
  { key: "tablet", width: 820, height: 1100, colorScheme: "light" },
  { key: "phone", width: 390, height: 900, colorScheme: "dark" },
];
const FILTER = '[role="group"][aria-label="What kind of stories"]';
const READING = '[role="group"][aria-label="How much to read"]';

const floor = [];
const shots = [];
const browser = await launchBrowser();

try {
  await mkdir(DIR, { recursive: true });

  for (const vp of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: vp.colorScheme,
    });
    await markOnboarded(ctx, base);
    const page = await ctx.newPage();
    await page.goto(`${base}/?length=all&view=built`, { waitUntil: "networkidle" });

    const options = page.locator(`${FILTER} a`);
    const count = await options.count();
    if (count !== 2) {
      floor.push(`${vp.key}: the filter has ${count} options, not 2`);
      await ctx.close();
      continue;
    }

    const filterLabels = (await options.allInnerTexts()).map((t) => t.trim());
    const readingLabels = (await page.locator(`${READING} a`).allInnerTexts()).map((t) => t.trim());

    // NO WORD IN TWO CONTROLS. The rule the owner's complaint produced, checked
    // rather than asserted in a comment — and checked on the RENDERED text, so
    // a label changed in one place and not the other cannot slip through.
    const wordsOf = (labels) =>
      new Set(
        labels
          .join(" ")
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter((w) => w.length > 2),
      );
    const shared = [...wordsOf(filterLabels)].filter((w) => wordsOf(readingLabels).has(w));
    if (shared.length > 0) {
      floor.push(
        `${vp.key}: "${shared.join('", "')}" appears in BOTH controls — ` +
          `filter ${JSON.stringify(filterLabels)}, reading ${JSON.stringify(readingLabels)}`,
      );
    }

    // A CONTROL THAT NEEDS A SENTENCE IS MISNAMED. The explanatory line under
    // the filter is gone; this stops it coming back.
    const stray = await page.locator(`${FILTER} ~ p`).count();
    if (stray > 0) floor.push(`${vp.key}: the filter has an explanatory paragraph under it again`);

    for (const position of ["built", "all"]) {
      if (position === "all") {
        // CLICKED, not navigated. At 390px this is the interaction that matters.
        await options.nth(1).click();
        await page.waitForURL(/view=all/, { timeout: 8000 });
        await page.waitForLoadState("networkidle");
      }
      const selected = await page.locator(`${FILTER} a[aria-current="true"]`).innerText();
      const emptyReason = await page
        .getAttribute("[data-empty-reason]", "data-empty-reason")
        .catch(() => null);
      const stories = await page.locator("article h2 a").count();
      if (stories === 0 && !emptyReason) {
        floor.push(
          `${vp.key}/${position}: nothing rendered and no data-empty-reason to explain it`,
        );
      }
      const file = `${DIR}/${name}-${vp.key}-${position}.png`;
      await page.screenshot({ path: file });
      shots.push({
        file: file.split("/").pop(),
        width: vp.width,
        selected: selected.trim(),
        stories,
        emptyReason,
      });
    }

    if (shots.length) {
      shots[shots.length - 1].filterLabels = filterLabels;
      shots[shots.length - 1].readingLabels = readingLabels;
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ base, shots, floor }, null, 2));
if (floor.length) {
  console.error("\nFLOOR BROKEN — these shots are not evidence:");
  for (const f of floor) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n${shots.length} shots written to ${DIR}`);
