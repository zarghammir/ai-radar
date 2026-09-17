/**
 * Marking a browser context as a reader who has already been through
 * onboarding — on BOTH sides, in ONE call.
 *
 * Every script that drives a page other than /welcome needs this. The
 * first-run gate lives in the ROOT LAYOUT, so it applies to every route: an
 * unseeded context asking for Today is sent to /welcome, and a script written
 * before the gate existed then waits thirty seconds for a control on a
 * different page.
 *
 * WHY ONE FUNCTION AND NOT TWO. The fact lives in two places depending on how
 * the app was built — localStorage on a fixture build, `user_preferences` on a
 * live one — and a script cannot tell from inside the browser which it is
 * facing. The first version of this exposed the two halves separately, and
 * three of four scripts called both while the fourth called only one. That
 * fourth script was the one whose entire subject is the gated screens. So the
 * halves are no longer separable at the call site: `markOnboarded` writes both
 * and a caller cannot do half of it by forgetting a line.
 *
 * Neither half is required to succeed. The localStorage write silently does
 * nothing against a database; the server write fails when there is no database
 * to reach, which is the ordinary case for a maintainer on fixtures. The
 * landing-path floors in each script are what catch the case where NEITHER
 * applied — that is the guard, not this function.
 */

/**
 * One write per server per process. Three contexts in a script do not need
 * three PUTs, and a memoised promise means concurrent callers share one.
 */
const serverSeeds = new Map();

async function putOnboarded(base) {
  try {
    const response = await fetch(`${base}/api/preferences`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ onboardedAt: new Date().toISOString() }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * The live half on its own, for a script that seeds its contexts inline rather
 * than through `markOnboarded` — the accessibility sweep does, because it has
 * theme and saved state to write in the same init script.
 *
 * Returns whether it applied, so a caller can REPORT it rather than assume it.
 * A caller that discards this is claiming something it did not check.
 */
export function markOnboardedOnServer(base) {
  if (!base) return Promise.resolve(false);
  if (!serverSeeds.has(base)) serverSeeds.set(base, putOnboarded(base));
  return serverSeeds.get(base);
}

/**
 * Writes the fact on both sides for one context and returns whether the live
 * half applied.
 *
 * The localStorage write is WRITE-ONCE. addInitScript runs on EVERY
 * navigation, a reload included, so an unguarded write puts the starting
 * preferences back over whatever the page has stored — and any assertion about
 * a setting surviving a reload would then be measuring this function rather
 * than the app.
 *
 * `base` is optional only so a caller with no server to reach can omit it
 * deliberately. Passing it is the normal case.
 */
export async function markOnboarded(context, base) {
  await context.addInitScript(() => {
    try {
      const key = "ai-radar-fixture-preferences";
      if (localStorage.getItem(key) !== null) return;
      localStorage.setItem(key, JSON.stringify({ onboardedAt: "2026-09-01T00:00:00.000Z" }));
    } catch {}
  });
  return markOnboardedOnServer(base);
}
