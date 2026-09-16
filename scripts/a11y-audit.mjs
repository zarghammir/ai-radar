/**
 * Accessibility and layout audit for the app shell (issue #12).
 *
 * Drives the running production build with a real browser, at the two
 * breakpoints docs/DESIGN.md names, in both themes, over every route, and
 * reports axe violations, horizontal overflow and which navigation is present.
 *
 *   npx next build && npx next start -p 3210
 *   node scripts/a11y-audit.mjs http://127.0.0.1:3210
 *
 * MAINTAINER TOOLING, not part of `npm ci`. It needs a Chromium to drive, and
 * this project deliberately does NOT depend on the full `playwright` package,
 * whose install step downloads browsers on every install including CI. It
 * depends on `playwright-core` (no download) and finds a browser like this:
 *
 *   1. $PW_EXECUTABLE, if you set it to a Chromium binary; otherwise
 *   2. your installed Google Chrome, via Playwright's "chrome" channel.
 *
 * If neither is available it says so and exits 2 rather than failing obscurely.
 * An earlier version hard-coded a Homebrew prefix and a macOS cache path and
 * could only ever run on one machine.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const base = process.argv[2] || "http://127.0.0.1:3210";
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const ROUTES = ["/", "/radar", "/research", "/releases", "/saved", "/settings"];
const SIZES = [
  { name: "phone", width: 390, height: 780 },
  { name: "laptop", width: 1440, height: 900 },
];
const THEMES = ["light", "dark"];

const { chromium } = await import("playwright-core");

async function launchBrowser() {
  const executablePath = process.env.PW_EXECUTABLE;
  if (executablePath) return chromium.launch({ executablePath });
  try {
    // The browser most machines already have, and no download.
    return await chromium.launch({ channel: "chrome" });
  } catch (error) {
    console.error(
      "No browser to drive. Set PW_EXECUTABLE to a Chromium binary, or install\n" +
        "Google Chrome so the 'chrome' channel resolves.\n" +
        String(error.message || error),
    );
    process.exit(2);
  }
}

const browser = await launchBrowser();
const report = { states: 0, serious: [], allViolations: [], overflow: [], nav: {} };

try {
  for (const size of SIZES) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        colorScheme: theme,
      });
      const page = await context.newPage();
      // Pin the stored preference so the audit tests the explicit choice, not
      // whatever the OS happens to be set to.
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("ai-radar-theme", t);
        } catch {}
      }, theme);

      for (const route of ROUTES) {
        await page.goto(base + route, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        report.states++;

        const overflow = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.body.clientWidth,
        }));
        if (overflow.doc > 0 || overflow.body > 0) {
          report.overflow.push({ route, size: size.name, theme, ...overflow });
        }

        const nav = await page.evaluate(() => {
          const visible = (el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const navs = [...document.querySelectorAll("nav[aria-label='Main']")];
          return {
            sidebar: navs.some((n) => visible(n) && n.className.includes("lg:flex")),
            bottom: navs.some((n) => visible(n) && n.className.includes("lg:hidden")),
            current: document.querySelectorAll("[aria-current='page']").length,
            main: document.querySelectorAll("main#main").length,
            skipLink: !!document.querySelector("a[href='#main']"),
            dark: document.documentElement.classList.contains("dark"),
          };
        });
        report.nav[`${size.name}/${theme}${route}`] = nav;

        await page.addScriptTag({ content: AXE });
        const results = await page.evaluate(
          async () =>
            await window.axe.run(document, {
              resultTypes: ["violations"],
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
              },
            }),
        );
        for (const v of results.violations) {
          const row = {
            route,
            size: size.name,
            theme,
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.length,
            help: v.help,
            target: v.nodes[0]?.target?.join(" ") ?? "",
          };
          report.allViolations.push(row);
          if (v.impact === "serious" || v.impact === "critical") report.serious.push(row);
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(
  JSON.stringify(
    {
      statesAudited: report.states,
      seriousOrCritical: report.serious.length,
      totalViolations: report.allViolations.length,
      horizontalOverflow: report.overflow.length,
      serious: report.serious,
      violations: report.allViolations,
      navSpotCheck: {
        "phone/light/": report.nav["phone/light/"],
        "laptop/light/": report.nav["laptop/light/"],
        "phone/dark/settings": report.nav["phone/dark/settings"],
        "laptop/dark/settings": report.nav["laptop/dark/settings"],
      },
    },
    null,
    2,
  ),
);

if (report.serious.length > 0 || report.overflow.length > 0) process.exit(1);
