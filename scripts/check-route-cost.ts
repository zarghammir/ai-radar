/**
 * Proves the cost rule: no route a client can reach can cause a paid call.
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
const FORBIDDEN_DIRS = ["src/sources/"];
const FORBIDDEN_PACKAGES = ["@anthropic-ai/sdk"];
/** Below this, the walk found too little to be believed. */
const MINIMUM_ROUTES = 8;

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
  for (const [, spec] of valueImports.matchAll(/from "([^"]+)"/g)) {
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

// A checker that walked nothing finds nothing. Say what was examined, always.
if (publicRoutes.length < MINIMUM_ROUTES) {
  console.error(
    `FAIL examined only ${publicRoutes.length} public routes, expected at least ${MINIMUM_ROUTES} — the walk found too little to be believed`,
  );
  failed = true;
}

if (failed) process.exit(1);
console.log(
  `OK ${publicRoutes.length} public routes reach no adapter, no HTTP client and no LLM SDK` +
    (internalRoutes.length
      ? ` (${internalRoutes.length} internal route(s) not subject to this rule)`
      : ""),
);
