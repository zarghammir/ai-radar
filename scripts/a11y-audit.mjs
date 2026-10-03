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

// Research and Releases are gone since #102 — they are positions on Today's
// view control now, not destinations. Sweeping a deleted route would 404 and
// the landing-path floor would report it as landing somewhere else, which is
// true but unhelpful.
const ROUTES = ["/", "/radar", "/saved", "/settings", "/welcome"];

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
 * The ids are READ FROM THE RUNNING APP rather than typed here. A list typed
 * into a script stops matching the day a fixture changes its id, and every
 * seeded run then measures an empty screen while still reporting that it
 * seeded three stories.
 */
const SEEDED_STORY_COUNT = 3;
const MARKS_TEMPLATE = [
  {
    note: "Worth a second read before Friday.",
    tags: ["ship", "agents"],
    savedAt: "2026-09-15T09:00:00.000Z",
  },
  { note: null, tags: ["read-later"], savedAt: "2026-09-14T09:00:00.000Z" },
  {
    note: "The pricing table is the part that matters.",
    tags: [],
    savedAt: "2026-09-13T09:00:00.000Z",
  },
];
/**
 * AUDIT_CONTROL=narrow squeezes the phone viewport until the bar MUST clip. It exists so the bar gate can be seen going red: a gate that has only
 * ever passed is not yet known to be able to fail. A control run labels itself
 * in the output so it can never be mistaken for a real one.
 */
const CONTROL = process.env.AUDIT_CONTROL || null;

/**
 * The control's width, and it had to MOVE when #102 removed two tabs.
 *
 * This was 200px when the bar carried six tabs — about 33px each, which forced
 * every label to clip. Four tabs at 200px get about 50px each, which is roughly
 * the width of the word "Settings" at this size. So the old number sits right
 * on the boundary: the control might still redden, and it might quietly stop,
 * and those look identical in a green run.
 *
 * A CONTROL THAT SILENTLY STOPS GOING RED IS WORSE THAN NO CONTROL, because the
 * gate it guards keeps reporting a pass that nobody can any longer distinguish
 * from an untested one. So the width drops to keep the same pressure per tab.
 *
 * OBSERVED FAILING AT FOUR TABS on 2026-09-17, at this head: 160px produced a
 * narrowest tab of 40px — the figure the arithmetic above predicts — and
 * "Settings" clipped in 10 of 10 bars, with the floor still passing, so the red
 * was the layout rather than an empty instrument. At the real 390px the same
 * sweep reports 0 clipped and a narrowest tab of 97.5px.
 *
 * Written as a dated observation rather than "verified", because the number it
 * justifies depends on the tab COUNT and on the longest label. Add a fifth tab,
 * or a word longer than "Settings", and this figure is a prediction again — at
 * which point this paragraph is evidence about a tree that no longer exists and
 * should be re-earned rather than trusted.
 */
const CONTROL_WIDTH = 160;
const PHONE_WIDTH = CONTROL === "narrow" ? CONTROL_WIDTH : 390;

const SIZES = [
  { name: "phone", width: PHONE_WIDTH, height: 780 },
  { name: "laptop", width: 1440, height: 900 },
];

/** The bar is lg:hidden, so it belongs in exactly the phone states. */
// Four since #102 removed Research and Releases from the navigation. This is
// asserted rather than derived on purpose: the bar's geometry is the thing
// under test, so a count read from the same config the bar renders from would
// agree with it however wrong both were.
const EXPECTED_TABS = 4;
/**
 * Two, since #195 put a ⋯ menu where the sidebar was: Saved and Settings.
 * Asserted rather than derived, for the same reason EXPECTED_TABS is — the
 * menu's geometry is the thing under test, and a count read from the config the
 * menu renders from would agree with it however wrong both were.
 */
const EXPECTED_MENU_ITEMS = 2;
/**
 * The product's tap target, not the standard's. axe's target-size rule passes
 * at 24px; the ⋯ button is built at 44px because on a laptop it is the only
 * navigation there is. Asserting the product's figure means a change that
 * quietly shrinks it to 28px fails here instead of passing axe.
 */
const MIN_TAP_TARGET = 44;
const THEMES = ["light", "dark"];

import { launchBrowser, requireServer } from "./lib/browser.mjs";
import { collectStoryIds } from "./lib/fixture-ids.mjs";
import { saveThroughUi } from "./lib/save-through-ui.mjs";

await requireServer(base);
const browser = await launchBrowser();
// Kept as an early floor rather than as seeding: it fails fast, with a sentence
// naming the cause, if Today has nothing to save. That is the check that caught
// CI's empty database.
await collectStoryIds(browser, base, SEEDED_STORY_COUNT);
const report = {
  states: 0,
  serious: [],
  allViolations: [],
  overflow: [],
  nav: {},
  bottomBar: {},
  chrome: {},
  seeded: {},
  filledBins: {},
};

try {
  for (const size of SIZES) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        colorScheme: theme,
      });
      // On the CONTEXT, not the page: the bin is filled below through a second
      // page, and an init script attached to one page would not reach it.
      // Theme is written every navigation on purpose; onboarding is write-once,
      // so a reload cannot put the starting state back over what the app stored.
      await context.addInitScript((t) => {
        try {
          localStorage.setItem("ai-radar-theme", t);
          const key = "ai-radar-fixture-preferences";
          if (localStorage.getItem(key) === null) {
            localStorage.setItem(
              key,
              JSON.stringify({ onboardedAt: "2026-09-01T00:00:00.000Z", topicKeys: ["agents"] }),
            );
          }
        } catch {}
      }, theme);

      // THE BIN IS FILLED BY CLICKING SAVE, not by planting storage. Since #91
      // a saved story is an id AND a snapshot of the card, so ids written
      // without one resolve to nothing and Saved renders empty — which is
      // exactly how this sweep passed locally against fixtures and failed in
      // CI against a live database. Same code, different data.
      const filled = await saveThroughUi(context, base, MARKS_TEMPLATE);
      report.filledBins[`${size.name}/${theme}`] = filled;

      const page = await context.newPage();

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
         * The bottom bar carries every surface below lg. It has to be
         * measured rather than eyeballed — four tabs at 390px have more room
         * each than six did, which makes the narrow control weaker, not
         * stronger. See CONTROL_WIDTH.
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
         * THE LAPTOP CHROME: the brand mark, and the ⋯ button holding Saved and
         * Settings. It is `hidden lg:block`, so it belongs in exactly the laptop
         * states — the mirror of the bar above, and asserted the same way.
         *
         * IT IS MEASURED OPEN, AND LEFT OPEN FOR axe. A dropdown that renders is
         * not a dropdown that works. The panel is absolutely positioned and
         * anchored to the right edge, which is exactly the arrangement that puts
         * items off the side of a screen while every selector still finds them.
         * Leaving it open afterwards is what gets its links, contrast and
         * labelling into the axe scan at all: a closed <details> is display:none,
         * and a scan of a closed menu reports zero violations for a surface it
         * never looked at. That is not hypothetical — the first build of this
         * component failed contrast in 8 of 8 dark states, on text nobody could
         * have seen with the menu shut.
         *
         * Overflow is re-read WHILE OPEN, because an absolutely positioned panel
         * can push the document sideways in a state the earlier closed read
         * cannot see.
         */
        const chrome = await page.evaluate(async () => {
          const header = document.querySelector("header[data-app-chrome='true']");
          if (!header) return null;
          if (getComputedStyle(header).display === "none") return null;

          const viewport = document.documentElement.clientWidth;
          const box = (el) => {
            const r = el.getBoundingClientRect();
            return {
              width: Math.round(r.width * 10) / 10,
              height: Math.round(r.height * 10) / 10,
            };
          };

          const brand = header.querySelector("a span:last-child");
          const button = header.querySelector("[data-chrome-menu-button='true']");
          const details = button ? button.closest("details") : null;
          if (!button || !details) return { present: true, openable: false, viewport };

          details.open = true;
          // One frame, so the panel is laid out before it is measured.
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));

          const menu = header.querySelector("[data-chrome-menu='true']");
          const items = (menu ? [...menu.querySelectorAll("a")] : []).map((a) => {
            const r = a.getBoundingClientRect();
            return {
              text: (a.textContent || "").trim(),
              ...box(a),
              clipped: a.scrollWidth - a.clientWidth,
              offLeft: Math.round(Math.min(0, r.left) * 10) / 10,
              offRight: Math.round(Math.max(0, r.right - viewport) * 10) / 10,
            };
          });

          return {
            present: true,
            openable: true,
            viewport,
            chromeOverflow: header.scrollWidth - header.clientWidth,
            brandClipped: brand ? brand.scrollWidth - brand.clientWidth : null,
            button: box(button),
            buttonName: button.getAttribute("aria-label"),
            itemCount: items.length,
            items,
            menuOverflow: menu ? menu.scrollWidth - menu.clientWidth : null,
            docOverflowWhileOpen:
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        report.chrome[`${size.name}/${theme}${route}`] = chrome ?? { present: false };

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
            bottom: navs.some((n) => visible(n) && n.className.includes("lg:hidden")),
            chrome: [...document.querySelectorAll("header[data-app-chrome='true']")].filter(visible)
              .length,
            menuOpen: !!document.querySelector("header[data-app-chrome='true'] details[open]"),
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
/**
 * THE BAR IS ABSENT ON /welcome BY DESIGN, so the floor counts the routes that
 * should have one rather than every route.
 *
 * First run hides both navigations: it is the one screen with a single thing to
 * do, and a nav bar there offers four ways to leave a place the reader has not
 * been shown yet. Counting it would make this floor demand a bar the product
 * deliberately does not draw — a check asserting the opposite of the decision.
 *
 * DERIVED, NOT TYPED. The subtraction is computed from the same ROUTES list the
 * sweep walks, so adding a route moves both numbers together. A hardcoded 8 here
 * would go quietly wrong the next time ROUTES changes.
 */
const CHROMELESS_ROUTES = ["/welcome"];
/** Every phone state the sweep VISITS. */
const expectedPhoneStates = ROUTES.length * THEMES.length;
/** Of those, the ones that should be DRAWING a bottom bar. */
const expectedBarStates = (ROUTES.length - CHROMELESS_ROUTES.length) * THEMES.length;
/**
 * And the laptop's mirror of it. The chrome is `hidden lg:block`, so it belongs
 * in exactly the laptop states, minus the same chromeless routes — THE SAME
 * SUBTRACTION, because the rule is about the route and not about the width: a
 * screen that should offer no navigation offers none at either size.
 */
const expectedChromeStates = (ROUTES.length - CHROMELESS_ROUTES.length) * THEMES.length;
const measuredChrome = Object.values(report.chrome).filter((c) => c.present !== false);
const phoneStatesWithChrome = Object.entries(report.chrome).filter(
  ([k, c]) => k.startsWith("phone/") && c.present !== false,
);

const floorFailures = [];

/**
 * THE SEEDING FLOOR. Everything below measures whatever was on the page; this
 * asserts the right thing was. A first-run gate that redirected every route to
 * /welcome, or a Saved screen that came up empty because the seed key changed
 * name, would leave a sweep that scans clean and proves nothing — the shape of
 * a gated suite agreeing perfectly with itself because it ran nothing.
 */
/**
 * A floor on the seeding floor. The loop below iterates a map, and a map that
 * came back EMPTY would satisfy every check in it without examining anything —
 * the vacuous instrument, one level up from the thing it guards.
 */
const expectedSeedStates = ROUTES.length * THEMES.length * SIZES.length;
if (Object.keys(report.seeded).length !== expectedSeedStates) {
  floorFailures.push(
    `recorded what ${Object.keys(report.seeded).length} states rendered, expected ${expectedSeedStates}`,
  );
}

// A floor on the FILLING, not only on what the sweep saw afterwards. Clicking
// Save through the UI can fail quietly — a button that moved, a page that
// landed elsewhere — and the next thing to notice would be four routes
// reporting an empty bin, which points at Saved rather than at the seeding.
for (const [state, filled] of Object.entries(report.filledBins)) {
  if (filled.landed !== "/") {
    floorFailures.push(`${state}: filling the bin asked for Today and landed on ${filled.landed}`);
  } else if (filled.saved.length < MARKS_TEMPLATE.length) {
    floorFailures.push(
      `${state}: saved ${filled.saved.length} of ${MARKS_TEMPLATE.length} stories through the UI`,
    );
  }
}

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

// TWO DIFFERENT QUANTITIES, equal until /welcome stopped drawing a bar. This
// one is "did the sweep go everywhere"; the one below is "did a bar appear
// where one should". Collapsing them again would let a route silently drop out
// of the sweep as long as the bar count happened to match.
if (phoneStates.length !== expectedPhoneStates) {
  floorFailures.push(`visited ${phoneStates.length} phone states, expected ${expectedPhoneStates}`);
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

// The same three questions asked of the chrome: did it appear where it should,
// did it stay away where it should not, and was there anything in it.
if (measuredChrome.length !== expectedChromeStates) {
  floorFailures.push(
    `chrome found in ${measuredChrome.length} of ${expectedChromeStates} laptop states — that is the selector or the render, not the layout`,
  );
}
if (phoneStatesWithChrome.length > 0) {
  floorFailures.push(
    `chrome visible in ${phoneStatesWithChrome.length} phone states, where it must be hidden below lg — the phone keeps its bottom bar and must not grow a second navigation`,
  );
}
for (const chrome of measuredChrome) {
  // The ⋯ button IS the laptop navigation. If it is missing, every assertion
  // below it measures an empty set and the sweep passes on a chrome with no
  // way out of the feed.
  if (!chrome.openable) {
    floorFailures.push(`the ⋯ button was not found in the chrome at ${chrome.viewport}px`);
    break;
  }
  if (chrome.itemCount !== EXPECTED_MENU_ITEMS) {
    floorFailures.push(
      `the open menu held ${chrome.itemCount} links, expected ${EXPECTED_MENU_ITEMS}`,
    );
    break;
  }
  if (!chrome.buttonName) {
    floorFailures.push("the ⋯ button has no accessible name");
    break;
  }
  if (chrome.button.width < MIN_TAP_TARGET || chrome.button.height < MIN_TAP_TARGET) {
    floorFailures.push(
      `the ⋯ button measures ${chrome.button.width}×${chrome.button.height}px, below the ${MIN_TAP_TARGET}px target`,
    );
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
        controlWidthUnverifiedAtFourTabs: CONTROL === "narrow" ? CONTROL_WIDTH : null,
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
      chrome: {
        expectedChromeStates,
        chromeMeasured: measuredChrome.length,
        itemsPerMenu: [...new Set(measuredChrome.map((c) => c.itemCount))],
        menuLabels: [...new Set(measuredChrome.flatMap((c) => (c.items || []).map((i) => i.text)))],
        anyChromeOverflow: measuredChrome.filter((c) => c.chromeOverflow > 0).length,
        anyBrandClipped: measuredChrome.filter((c) => c.brandClipped > 0).length,
        anyItemClipped: measuredChrome.filter((c) => (c.items || []).some((i) => i.clipped > 0))
          .length,
        anyItemOffScreen: measuredChrome.filter((c) =>
          (c.items || []).some((i) => i.offLeft < 0 || i.offRight > 0),
        ).length,
        anyMenuOverflow: measuredChrome.filter((c) => c.menuOverflow > 0).length,
        anyDocOverflowWhileOpen: measuredChrome.filter((c) => c.docOverflowWhileOpen > 0).length,
        smallestButtonPx: measuredChrome.length
          ? Math.min(...measuredChrome.map((c) => Math.min(c.button.width, c.button.height)))
          : null,
        sample: report.chrome["laptop/dark/"] ?? null,
      },
      // Evidence that the sweep audited the screens it claims to have. Printed
      // on SUCCESS as well as failure, so a future reader can see the
      // instrument had something to measure rather than take it on trust.
      filledBins: report.filledBins,
      seeding: {
        // seed.mjs says of this value: "Returns whether it applied, so a
        // caller can report it rather than assume it." This script computed it
        // and discarded it — a value correct, connected to nothing, and
        // invisible to the reader of a green run. That is the very shape the
        // floor.mjs docstring was written about, one file over.
        statesRecorded: Object.keys(report.seeded).length,
        expected: expectedSeedStates,
        landedElsewhere: Object.entries(report.seeded).filter(
          ([state, seen]) => seen.path !== state.slice(state.indexOf("/", state.indexOf("/") + 1)),
        ).length,
        savedStates: [
          ...new Set(
            Object.entries(report.seeded)
              .filter(([state]) => state.endsWith("/saved"))
              .map(([, seen]) => seen.savedState),
          ),
        ],
        settingsStates: [
          ...new Set(
            Object.entries(report.seeded)
              .filter(([state]) => state.endsWith("/settings"))
              .map(([, seen]) => seen.settingsState),
          ),
        ],
        fewestControlsScannedOnSaved: Math.min(
          ...Object.entries(report.seeded)
            .filter(([state]) => state.endsWith("/saved"))
            .map(([, seen]) => seen.noteButtons),
        ),
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
/**
 * The chrome is broken when the row cannot hold itself, the brand clips, or a
 * menu item lands outside the viewport. The last is the reason the sweep opens
 * the panel at all: an off-screen item is in the DOM, focusable, and
 * unreachable with a pointer.
 */
const chromeBroken = measuredChrome.filter(
  (c) =>
    c.chromeOverflow > 0 ||
    c.brandClipped > 0 ||
    c.menuOverflow > 0 ||
    c.docOverflowWhileOpen > 0 ||
    (c.items || []).some((i) => i.clipped > 0 || i.offLeft < 0 || i.offRight > 0),
).length;
if (
  report.serious.length > 0 ||
  report.overflow.length > 0 ||
  barBroken > 0 ||
  chromeBroken > 0 ||
  floorFailures.length > 0
) {
  process.exit(1);
}
