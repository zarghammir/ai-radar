#!/usr/bin/env node
/**
 * Checks that a character outside the latin subset renders in the REAL font and
 * not in a metric-adjusted Arial.
 *
 * WHY THIS EXISTS, and why a person cannot see the bug it guards. #160 vendored
 * the three brand faces with next/font/local. Google ships each family split by
 * unicode-range — one file per subset — and next/font/local emits one @font-face
 * per call, so keeping that split means one call per subset. Each call can also
 * emit a metric-adjusted fallback family, `<Name> Fallback`, which is a local
 * Arial carrying NO unicode-range. It can therefore serve ANY character.
 *
 * So if the CSS chain in globals.css reads
 *
 *     archivoLatin, archivoLatin Fallback, archivoLatinExt, …
 *
 * then a Polish or Vietnamese character — which archivoLatin declines because its
 * unicode-range excludes it — is served by adjusted Arial, WHILE THE REAL
 * latin-ext FILE SITS UNUSED. Every glyph in English is correct. The build is
 * green, tsc is green, the font files are byte-identical to what shipped before,
 * and every screenshot of an English page looks right. The defect is visible only
 * in the languages nobody on this project reads.
 *
 * That is why this is a script and not a note. The ordering in globals.css looks
 * arbitrary — latin LAST, which reads like a mistake — and the next person to
 * tidy it will move it back. Only the latin call carries a fallback, because
 * size-adjust is computed from the glyphs in the file and only the latin subset
 * is a representative basis; that is what forces it to sit last.
 *
 * HOW IT DECIDES, and why NOT through document.fonts. The obvious instrument is
 * "is the latin-ext FontFace loaded after rendering latin-ext text?". It does not
 * work, and the way it fails is worth recording: document.fonts is a property of
 * the DOCUMENT, so any latin-ext character ANYWHERE on the page — in the real
 * content, not the probe — loads that face and every probe then reports success
 * regardless of the chain. The first version of this script did exactly that and
 * passed all five probes with an order it could not actually see. Its control
 * failing is the only reason that was caught.
 *
 * What works is WIDTH. Text rendered in the real latin-ext face and the same text
 * rendered in the adjusted-Arial fallback occupy different widths, and a width is
 * a property of the element, not of the document. So each role is measured three
 * ways and the check is a comparison between them:
 *
 *   real      the role as the application applies it, via its Tailwind utility
 *   broken    the chain deliberately mis-ordered, latin before its own fallback
 *   fallback  the adjusted fallback alone, with no real face available
 *
 * real must differ from fallback — otherwise a fallback is serving the text. And
 * broken must EQUAL fallback — otherwise the mis-ordered chain does not actually
 * fall through, the premise is wrong, and `real != fallback` proves nothing.
 * The second is the control, and it is checked per role rather than once.
 *
 * THE ROLE IS APPLIED AS A CLASS, never as font-family: var(--font-mono). The
 * font variables live in Tailwind's `@theme inline`, which does NOT emit them to
 * :root — reading --font-mono there returns the empty string, an unresolved var()
 * voids the whole declaration, and the element silently inherits the body's sans
 * chain. An earlier version measured sans three times and called it mono.
 *
 * EXIT CODES, the three-state contract the other verification scripts use:
 *   0  every role renders non-latin text in its real face
 *   1  a role fell through to a fallback, or a control did not behave
 *   2  the instrument could not run (no server, no browser)
 */

import { launchBrowser, requireServer } from "./lib/browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3311";

/** Widths this close together are the same font; below the width of one hairline. */
const EPSILON = 0.5;

/**
 * EVERY PROBE STRING CONTAINS ONLY CHARACTERS OUTSIDE THE LATIN SUBSET, and that
 * is load-bearing rather than tidy. "Łódź źdźbło" looks like a latin-ext string
 * and is not: ó, d, z, b, l and the SPACE all sit in the latin range. Under the
 * mis-ordered chain the real latin face serves those and only Ł, ź, ł fall
 * through, so the measurement is a blend of two fonts and matches neither. The
 * control caught exactly that and the strings below were narrowed because of it.
 * Add a probe with one latin character or one space in it and its control fails.
 */

/**
 * `latinFamily` is the generated family name of the subset that carries the
 * fallback. next/font/local derives these from the identifiers in layout.tsx, so
 * renaming a const there renames a family here and this file must follow.
 */
const ROLES = [
  {
    cls: "font-sans",
    latinFamily: "archivoLatin",
    probes: [
      { text: "ŁłŻżĆćŚśŃń", why: "Polish, latin-ext" },
      { text: "ếềễệỀỆ", why: "Vietnamese" },
    ],
  },
  {
    cls: "font-label",
    latinFamily: "narrowLatin",
    probes: [{ text: "ŁłŻżĆćŚśŃń", why: "Polish, latin-ext" }],
  },
  {
    cls: "font-mono",
    latinFamily: "monoLatin",
    probes: [
      { text: "Ελλάδα", why: "Greek" },
      { text: "Привет", why: "Cyrillic" },
    ],
  },
];

/**
 * Measures one string three ways on one page. Widths only — nothing here reads
 * document.fonts, for the reason in the header.
 */
async function measure(page, { cls, text, latinFamily }) {
  return page.evaluate(
    async ({ cls, text, latinFamily }) => {
      const make = (fontFamily, className) => {
        const el = document.createElement("div");
        el.textContent = text;
        if (className) el.className = className;
        el.style.cssText = "position:absolute;left:-9999px;top:0;font-size:32px;white-space:pre;";
        if (fontFamily) el.style.fontFamily = fontFamily;
        document.body.appendChild(el);
        return el;
      };
      const q = (n) => `"${n}"`;
      const real = make(null, cls);
      const broken = make(`${q(latinFamily)}, ${q(latinFamily + " Fallback")}, sans-serif`, null);
      const fallback = make(`${q(latinFamily + " Fallback")}, sans-serif`, null);
      const resolved = getComputedStyle(real).fontFamily;
      await document.fonts.ready;
      const w = (el) => el.getBoundingClientRect().width;
      const out = { real: w(real), broken: w(broken), fallback: w(fallback), resolved };
      [real, broken, fallback].forEach((el) => el.remove());
      return out;
    },
    { cls, text, latinFamily },
  );
}

const browser = await launchBrowser();
await requireServer(BASE);

let failures = 0;
try {
  const page = await browser.newPage();
  const response = await page.goto(BASE, { waitUntil: "networkidle" });
  if (!response?.ok()) {
    console.error(`${BASE} answered ${response?.status()}. Nothing measured.`);
    process.exit(2);
  }

  for (const role of ROLES) {
    for (const probe of role.probes) {
      const m = await measure(page, {
        cls: role.cls,
        text: probe.text,
        latinFamily: role.latinFamily,
      });
      const label = `${role.cls.padEnd(11)} ${probe.why.padEnd(18)}`;

      // Is the chain even the one the application uses? A probe measuring some
      // other font proves nothing either way.
      if (!m.resolved.includes(role.latinFamily)) {
        failures++;
        console.log(`  FAIL  ${label} .${role.cls} resolved to "${m.resolved}"`);
        console.log(`        ${role.latinFamily} is not in that chain — wrong thing measured.`);
        continue;
      }

      // THE CONTROL, per role: the mis-ordered chain must actually fall through
      // to the fallback. If it does not, the comparison below is vacuous.
      const controlOk = Math.abs(m.broken - m.fallback) < EPSILON;
      // THE CHECK: the real chain must NOT be rendering in that fallback.
      const realOk = Math.abs(m.real - m.fallback) >= EPSILON;

      if (controlOk && realOk) {
        console.log(
          `  ok    ${label} real ${m.real.toFixed(1)}px vs fallback ${m.fallback.toFixed(1)}px`,
        );
      } else if (!controlOk) {
        failures++;
        console.log(`  FAIL  ${label} CONTROL did not behave.`);
        console.log(
          `        mis-ordered chain ${m.broken.toFixed(1)}px vs fallback alone ` +
            `${m.fallback.toFixed(1)}px — expected these to match.`,
        );
        console.log(`        Until they do, "real differs from fallback" is not evidence.`);
      } else {
        failures++;
        console.log(`  FAIL  ${label} a fallback is serving this text.`);
        console.log(
          `        real ${m.real.toFixed(1)}px equals fallback ${m.fallback.toFixed(1)}px.`,
        );
        console.log(`        Check that the latin face sits LAST in .${role.cls}'s chain.`);
      }
    }
  }
} finally {
  await browser.close();
}

const total = ROLES.reduce((n, r) => n + r.probes.length, 0);
console.log(
  failures === 0
    ? `RESULT: ${total} probes, each with its own control, all behaved`
    : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
