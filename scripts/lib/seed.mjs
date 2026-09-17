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
 * FIXTURE MODE ONLY. Against a real database the reader's state is in the
 * database and this does nothing at all — see markOnboardedOnServer below,
 * which is the half that works there. Scripts call BOTH, because a script
 * cannot tell from inside the browser which mode the build was compiled in.
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

/**
 * The same fact, written where a LIVE build keeps it.
 *
 * WHY THIS EXISTS, and it is a dated failure rather than a precaution. On this
 * branch `USING_FIXTURES` defaults to true and CI sets no override, so the
 * localStorage half above is enough today. PR #65 — which merges BEFORE this
 * one — flips that default to live-by-default. The moment it lands, the
 * localStorage write becomes a no-op in CI, the first-run gate reads
 * `onboarded_at` from a freshly migrated row where it is NULL, and every
 * browser script is sent to /welcome again. The same failure, one merge later,
 * for a reason nothing in the script would explain.
 *
 * So the fact is written on BOTH sides and neither is required to succeed: the
 * localStorage one silently does nothing against a database, this one fails
 * when there is no database to write to, and the landing-path floors in the
 * scripts catch the case where neither applied. Tolerant on purpose — a
 * maintainer running these on fixtures with no DATABASE_URL should not be
 * stopped by a write that cannot matter to them.
 *
 * Returns whether it applied, so a caller can report it rather than assume it.
 */
export async function markOnboardedOnServer(base) {
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
