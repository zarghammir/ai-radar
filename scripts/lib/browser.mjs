/**
 * Shared browser resolution for the verification scripts.
 *
 * It lives here so the logic exists once. Two scripts each resolving a browser
 * their own way is how one of them ends up with a hard-coded path that only
 * works on the machine it was written on — which is finding 6 on PR #31.
 *
 * This project depends on `playwright-core`, which ships NO browsers, so
 * `npm ci` stays cheap and CI is unaffected. A browser is found by:
 *
 *   1. $PW_EXECUTABLE, if you point it at a Chromium binary; otherwise
 *   2. the Google Chrome already installed, via Playwright's "chrome" channel.
 */
import { chromium } from "playwright-core";

export async function launchBrowser() {
  const executablePath = process.env.PW_EXECUTABLE;
  if (executablePath) return chromium.launch({ executablePath });
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch (error) {
    console.error(
      "No browser to drive.\n" +
        "  Set PW_EXECUTABLE to a Chromium binary, or install Google Chrome so\n" +
        "  Playwright's 'chrome' channel resolves.\n" +
        "  " +
        String(error?.message ?? error),
    );
    process.exit(2);
  }
}

/**
 * Fail with something a reader can act on. Without this the first navigation
 * throws a raw connection error and the person running it has no idea the
 * script expected a server to already be up.
 */
export async function requireServer(base) {
  try {
    const response = await fetch(base, { method: "GET" });
    if (!response.ok) throw new Error(`answered ${response.status}`);
  } catch (error) {
    console.error(
      `Nothing is serving ${base}.\n` +
        "  This script measures a PRODUCTION build; start one first:\n" +
        "    npx next build && npx next start -p 3210\n" +
        "  then re-run with the same URL.\n" +
        "  " +
        String(error?.message ?? error),
    );
    process.exit(2);
  }
}
