/**
 * Proves two rules about routes, from the import graph rather than by reading:
 *
 *   THE COST RULE      no route a client can reach can cause a paid call
 *   THE GUARD RULE     every route under internal/ reaches the secret guard
 *
 * Both key on the same `internal/` path segment, so they cannot disagree about
 * which routes are which — and both are derived from a walk of the repository
 * rather than from a list that has to be edited.
 *
 * Walks the import graph out of every public route handler and fails if any of
 * them can reach a feed adapter, the HTTP client, or an LLM SDK. The graph is
 * the evidence — not a careful reading of call sites, which is true until the
 * next refactor and cannot be re-checked by anyone but its author.
 *
 * There is no exceptions list, deliberately. A carve-out is a hole with a
 * comment on it: the day a real edge appears, the exception absorbs it and
 * nobody notices. If this fails, the graph is wrong and the graph gets fixed.
 *
 * The public/internal boundary is the `internal/` path segment, which is a rule
 * about where a route lives rather than a list of names — a new public route
 * cannot accidentally inherit an exemption, and an internal one is marked by
 * the only thing a reader would also use to tell them apart.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const ROUTE_ROOT = "src/app/api";
/** Next allows a route handler anywhere under here, not only under ROUTE_ROOT. */
const APP_ROOT = "src/app";
const GUARD = "src/api/internal-guard.ts";
const FORBIDDEN_DIRS = ["src/sources/"];
const FORBIDDEN_PACKAGES = ["@anthropic-ai/sdk"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry === "route.ts") out.push(path);
  }
  return out;
}

/**
 * Value imports only. `import type` is erased by the compiler and emits
 * nothing at runtime, so such an edge cannot reach anything, let alone call
 * it. Skipping it is modelling what an import IS, not excusing one: a value
 * import of the same module is still a violation and still named.
 */
function importsOf(file: string): { local: string[]; packages: string[] } {
  const source = readFileSync(file, "utf8");
  const local: string[] = [];
  const packages: string[] = [];
  const valueImports = source.replace(/^import type .*$/gm, "");
  // Both forms that execute module code: `from "x"` and a bare `import "x"`.
  // A bare side-effect import IS a value import by this script's own model —
  // missing it was an accidental exception in a checker that deliberately
  // refuses to have an exceptions list.
  const specs = [
    ...[...valueImports.matchAll(/from "([^"]+)"/g)].map((m) => m[1]),
    ...[...valueImports.matchAll(/^\s*import\s+"([^"]+)"/gm)].map((m) => m[1]),
  ];
  for (const spec of specs) {
    const candidate = spec.startsWith("@/")
      ? join("src", spec.slice(2))
      : spec.startsWith(".")
        ? normalize(join(dirname(file), spec))
        : null;
    if (candidate === null) {
      packages.push(spec);
      continue;
    }
    for (const suffix of [".ts", ".tsx", "/index.ts"]) {
      if (existsSync(candidate + suffix)) {
        local.push(candidate + suffix);
        break;
      }
    }
  }
  return { local, packages };
}

function reachableViolations(route: string): string[] {
  const seen = new Set<string>();
  const stack = [route];
  const found: string[] = [];
  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const { local, packages } = importsOf(current);
    for (const pkg of packages) {
      if (FORBIDDEN_PACKAGES.includes(pkg)) found.push(`${pkg} via ${current}`);
    }
    for (const dep of local) {
      if (FORBIDDEN_DIRS.some((d) => dep.startsWith(d))) found.push(`${dep} via ${current}`);
      stack.push(dep);
    }
  }
  return [...new Set(found)].sort();
}

/** Transitive, and type-only imports are already stripped: a route that imports
 *  the guard for its TYPE does not call it, and does not reach it here. */
function reaches(route: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [route];
  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (current === target) return true;
    stack.push(...importsOf(current).local);
  }
  return false;
}

const all = walk(ROUTE_ROOT);
const publicRoutes = all.filter((r) => !r.includes(`${ROUTE_ROOT}/internal/`));
const internalRoutes = all.filter((r) => r.includes(`${ROUTE_ROOT}/internal/`));

let failed = false;
for (const route of publicRoutes.sort()) {
  const violations = reachableViolations(route);
  if (violations.length) {
    failed = true;
    console.error(`FAIL ${relative(ROUTE_ROOT, route)} can reach:`);
    for (const v of violations) console.error(`       ${v}`);
  }
}

// ── Every internal route reaches the secret guard ─────────────────────────
// Absorbed from src/api/internal-guard.test.ts (#106), which was temporary by
// instruction: it lived as a TEST rather than a second copy of this traversal
// because a drifted test goes red where a drifted second checker goes silent.
// That file is deleted; this is now the only implementation.
//
// It proves the guard is REACHABLE, which means imported, and cannot prove it
// is CALLED or called first. The behavioural assertions in api.test.ts cover
// that — an unauthenticated PUT returning 401 with the row unchanged — and the
// two are complementary: this covers every internal route shallowly, that one
// covers one route deeply.
for (const route of internalRoutes.sort()) {
  if (!reaches(route, GUARD)) {
    failed = true;
    console.error(`FAIL ${relative(ROUTE_ROOT, route)} does not reach ${GUARD}`);
  }
}

// ── Two floors, each on its own failure ───────────────────────────────────
//
// The old floor was `publicRoutes.length >= 8`, and it could not see the
// failure it most needed to: IT BOUNDED WHAT THE WALK FOUND, NOT WHAT EXISTS.
// A route.ts outside ROUTE_ROOT is not exempt from these rules — it is
// invisible to them — and a shorter loop looks exactly like a smaller app.
//
// Replaced with an INDEPENDENT source of truth: every route.ts in the whole of
// src/app. And with an equality rather than a threshold, so the value comes
// from the failure rather than from today's count — adding or removing an
// ordinary route moves both sides and cannot fire it, while a route the walk
// never classified fires it immediately (#90).
const everyRouteFile = walk(APP_ROOT);
if (everyRouteFile.length === 0) {
  // The only number here, and it is derived from the failure it catches: a
  // glob that matched nothing. An app with zero routes does not exist, so this
  // cannot fire on ordinary work.
  console.error(`FAIL no route.ts found anywhere under ${APP_ROOT} — the walk matched nothing`);
  failed = true;
} else if (everyRouteFile.length !== all.length) {
  const unexamined = everyRouteFile.filter((r) => !all.includes(r));
  console.error(
    `FAIL ${unexamined.length} route(s) exist under ${APP_ROOT} but outside ${ROUTE_ROOT}, ` +
      `so no rule in this file has examined them:`,
  );
  for (const r of unexamined) console.error(`       ${r}`);
  failed = true;
}

// The guarantee's own floor, and an equality for the same reason: removing an
// internal route legitimately moves both sides, while one ceasing to reach the
// guard moves only the left.
const reaching = internalRoutes.filter((r) => reaches(r, GUARD));
if (reaching.length !== internalRoutes.length) {
  console.error(
    `FAIL ${reaching.length} of ${internalRoutes.length} internal routes reach the guard`,
  );
  failed = true;
}

if (failed) process.exit(1);
console.log(
  `OK ${publicRoutes.length} public routes reach no adapter, no HTTP client and no LLM SDK; ` +
    `${reaching.length}/${internalRoutes.length} internal routes reach the guard; ` +
    `${all.length}/${everyRouteFile.length} route files under ${APP_ROOT} examined`,
);
