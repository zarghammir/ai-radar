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
 * THE SECOND IS REQUIRED ONCE PER FAMILY, NOT ONCE PER PROBE, and that is not a
 * loosening. adjustFontFallback is ONE SETTING PER localFont CALL, and exactly one
 * call per family emits a fallback — so "is this family's fallback shadowing its
 * own subsets?" is a single fact with a single answer. Any one probe that can see
 * it has verified it for the whole family. A second probe on the same family adds
 * coverage of a different question, namely whether that subset is in the chain at
 * all, and it is measured for that.
 *
 * It matters because whether a probe CAN see the arrangement depends on a
 * coincidence of metrics between the real face and whatever the system substitutes
 * for Arial. On a Linux runner, adjusted DejaVu renders the Vietnamese probe 0.4px
 * from the real Archivo Vietnamese — indistinguishable — while the Polish probe on
 * the same family separates cleanly at 2.1px. Requiring every probe to be
 * discriminating would redden correct CSS on an environment's coincidence. Widening
 * the tolerance until it passed would have bought silence and blinded the check.
 *
 * A family where NO probe can discriminate still fails. That is the floor: it means
 * nothing here is testing the arrangement for that family, and a pass would be
 * vacuous.
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
 * IT ENDS WITH A JSON SUMMARY, and that is a requirement rather than a courtesy.
 * .github/scripts/measured-digest.mjs reads the trailing JSON object and FAILS the
 * job when there is none, or when it holds no numeric leaf: "a check that exits 0
 * without reporting a measurement is the failure this job exists to prevent", and
 * every floor in this repository is a quantity. So the widths this check compares
 * are printed, not just the verdicts it drew from them. The JSON must be LAST —
 * the digest scans backwards for a line that is exactly `{` and parses to the end.
 *
 * EXIT CODES, the three-state contract the other verification scripts use:
 *   0  every role renders non-latin text in its real face
 *   1  a role fell through to a fallback, or a control did not behave
 *   2  the instrument could not run (no server, no browser)
 */

import { launchBrowser, requireServer } from "./lib/browser.mjs";

// The repository's convention for every verify:* script, so ci.yml's enumeration
// drives this one exactly as it drives the others.
const BASE =
  process.argv[2] || process.env.VERIFY_URL || process.env.BASE_URL || "http://127.0.0.1:3210";

/**
 * VERIFY_CONTROL=latin-first measures the MIS-ORDERED chain in place of the
 * application's, which is the defect this script exists to catch, so every probe
 * must fail and the script must exit 1.
 *
 * #83's rule applies here as much as anywhere: a check that has never been
 * observed failing is an unreported unknown, not a pass. ci.yml exercises this
 * before running the check for real, and refuses to run at all if a script
 * declares a control its map does not exercise.
 */
const CONTROL = process.env.VERIFY_CONTROL === "latin-first";

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
async function measure(page, { cls, text, latinFamily, face, control }) {
  return page.evaluate(
    async ({ cls, text, latinFamily, face, control }) => {
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
      // Under the control, `real` IS the mis-ordered chain — latin and its
      // unrestricted fallback ahead of the subset faces — so everything below
      // measures the defect instead of the application and must go red.
      const real = control
        ? make(`${q(latinFamily)}, ${q(latinFamily + " Fallback")}, sans-serif`, null)
        : make(null, cls);
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
    { cls, text, latinFamily, face, control },
  );
}

const browser = await launchBrowser();
await requireServer(BASE);

if (CONTROL) {
  console.log("CONTROL latin-first: measuring the mis-ordered chain. Every probe must FAIL.");
}

let failures = 0;
/** Every width this check compared, so the summary reports quantities not verdicts. */
const measured = [];
try {
  const page = await browser.newPage();
  const response = await page.goto(BASE, { waitUntil: "networkidle" });
  if (!response?.ok()) {
    console.error(`${BASE} answered ${response?.status()}. Nothing measured.`);
    process.exit(2);
  }

  for (const role of ROLES) {
    // How many of this family's probes can actually tell a mis-ordered chain from
    // a correct one. Zero is a failure; see the header for why one is enough.
    let discriminating = 0;
    for (const probe of role.probes) {
      const m = await measure(page, {
        cls: role.cls,
        text: probe.text,
        latinFamily: role.latinFamily,
        face: probe.face,
        control: CONTROL,
      });
      const label = `${role.cls.padEnd(11)} ${probe.why.padEnd(18)}`;

      // Is the chain even the one the application uses? A probe measuring some
      // other font proves nothing either way.
      // Skipped under the control, where `real` is a literal chain rather than the
      // utility, so this guard would fire for the wrong reason.
      if (!CONTROL && !m.resolved.includes(role.latinFamily)) {
        failures++;
        console.log(`  FAIL  ${label} .${role.cls} resolved to "${m.resolved}"`);
        console.log(`        ${role.latinFamily} is not in that chain — wrong thing measured.`);
        continue;
      }

      // THE CHECK, on every probe: the text must render at the width of the real
      // subset face that is supposed to serve it.
      const realOk = Math.abs(m.real - m.face) < EPSILON;
      // Whether THIS probe could have seen a mis-ordered chain. Counted for the
      // family rather than asserted here, because a metric coincidence between the
      // real face and the system's Arial substitute is not a fact about our CSS.
      const gap = Math.abs(m.broken - m.face);
      if (gap >= EPSILON) discriminating++;
      measured.push({
        role: role.cls,
        face: probe.face,
        realPx: Number(m.real.toFixed(2)),
        facePx: Number(m.face.toFixed(2)),
        misorderedPx: Number(m.broken.toFixed(2)),
        gapPx: Number(gap.toFixed(2)),
      });

      if (realOk) {
        console.log(
          `  ok    ${label} ${m.real.toFixed(1)}px = ${probe.face}` +
            (gap >= EPSILON
              ? `  (mis-ordered ${m.broken.toFixed(1)}px, ${gap.toFixed(1)}px apart)`
              : `  (cannot discriminate here: ${gap.toFixed(1)}px apart)`),
        );
      } else {
        failures++;
        console.log(`  FAIL  ${label} ${probe.face} is NOT serving this text.`);
        console.log(
          `        measured ${m.real.toFixed(1)}px; ${probe.face} alone is ${m.face.toFixed(1)}px.`,
        );
        console.log(`        Check that the latin face sits LAST in .${role.cls}'s chain.`);
      }
    }

    // THE FLOOR. If no probe on this family could tell the arrangements apart, then
    // nothing above tested the arrangement and every green on it was vacuous.
    if (discriminating === 0) {
      failures++;
      console.log(`  FAIL  ${role.cls.padEnd(11)} NO probe can see this family's chain order.`);
      console.log(`        Every probe measured the mis-ordered chain within ${EPSILON}px of the`);
      console.log(`        real face, so their passes say nothing about the order. Add a probe`);
      console.log(`        whose text separates the two, rather than trusting these.`);
    } else {
      console.log(
        `  ok    ${role.cls.padEnd(11)} chain order verified by ${discriminating} of ` +
          `${role.probes.length} probe(s) on this family`,
      );
    }
  }
} finally {
  await browser.close();
}

const total = ROLES.reduce((n, r) => n + r.probes.length, 0);
console.log(
  failures === 0
    ? `RESULT: ${total} probes across ${ROLES.length} families; every family's chain order discriminated`
    : `RESULT: ${failures} failed`,
);

// LAST, and nothing may print after it. See the header.
console.log(
  JSON.stringify(
    {
      probes: total,
      families: ROLES.length,
      discriminatingProbes: measured.filter((m) => m.gapPx >= EPSILON).length,
      failures,
      tolerancePx: EPSILON,
      measurements: measured,
    },
    null,
    2,
  ),
);
process.exit(failures === 0 ? 0 : 1);
