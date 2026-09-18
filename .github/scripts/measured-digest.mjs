#!/usr/bin/env node
/**
 * Reads a browser check's stdout and prints what it MEASURED, or fails.
 *
 * WHY THIS EXISTS (#83). A browser check that exits 0 having measured nothing
 * is indistinguishable from one that passed — which is the exact defect this
 * ticket is about, and adding jobs without this would reproduce it inside its
 * own fix. Each script ends with `console.log(JSON.stringify(out, null, 2))`,
 * so the measurements are already in the log; they are buried under Playwright
 * noise and nobody reads them. This lifts them to one line and, more
 * importantly, FAILS when there are none.
 *
 * It parses the TRAILING JSON object rather than the whole stream, because the
 * scripts print progress lines before it.
 *
 * It counts NUMERIC leaves specifically. A script whose output is all booleans
 * and strings has reported outcomes without reporting quantities, and every
 * floor in this repo is a quantity — "only N stories", "no Save button", "N
 * violations". Zero numbers means nothing was counted.
 */
const raw = await new Promise((resolve) => {
  let s = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (s += d));
  process.stdin.on("end", () => resolve(s));
});

const label = process.argv[2] || "the check";

/** The last line that is exactly `{` starts the trailing JSON block. */
function trailingJson(text) {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "{") {
      try {
        return JSON.parse(lines.slice(i).join("\n"));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function numericLeaves(value, path = "", out = []) {
  if (typeof value === "number" && Number.isFinite(value)) out.push([path || "(root)", value]);
  else if (Array.isArray(value)) value.forEach((v, i) => numericLeaves(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) numericLeaves(v, path ? `${path}.${k}` : k, out);
  return out;
}

const parsed = trailingJson(raw);
if (parsed === null) {
  console.error(
    `::error::${label} printed no parseable JSON summary, so there is nothing to show it measured. ` +
      `A check that exits 0 without reporting a measurement is the failure this job exists to prevent.`,
  );
  process.exit(1);
}

const numbers = numericLeaves(parsed);
if (numbers.length === 0) {
  console.error(
    `::error::${label} reported no numeric measurements. Every floor in this repository is a ` +
      `quantity, so an all-boolean summary means nothing was counted.`,
  );
  process.exit(1);
}

const shown = numbers
  .slice(0, 8)
  .map(([k, v]) => `${k}=${v}`)
  .join("  ");
console.log(
  `MEASURED (${label}): ${numbers.length} values — ${shown}${numbers.length > 8 ? "  …" : ""}`,
);
