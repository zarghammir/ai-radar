import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY ROUTE UNDER internal/ REACHES THE SECRET GUARD.
 *
 * The rule this enforces is stated in src/api/internal-guard.ts and
 * docs/architecture.md: `internal/` means operator-only and is secret-guarded.
 * Before #103 that rule was true only because someone kept it true by hand —
 * `PUT /api/sources/[key]` mutated operator state with no guard at all.
 *
 * TEMPORARY BY INSTRUCTION, NOT BY INTENTION (#106). This duplicates a
 * traversal scripts/check-route-cost.ts already performs for the cost rule,
 * whose own comment calls the internal/ segment "a rule rather than a list".
 * That script is the Intelligence lane's and the long-term home for this
 * check; #106 owns folding it in and deleting this file. It lives here rather
 * than there so the rule and its enforcement land in the same PR without one
 * lane editing another's script — and as a TEST rather than a second copy of
 * the check, because a drifted test goes red where a drifted second checker
 * goes silent.
 *
 * WHAT THIS CHECK DOES NOT PROVE, stated because the test's NAME is a
 * coverage claim and this one promises less than it sounds like. It asserts
 * the guard module is REACHABLE from the route, which means imported. It does
 * not and cannot prove the guard is CALLED, or called before anything is read
 * or written. A route that imports `refuseUnlessInternal` and never invokes it
 * passes this file. The behavioural assertions in src/api/api.test.ts are what
 * cover that — an unauthenticated PUT returning 401 with THE ROW UNCHANGED —
 * and the two are complementary rather than redundant: this one covers every
 * internal route automatically and shallowly, that one covers one route
 * deeply. Neither alone is enough, and the deletion controls are run against
 * both because removing the CALL and removing the IMPORT redden different
 * files.
 *
 * WHY IT WALKS THE FILESYSTEM RATHER THAN LISTING ROUTES. A list would need
 * editing every time a route is added, which is the failure this rule exists
 * to prevent: #101 exists because a list of excluded fields did not survive a
 * new field. A new internal route is covered the day it is added.
 */
const ROUTE_ROOT = "src/app/api";
const GUARD = "src/api/internal-guard.ts";

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...routeFiles(path));
    else if (entry === "route.ts") found.push(path);
  }
  return found;
}

/** Local imports only; a package specifier is not a file in this tree. */
function localImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specs = [...source.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)].map(
    (m) => m[1],
  );
  const out: string[] = [];
  for (const spec of specs) {
    const base = spec.startsWith("@/")
      ? join("src", spec.slice(2))
      : spec.startsWith(".")
        ? join(file, "..", spec)
        : null;
    if (base === null) continue;
    for (const suffix of [".ts", ".tsx", "/index.ts"]) {
      if (existsSync(base + suffix)) {
        out.push(base + suffix);
        break;
      }
    }
  }
  return out;
}

/** Transitive: a route may reach the guard through a handler module. */
function reaches(route: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [route];
  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (current === target) return true;
    stack.push(...localImports(current));
  }
  return false;
}

const routes = routeFiles(ROUTE_ROOT);
const internal = routes.filter((r) => r.includes(join(ROUTE_ROOT, "internal") + "/"));

describe("the internal/ boundary is guarded", () => {
  /**
   * THE FLOOR, and it is not decoration. `it.each` over an empty array
   * generates NO TESTS and the file passes perfectly — the same shape as a
   * registry test that cannot see a missing entry, which is exactly what this
   * check is guarding against elsewhere. If the walk stops finding routes
   * because a directory moved, this is the assertion that says so.
   *
   * It does a second job that is worth knowing before anyone lowers it: 8
   * also catches a walk that PARTIALLY breaks and returns two routes instead
   * of thirteen. A floor of 1 would satisfy the empty-array case equally well
   * and be blind to that one.
   *
   * WHAT THIS FLOOR CANNOT SEE, and the limitation is identical at 8 or at 1:
   * IT BOUNDS WHAT THE WALK FOUND, NOT WHAT EXISTS. A route.ts under src/app
   * but outside src/app/api is never walked, so it is not exempt from this
   * rule — it is invisible to it, and to the cost rule in
   * scripts/check-route-cost.ts, which has a floor of the same shape. Measured
   * 2026-09-17 across the whole of src/app: 13 route files, all inside
   * src/app/api, 2 internal and 11 public, zero outside. The gap is real and
   * currently empty.
   *
   * #106 owns replacing this with a count taken from an INDEPENDENT source of
   * truth — every route.ts under src/app — so the floor bounds the repository
   * rather than the search. Until then this number is a tripwire, not a census.
   */
  it("found routes to check at all", () => {
    expect(routes.length).toBeGreaterThanOrEqual(8);
    expect(internal.length).toBeGreaterThanOrEqual(1);
  });

  it.each(internal)("%s reaches the internal guard", (route) => {
    expect(reaches(route, GUARD)).toBe(true);
  });

  /**
   * The positive beside the negative. Without it, a `reaches` that returned
   * true for everything — a resolver bug, a target that matches too eagerly —
   * would satisfy every assertion above. A public route must NOT reach the
   * guard, because reaching it would mean a reader-facing route is refusing
   * unauthenticated callers.
   */
  it("a public route does not reach the guard, so the check discriminates", () => {
    const publicRoutes = routes.filter((r) => !internal.includes(r));
    expect(publicRoutes.length).toBeGreaterThanOrEqual(1);
    expect(reaches("src/app/api/radar/route.ts", GUARD)).toBe(false);
  });
});
