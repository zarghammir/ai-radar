/**
 * The story page's pictures, and the floors that make them evidence.
 *
 *   npx next build && npx next start -p 3210
 *   npm run shots:story
 *   npm run shots:story -- --slug=some-single-source-story   # the control
 *
 * WHY THIS FILE EXISTS RATHER THAN A SCRIPT IN /tmp. An earlier version of
 * these shots was taken by a script that was never committed, and its floor was
 * reported in a pull request as though it were in the tree. A reviewer went
 * looking for the assertion, could not find it, and could not make it fail —
 * which is worse than having no floor at all, because the claim stopped the
 * search for the gap it supposedly closed.
 *
 * THE FLOOR THAT MATTERS IS THE PICKUP ONE. #15's subject is provenance across
 * SEVERAL sources; a screenshot of a single-source story shows the page working
 * and proves nothing about the path that renders a list of source names with
 * roles — which is the denser version of the element that had already rendered
 * illegibly. So this refuses to write the multi-source shot unless the page
 * really has pickup entries on it, and says so.
 */
import { mkdir } from "node:fs/promises";
import { launchBrowser, requireServer } from "./lib/browser.mjs";
import { markOnboarded } from "./lib/seed.mjs";

const args = process.argv.slice(2);
const base =
  args.find((a) => !a.startsWith("--")) || process.env.VERIFY_URL || "http://127.0.0.1:3210";
const forcedSlug = args.find((a) => a.startsWith("--slug="))?.slice("--slug=".length) ?? null;
await requireServer(base);

const DIR = "docs/screenshots/story";
const floor = [];
const shots = [];
const browser = await launchBrowser();

/** Waits for the RENDERED story, not for the URL or the network. */
async function openStory(page, href) {
  await page.goto(base + href, { waitUntil: "networkidle" });
  // The URL changes when navigation STARTS and networkidle can settle while
  // loading.tsx is still on screen — the first run of the earlier script shot
  // the skeleton, at the right URL, with a clean floor. Wait for a marker only
  // the rendered story has.
  await page.locator('[data-provenance="true"]').waitFor({ timeout: 10000 });
}

try {
  await mkdir(DIR, { recursive: true });

  /** Which story to photograph: the caller's, or the first multi-source one. */
  let slug = forcedSlug;
  if (!slug) {
    const brief = await fetch(`${base}/api/brief?view=all&length=all`).then((r) => r.json());
    const multi = (brief.stories ?? []).find((s) => s.sourceCount > 1);
    if (!multi) {
      floor.push(
        "no story in the brief has more than one source, so nothing here can exercise the " +
          "provenance path this page exists for. Seed a pickup pair; do not photograph a " +
          "single-source story instead.",
      );
    } else slug = multi.slug;
  }

  if (slug) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: "light",
    });
    await markOnboarded(ctx, base);
    const page = await ctx.newPage();
    await openStory(page, `/story/${slug}`);

    // THE FLOOR. Counted before the shutter, so a single-source story cannot be
    // written to a file whose name claims otherwise.
    const pickup = await page.locator('[data-pickup="true"] li').count();
    const sources = await page.locator('[data-original-source="true"]').count();
    if (sources < 1) floor.push(`/story/${slug} rendered no original-source block`);
    if (pickup < 1) {
      floor.push(
        `/story/${slug} rendered ZERO pickup entries, so this shot would show a single-source ` +
          `story under a name that claims multi-source provenance. Point --slug at a story with ` +
          `more than one source; do not relax this check.`,
      );
    }

    if (floor.length === 0) {
      await page.screenshot({ path: `${DIR}/story-multi-source.png` });
      shots.push({ file: "story-multi-source.png", slug, pickupEntries: pickup });

      const summary = page.locator("details summary", { hasText: "Why is this ranked here?" });
      await summary.click();
      await page.waitForTimeout(200);
      const rows = await page.locator("details[open] table tr").count();
      if (rows < 2) floor.push(`the opened ranking panel showed ${rows} row(s)`);
      else {
        await page.screenshot({ path: `${DIR}/story-why-ranked-open.png` });
        shots.push({ file: "story-why-ranked-open.png", panelRows: rows, openedBy: "click" });
      }
    }
    await ctx.close();
  }

  // The phone shot arrives the way a reader does: by clicking the affordance.
  if (floor.length === 0) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 900 },
      colorScheme: "dark",
    });
    await markOnboarded(ctx, base);
    const page = await ctx.newPage();
    await page.goto(`${base}/?length=all&view=all`, { waitUntil: "networkidle" });
    const link = page.locator('a[aria-label^="Sources for"]').first();
    if ((await link.count()) < 1)
      floor.push("no Sources link on any card — the page is unreachable from the brief");
    else {
      await link.click();
      await page.waitForURL(/\/story\//, { timeout: 8000 });
      await page.locator('[data-provenance="true"]').waitFor({ timeout: 10000 });
      await page.screenshot({ path: `${DIR}/story-phone-dark.png` });
      shots.push({
        file: "story-phone-dark.png",
        clickedFrom: "the brief",
        landed: new URL(page.url()).pathname,
      });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(
  JSON.stringify({ base, slug: forcedSlug ?? "(first multi-source)", shots, floor }, null, 2),
);
if (floor.length) {
  console.error("\nFLOOR BROKEN — these shots are not evidence:");
  for (const f of floor) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n${shots.length} shots written to ${DIR}`);
