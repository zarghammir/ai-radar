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
 * MAINTAINER TOOLING, not part of `npm ci`. Browser resolution and the
 * "is a server actually running" check both live in ./lib/browser.mjs, so the
 * logic exists once for this script and verify-shell.mjs. An earlier version
 * hard-coded a Homebrew prefix and a macOS cache path and could only ever run
 * on the machine it was written on.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const base = process.argv[2] || "http://127.0.0.1:3210";
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const ROUTES = ["/", "/radar", "/research", "/releases", "/saved", "/settings", "/welcome"];

/**
 * The reader this audit drives: someone who has finished onboarding and has
 * stories in their bin.
 *
 * Both halves matter. Without onboardedAt the first-run gate redirects EVERY
 * route to /welcome, and the sweep would audit one page seven times while
 * reporting seven routes — a gate measuring the same state over and over and
 * agreeing with itself. Without the saved ids, /saved renders its empty state
 * and the note editor, the tag chips and the card controls are never scanned
 * at all, so their contrast and labelling would be unaudited while the run
 * still said "0 violations".
 *
 * The ids are fixture story ids; see src/lib/api/fixtures.ts.
 */
const SEEDED_SAVED_IDS = [1, 2, 3];
const SEEDED_MARKS = {
  1: {
    note: "Worth a second read before Friday.",
    tags: ["ship", "agents"],
    savedAt: "2026-09-15T09:00:00.000Z",
  },
  2: { note: null, tags: ["read-later"], savedAt: "2026-09-14T09:00:00.000Z" },
  3: {
    note: "The pricing table is the part that matters.",
    tags: [],
    savedAt: "2026-09-13T09:00:00.000Z",
  },
};
/**
 * AUDIT_CONTROL=narrow squeezes the phone viewport until the six-tab bar MUST
 * clip. It exists so the bar gate can be seen going red: a gate that has only
 * ever passed is not yet known to be able to fail. A control run labels itself
 * in the output so it can never be mistaken for a real one.
 */
const CONTROL = process.env.AUDIT_CONTROL || null;
const PHONE_WIDTH = CONTROL === "narrow" ? 200 : 390;

const SIZES = [
  { name: "phone", width: PHONE_WIDTH, height: 780 },
  { name: "laptop", width: 1440, height: 900 },
];

/** The bar is lg:hidden, so it belongs in exactly the phone states. */
const EXPECTED_TABS = 6;
const THEMES = ["light", "dark"];

import { launchBrowser, requireServer } from "./lib/browser.mjs";

await requireServer(base);
const browser = await launchBrowser();
const report = {
  states: 0,
  serious: [],
  allViolations: [],
  overflow: [],
  nav: {},
  bottomBar: {},
  seeded: {},
};

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
      await page.addInitScript(
        ([t, ids, marks]) => {
          try {
            localStorage.setItem("ai-radar-theme", t);
            // An onboarded reader with a full bin — see SEEDED_SAVED_IDS above
            // for why an audit of the default empty state would prove less.
            localStorage.setItem(
              "ai-radar-fixture-preferences",
              JSON.stringify({ onboardedAt: "2026-09-01T00:00:00.000Z", topicKeys: ["agents"] }),
            );
            localStorage.setItem("ai-radar-fixture-saved", JSON.stringify(ids));
            localStorage.setItem("ai-radar-fixture-marks", JSON.stringify(marks));
          } catch {}
        },
        [theme, SEEDED_SAVED_IDS, SEEDED_MARKS],
      );

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

        /**
         * The bottom bar carries all six surfaces below lg. At 390px that is
         * ~65px per tab, so it has to be measured rather than eyeballed.
         *
         * Measured on the box that actually clips — the <nav> itself and each
         * label — not a wrapper, and against documentElement.clientWidth,
         * which excludes the scrollbar (innerWidth does not). Margins are
         * reported in px so a 1px pass cannot be mistaken for proof.
         */
        const bar = await page.evaluate(() => {
          const nav = document.querySelector("nav[aria-label='Main'].fixed");
          if (!nav) return null;
          const style = getComputedStyle(nav);
          if (style.display === "none") return null;
          const rect = nav.getBoundingClientRect();
          const viewport = document.documentElement.clientWidth;
          const labels = [...nav.querySelectorAll("a > span:last-child")].map((el) => ({
            text: el.textContent,
            clipped: el.scrollWidth - el.clientWidth,
            width: Math.round(el.getBoundingClientRect().width * 10) / 10,
          }));
          const links = [...nav.querySelectorAll("a")].map((a) => {
            const r = a.getBoundingClientRect();
            return { width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
          });
          return {
            tabs: links.length,
            viewport,
            navOverflow: nav.scrollWidth - nav.clientWidth,
            rightMargin: Math.round((viewport - rect.right) * 10) / 10,
            leftMargin: Math.round(rect.left * 10) / 10,
            narrowestTab: links.length ? Math.min(...links.map((l) => l.width)) : null,
            shortestTapTarget: links.length ? Math.min(...links.map((l) => l.height)) : null,
            labelsClipped: labels.filter((l) => l.clipped > 0),
            labels,
          };
        });
        // Record the ABSENCE too: a state that contributes nothing silently is
        // how a gate ends up measuring an empty set and passing.
        report.bottomBar[`${size.name}/${theme}${route}`] = bar ?? { present: false };

        /**
         * The audit's OWN floor, route by route: a page that landed somewhere
         * else, or a Saved screen that came up empty, scans clean while
         * proving nothing. Recorded for every route so the absence is visible
         * rather than inferred.
         */
        report.seeded[`${size.name}/${theme}${route}`] = await page.evaluate(() => ({
          path: location.pathname,
          savedState: document.querySelector("[data-screen-state]")?.dataset.screenState ?? null,
          settingsState:
            document.querySelector("[data-settings-state]")?.dataset.settingsState ?? null,
          noteButtons: document.querySelectorAll(
            "[data-screen-state='list'] textarea, [data-screen-state='list'] button",
          ).length,
        }));

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

/**
 * THE FLOOR. Without it the gate passes hardest when it is most broken: if the
 * selector misses, a route fails to paint, or the bar is hidden at the width
 * under test, there are no bars, therefore no clipped labels, therefore exit 0.
 * Assert the instrument had something to measure, and print the counts on
 * success so a future reader can see that it did.
 */
const measuredBars = Object.values(report.bottomBar).filter((b) => b.present !== false);
const phoneStates = Object.keys(report.bottomBar).filter((k) => k.startsWith("phone/"));
const laptopStatesWithBar = Object.entries(report.bottomBar).filter(
  ([k, b]) => k.startsWith("laptop/") && b.present !== false,
);
const expectedBarStates = ROUTES.length * THEMES.length;

const floorFailures = [];

/**
 * THE SEEDING FLOOR. Everything below measures whatever was on the page; this
 * asserts the right thing was. A first-run gate that redirected every route to
 * /welcome, or a Saved screen that came up empty because the seed key changed
 * name, would leave a sweep that scans clean and proves nothing — the shape of
 * a gated suite agreeing perfectly with itself because it ran nothing.
 */
for (const [state, seen] of Object.entries(report.seeded)) {
  const route = state.slice(state.indexOf("/", state.indexOf("/") + 1));
  if (seen.path !== route) {
    floorFailures.push(`${state}: asked for ${route} and ended up on ${seen.path}`);
  }
  if (route === "/saved" && seen.savedState !== "list") {
    floorFailures.push(
      `${state}: Saved is "${seen.savedState}", so its note, tag and card controls were never scanned`,
    );
  }
  if (route === "/settings" && seen.settingsState !== "ready") {
    floorFailures.push(
      `${state}: Settings is "${seen.settingsState}", so none of its controls were scanned`,
    );
  }
}

if (phoneStates.length !== expectedBarStates) {
  floorFailures.push(`visited ${phoneStates.length} phone states, expected ${expectedBarStates}`);
}
if (measuredBars.length !== expectedBarStates) {
  floorFailures.push(
    `bar found in ${measuredBars.length} of ${expectedBarStates} phone states — that is the selector or the render, not the layout`,
  );
}
if (laptopStatesWithBar.length > 0) {
  floorFailures.push(
    `bar visible in ${laptopStatesWithBar.length} laptop states, where it must be lg:hidden`,
  );
}
for (const bar of measuredBars) {
  if (bar.tabs !== EXPECTED_TABS) {
    floorFailures.push(`measured ${bar.tabs} tabs, expected ${EXPECTED_TABS}`);
    break;
  }
  if (bar.labels.length !== bar.tabs) {
    floorFailures.push(`measured ${bar.labels.length} labels for ${bar.tabs} tabs`);
    break;
  }
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
      bottomBar: {
        control: CONTROL,
        phoneViewport: PHONE_WIDTH,
        floorPassed: floorFailures.length === 0,
        floorFailures,
        expectedBarStates,
        barsMeasured: measuredBars.length,
        tabsPerBar: [...new Set(measuredBars.map((b) => b.tabs))],
        labelsPerBar: [...new Set(measuredBars.map((b) => b.labels.length))],
        anyNavOverflow: measuredBars.filter((b) => b.navOverflow > 0).length,
        anyLabelClipped: measuredBars.filter((b) => b.labelsClipped.length > 0).length,
        clippedLabelSamples: measuredBars.flatMap((b) => b.labelsClipped).slice(0, 6),
        worstRightMargin: measuredBars.length
          ? Math.min(...measuredBars.map((b) => b.rightMargin))
          : null,
        narrowestTabPx: measuredBars.length
          ? Math.min(...measuredBars.map((b) => b.narrowestTab))
          : null,
        shortestTapTargetPx: measuredBars.length
          ? Math.min(...measuredBars.map((b) => b.shortestTapTarget))
          : null,
        sample: report.bottomBar["phone/dark/"] ?? null,
      },
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

const barBroken = measuredBars.filter(
  (b) => b.navOverflow > 0 || b.labelsClipped.length > 0,
).length;
if (
  report.serious.length > 0 ||
  report.overflow.length > 0 ||
  barBroken > 0 ||
  floorFailures.length > 0
) {
  process.exit(1);
}
