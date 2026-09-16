/**
 * Accessibility and layout audit for the app shell (issue #12).
 *
 * Drives the running production build with the browser the reader uses, at the
 * two breakpoints docs/DESIGN.md names, in both themes, over every route, and
 * reports axe violations, horizontal overflow and which navigation is present.
 *
 *   npx next build && npx next start -p 3210
 *   node scripts/a11y-audit.mjs http://127.0.0.1:3210
 *
 * Requires a Chromium available to Playwright. It is a verification tool, not
 * part of the app bundle.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

// playwright-core is CommonJS: require it, do not dynamic-import it, or the
// namespace nests everything under .default and chromium reads as undefined.
const pwRequire = createRequire(
  (process.env.PW_PATH || "/opt/homebrew/lib/node_modules/@playwright/cli") + "/package.json",
);
const { chromium } = pwRequire("playwright-core");

/* The bundled Playwright pins a browser build that may not be the one this
   machine downloaded, so fall back to the newest installed headless shell
   instead of failing with "Executable doesn't exist". */
function findChromium() {
  if (process.env.PW_EXECUTABLE) return process.env.PW_EXECUTABLE;
  const root = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(root)) return undefined;
  const builds = readdirSync(root)
    .filter((d) => d.startsWith("chromium_headless_shell-") || d.startsWith("chromium-"))
    .sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()));
  for (const build of builds) {
    for (const rel of [
      "chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    ]) {
      const candidate = join(root, build, rel);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const executablePath = findChromium();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
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
