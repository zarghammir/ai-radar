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
  // No server half any more. onboardedAt moved to the device in #94, so the
  // localStorage write below IS the whole fact — there is no row to mirror it
  // into. `base` stays in the signature because every caller passes it and the
  // day something else needs a server-side seed it belongs here.
  void base;
  return true;
}
