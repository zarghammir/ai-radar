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
 * AUDIT_CONTROL=narrow squeezes the phone viewport until the chrome MUST
 * overflow. It exists so the chrome gate can be seen going red: a gate that has
 * only ever passed is not yet known to be able to fail. A control run labels
 * itself in the output so it can never be mistaken for a real one.
 */
const CONTROL = process.env.AUDIT_CONTROL || null;

/**
 * The control's width, and it had to CHANGE SUBJECT when #194 removed the
 * bottom bar.
 *
 * It used to squeeze four tabs until their labels clipped. There are no tabs
 * now. What is squeezable in the chrome is the row itself: the brand mark is
 * unbreakable uppercase, the ⋯ button is a fixed 44px, the row carries 40px of
 * left padding to line the brand up with the page title, and the dropdown it
 * opens is 176px wide on its own. None of that reflows.
 *
 * A CONTROL THAT SILENTLY STOPS GOING RED IS WORSE THAN NO CONTROL, because the
 * gate it guards keeps reporting a pass that nobody can any longer distinguish
 * from an untested one.
 *
 * OBSERVED FAILING on 2026-10-03, at this head, exit 1 on three independent
 * measurements: at 160px the header overflowed by 6px in 8 of 8 chrome states,
 * both menu items hung off the right edge in 8 of 8, and the document itself
 * went 8-wide-of-the-viewport while the menu was open — with floorPassed true
 * throughout, so the red was the layout rather than an empty instrument. At the
 * real 390px the same sweep reports 0 for every one of those and 0 violations.
 *
 * THE MENU IS WHAT MAKES THIS FIGURE SAFE, which the bar version never had: the
 * panel's own 176px min-width is wider than the control viewport, so the
 * off-screen assertion fires on a margin of 16px rather than on a few pixels of
 * text metrics. A rename of the product cannot quietly take the pressure off.
 *
 * Still written as a dated observation rather than "verified", because the
 * numbers depend on that min-width and on the row's padding. Change either and
 * this paragraph is evidence about a tree that no longer exists.
 */
const CONTROL_WIDTH = 160;
const PHONE_WIDTH = CONTROL === "narrow" ? CONTROL_WIDTH : 390;

const SIZES = [
  { name: "phone", width: PHONE_WIDTH, height: 780 },
  { name: "laptop", width: 1440, height: 900 },
];

/**
 * Two since #194: Saved and Settings, the only surfaces that are not the feed.
 * Asserted rather than derived on purpose — the menu's geometry is the thing
 * under test, and a count read from the same config the menu renders from
 * would agree with it however wrong both were.
 */
const EXPECTED_MENU_ITEMS = 2;
/**
 * The product's tap target, not the standard's. axe's target-size rule passes
 * at 24px; the ⋯ button is built at 44px because it is the only navigation the
 * app has at any width, and a thumb on a phone is the common case rather than
 * the edge one. Asserting the product's figure means a change that quietly
 * shrinks it to 28px fails here instead of passing axe.
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
         * THE CHROME: the brand mark, and the ⋯ button holding Saved and
         * Settings. One bar at both widths since #194 — the sidebar and the
         * four-tab phone bar are both gone, so this is now the only navigation
         * in the app and the only thing standing between a reader and Settings.
         *
         * IT IS MEASURED OPEN, AND LEFT OPEN FOR axe. A dropdown that renders
         * is not a dropdown that works. The panel is absolutely positioned and
         * anchored to the right edge, which is exactly the arrangement that
         * puts items off the side of a narrow screen while every selector still
         * finds them — so the sweep opens it and measures where the items
         * actually landed against the viewport. Leaving it open afterwards is
         * what gets its links, contrast and labelling into the axe scan at all:
         * a closed <details> is display:none, and a scan of a closed menu
         * reports zero violations for a surface it never looked at.
         *
         * Measured on the boxes that actually clip — the <header>, the brand
         * label, each item — and against documentElement.clientWidth, which
         * excludes the scrollbar (innerWidth does not). Overflow is re-read
         * WHILE OPEN, because an absolutely positioned panel can push the
         * document sideways in a state the earlier closed-chrome read cannot
         * see.
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
          if (!button || !details) {
            return { present: true, openable: false, viewport };
          }

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
            brandText: brand ? (brand.textContent || "").trim() : null,
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
        // Record the ABSENCE too: a state that contributes nothing silently is
        // how a gate ends up measuring an empty set and passing.
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
            navs: navs.filter(visible).length,
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
const measuredChrome = Object.values(report.chrome).filter((c) => c.present !== false);
const welcomeWithChrome = Object.entries(report.chrome).filter(
  ([state, c]) => state.endsWith("/welcome") && c.present !== false,
);
/**
 * THE CHROME IS ABSENT ON /welcome BY DESIGN, so the floor counts the routes
 * that should have one rather than every route.
 *
 * First run hides the navigation: it is the one screen with a single thing to
 * do, and a nav bar there offers ways to leave a place the reader has not been
 * shown yet. Counting it would make this floor demand a bar the product
 * deliberately does not draw — a check asserting the opposite of the decision.
 *
 * DERIVED, NOT TYPED. The subtraction is computed from the same ROUTES list the
 * sweep walks, so adding a route moves both numbers together. A hardcoded 16
 * here would go quietly wrong the next time ROUTES changes.
 *
 * BOTH SIZES NOW, which is the change #194 made to this arithmetic. The bottom
 * bar was lg:hidden, so it belonged in exactly the phone states and the laptop
 * states had to be asserted EMPTY. There is one chrome at every width now, so
 * the question is no longer "which size draws it" but "does every size draw
 * it", and a chrome that vanished at 1440px would now be a failure rather than
 * the expected case.
 */
const CHROMELESS_ROUTES = ["/welcome"];
/** Every state the sweep VISITS, at both sizes. */
const expectedVisitedStates = ROUTES.length * THEMES.length * SIZES.length;
/** Of those, the ones that should be DRAWING the chrome. */
const expectedChromeStates =
  (ROUTES.length - CHROMELESS_ROUTES.length) * THEMES.length * SIZES.length;

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
// one is "did the sweep go everywhere"; the one below is "did the chrome appear
// where one should". Collapsing them again would let a route silently drop out
// of the sweep as long as the chrome count happened to match.
if (Object.keys(report.chrome).length !== expectedVisitedStates) {
  floorFailures.push(
    `visited ${Object.keys(report.chrome).length} states, expected ${expectedVisitedStates}`,
  );
}
if (measuredChrome.length !== expectedChromeStates) {
  floorFailures.push(
    `chrome found in ${measuredChrome.length} of ${expectedChromeStates} states — that is the selector or the render, not the layout`,
  );
}
if (welcomeWithChrome.length > 0) {
  floorFailures.push(
    `chrome drawn on /welcome in ${welcomeWithChrome.length} states, where first run must have none`,
  );
}
for (const chrome of measuredChrome) {
  // The ⋯ button IS the navigation. If it is missing, every assertion below
  // it measures an empty set and the sweep passes on a chrome with no way out.
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
      chrome: {
        control: CONTROL,
        phoneViewport: PHONE_WIDTH,
        controlWidth: CONTROL === "narrow" ? CONTROL_WIDTH : null,
        floorPassed: floorFailures.length === 0,
        floorFailures,
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
        worstChromeOverflowPx: measuredChrome.length
          ? Math.max(...measuredChrome.map((c) => c.chromeOverflow))
          : null,
        smallestButtonPx: measuredChrome.length
          ? Math.min(...measuredChrome.map((c) => Math.min(c.button.width, c.button.height)))
          : null,
        sample: report.chrome["phone/dark/"] ?? null,
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

/**
 * The chrome is broken when the row cannot hold itself, the brand clips, or a
 * menu item lands outside the viewport. The last one is the reason the sweep
 * opens the panel at all: an off-screen item is present in the DOM, focusable,
 * and unreachable with a thumb.
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
  chromeBroken > 0 ||
  floorFailures.length > 0
) {
  process.exit(1);
}
