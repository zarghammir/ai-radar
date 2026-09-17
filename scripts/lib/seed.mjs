/**
 * Marks a browser context as a reader who has already been through onboarding.
 *
 * Every script that drives a page other than /welcome needs this. The first-run
 * gate lives in the ROOT LAYOUT, so it applies to every route: an unseeded
 * context asking for Today is sent to /welcome, and a script written before the
 * gate existed then waits thirty seconds for a control that is on a different
 * page. verify-today.mjs failed exactly that way the first time it ran against
 * the gate.
 *
 * It writes only if nothing is there. addInitScript runs on EVERY navigation,
 * a reload included, so an unguarded write would put the starting preferences
 * back over whatever the page had stored — and any assertion about a setting
 * surviving a reload would then be measuring this function rather than the app.
 *
 * Fixture mode only: against a real database the reader's state is in the
 * database and this does nothing.
 */
export async function markOnboarded(context) {
  await context.addInitScript(() => {
    try {
      const key = "ai-radar-fixture-preferences";
      if (localStorage.getItem(key) !== null) return;
      localStorage.setItem(key, JSON.stringify({ onboardedAt: "2026-09-01T00:00:00.000Z" }));
    } catch {}
  });
}
