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
 * What works is WIDTH, and the comparison is POSITIVE — against the real face,
 * never against the fallback. Each string is measured three ways:
 *
 *   real    the role as the application applies it, via its Tailwind utility
 *   face    the expected subset face ALONE, nothing else in the chain
 *   broken  the chain deliberately mis-ordered, latin before its own fallback
 *
 *   real must EQUAL face    — the real face is what served the text
 *   broken must DIFFER      — the mis-ordered chain really does fall through,
 *                             so the first assertion is not vacuous
 *
 * THE EARLIER VERSION ASSERTED `real != fallback` AND CI KILLED IT. The generated
 * fallback is `src: local(Arial)`, and a Linux runner HAS NO ARIAL — the face
 * never loads, the chain walks on to sans-serif, and DejaVu rendered one of these
 * strings 0.4px from the real Archivo. The check went red on a correct page. A
 * comparison against the fallback depends on a coincidence about a font we do not
 * ship and cannot see; a comparison against the real face depends only on the
 * face being identical to itself, which holds on every machine.
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
 * fallback; `face` is the family that MUST serve the probe text. next/font/local
 * derives both from the identifiers in layout.tsx, so renaming a const there
 * renames a family here and this file must follow.
 */
const ROLES = [
  {
    cls: "font-sans",
    latinFamily: "archivoLatin",
    probes: [
      { text: "ŁłŻżĆćŚśŃń", why: "Polish, latin-ext", face: "archivoLatinExt" },
      { text: "ếềễệỀỆ", why: "Vietnamese", face: "archivoVietnamese" },
    ],
  },
  {
    cls: "font-label",
    latinFamily: "narrowLatin",
    probes: [{ text: "ŁłŻżĆćŚśŃń", why: "Polish, latin-ext", face: "narrowLatinExt" }],
  },
  {
    cls: "font-mono",
    latinFamily: "monoLatin",
    probes: [
      { text: "Ελλάδα", why: "Greek", face: "monoGreek" },
      { text: "Привет", why: "Cyrillic", face: "monoCyrillic" },
    ],
  },
];

/**
 * Measures one string three ways on one page. Widths only — nothing here reads
 * document.fonts, for the reason in the header.
 */
async function measure(page, { cls, text, latinFamily, face }) {
  return page.evaluate(
    async ({ cls, text, latinFamily, face }) => {
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
      const faceOnly = make(q(face), null);
      const broken = make(`${q(latinFamily)}, ${q(latinFamily + " Fallback")}, sans-serif`, null);
      const resolved = getComputedStyle(real).fontFamily;

      // EVERY FACE IS LOADED EXPLICITLY, AND document.fonts.ready IS NOT ENOUGH.
      // `ready` resolves when nothing is PENDING — and a face referenced by an
      // element appended in this same task has not been requested yet, so there is
      // nothing pending and it resolves immediately. The element then measures in
      // the last-resort font. That is not hypothetical: it made two DIFFERENT
      // families report the identical width, because neither had loaded and both
      // fell to the same default, and every probe failed on a correct page.
      await Promise.all(
        [q(face), q(latinFamily), q(latinFamily + " Fallback")].map((f) =>
          document.fonts.load(`32px ${f}`, text).catch(() => {}),
        ),
      );
      await document.fonts.ready;
      const w = (el) => el.getBoundingClientRect().width;
      const out = { real: w(real), face: w(faceOnly), broken: w(broken), resolved };
      [real, faceOnly, broken].forEach((el) => el.remove());
      return out;
    },
    { cls, text, latinFamily, face },
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
        face: probe.face,
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

      // THE CHECK: the text must render at the width of its real subset face.
      const realOk = Math.abs(m.real - m.face) < EPSILON;
      // THE CONTROL, per probe: the mis-ordered chain must NOT, or the check
      // above would pass whatever the order is.
      const controlOk = Math.abs(m.broken - m.face) >= EPSILON;

      if (realOk && controlOk) {
        console.log(
          `  ok    ${label} ${m.real.toFixed(1)}px = ${probe.face} ` +
            `(mis-ordered would be ${m.broken.toFixed(1)}px)`,
        );
      } else if (!controlOk) {
        failures++;
        console.log(`  FAIL  ${label} CONTROL did not behave.`);
        console.log(
          `        the mis-ordered chain still measured ${m.broken.toFixed(1)}px, the same as ` +
            `${probe.face} at ${m.face.toFixed(1)}px.`,
        );
        console.log(`        This probe cannot tell the two arrangements apart, so its`);
        console.log(`        pass would mean nothing. Fix the probe, not the CSS.`);
      } else {
        failures++;
        console.log(`  FAIL  ${label} ${probe.face} is NOT serving this text.`);
        console.log(
          `        measured ${m.real.toFixed(1)}px; ${probe.face} alone is ${m.face.toFixed(1)}px.`,
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
