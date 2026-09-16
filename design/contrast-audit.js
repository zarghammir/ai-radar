/**
 * AI Radar — contrast and overflow audit for the prototype.
 *
 * This is the script behind the numbers in docs/DESIGN.md section 8. It is not
 * loaded by the prototype; paste it into the console on design/prototype/index.html
 * (or inject it from a driver) and call:
 *
 *     await auditAIRadarContrast()
 *
 * It drives the showcase's own controls through all 24 states, waits the way a
 * reader's browser settles (fonts ready, the requested state actually applied,
 * two animation frames), and measures the rendered elements.
 *
 * Inclusion rule: every element inside #app with a direct non-whitespace text
 * node, that is actually visible. TEXT OF ANY LENGTH COUNTS — an earlier version
 * of this audit skipped nodes shorter than two characters and therefore never
 * looked at the single-glyph external-link arrow, which was failing. A filter
 * that excludes the failing case makes the measurement agree with itself.
 *
 * Decorative separators (span.dot) are counted and reported SEPARATELY rather
 * than silently dropped: WCAG exempts pure decoration, but a number you cannot
 * see is a number you cannot check.
 */
window.auditAIRadarContrast = async function auditAIRadarContrast() {
  const SCREENS = ["today", "radar", "story", "saved", "settings", "onboarding"];
  const DEVICES = ["mobile", "desktop"];
  const THEMES = ["dark", "light"];

  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => {
    await document.fonts.ready;
    await frame();
    await frame();
  };

  function parse(color) {
    const n = color.match(/[\d.]+/g);
    if (!n) return null;
    return [+n[0], +n[1], +n[2], n[3] === undefined ? 1 : +n[3]];
  }
  function over(fg, bg) {
    const a = fg[3];
    return [
      fg[0] * a + bg[0] * (1 - a),
      fg[1] * a + bg[1] * (1 - a),
      fg[2] * a + bg[2] * (1 - a),
      1,
    ];
  }
  function luminance(c) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function ratio(a, b) {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  /* Walk ancestors compositing every non-transparent background until opaque. */
  function backgroundOf(el) {
    const stack = [];
    let node = el;
    while (node && node !== document.documentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c[3] > 0) {
        stack.push(c);
        if (c[3] >= 0.999) break;
      }
      node = node.parentElement;
    }
    let base = [255, 255, 255, 1];
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  }

  function visible(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false;
      node = node.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function ownText(el) {
    let t = "";
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) t += n.textContent.trim();
    });
    return t;
  }

  const click = (sel) => document.querySelector(sel).click();
  const waitFor = async (test, tries = 60) => {
    for (let i = 0; i < tries; i++) {
      if (test()) return true;
      await frame();
    }
    return false;
  };

  const results = {
    states: 0,
    textElements: 0,
    failures: [],
    decorativeSeparators: 0,
    decorativeBelowThreshold: 0,
    overflowPx: 0,
    anchors: 0,
    perState: {},
  };

  for (const device of DEVICES) {
    click(`[data-device="${device}"]`);
    await waitFor(() => document.body.classList.contains("dev-desktop") === (device === "desktop"));
    for (const theme of THEMES) {
      click(`[data-theme="${theme}"]`);
      await waitFor(() => document.documentElement.getAttribute("data-theme") === theme);
      for (const screen of SCREENS) {
        click(`[data-screen="${screen}"]`);
        await waitFor(() => window.RadarApp.state.screen === screen);
        await settle();

        const app = document.getElementById("app");
        const scroller = app.querySelector(".screen");
        results.states++;
        results.anchors += app.querySelectorAll('a[href^="http"]').length;
        if (scroller) {
          results.overflowPx += Math.max(0, scroller.scrollWidth - scroller.clientWidth);
        }
        results.overflowPx += Math.max(0, app.scrollWidth - app.clientWidth);

        let count = 0;
        app.querySelectorAll("*").forEach((el) => {
          const text = ownText(el);
          if (!text) return;
          if (!visible(el)) return;

          const decorative = el.classList.contains("dot");
          const cs = getComputedStyle(el);
          const bg = backgroundOf(el);
          let fg = parse(cs.color);
          if (fg[3] < 1) fg = over(fg, bg);
          const size = parseFloat(cs.fontSize);
          const weight = parseInt(cs.fontWeight, 10) || 400;
          const large = size >= 24 || (size >= 18.66 && weight >= 700);
          const need = large ? 3 : 4.5;
          const r = ratio(fg, bg);

          if (decorative) {
            results.decorativeSeparators++;
            if (r < need - 0.05) results.decorativeBelowThreshold++;
            return;
          }
          count++;
          if (r < need - 0.05) {
            results.failures.push({
              state: `${device}/${theme}/${screen}`,
              text: text.slice(0, 40),
              selector:
                el.tagName.toLowerCase() +
                (el.className ? "." + String(el.className).split(" ")[0] : ""),
              size,
              weight,
              ratio: Math.round(r * 100) / 100,
              need,
            });
          }
        });
        results.textElements += count;
        results.perState[`${device}/${theme}/${screen}`] = count;
      }
    }
  }
  return results;
};
