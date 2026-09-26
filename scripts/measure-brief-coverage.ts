import "dotenv/config";
import { getDb, getSql } from "@/db/client";
import {
  BRIEF_LENGTHS,
  briefWindow,
  storiesInWindow,
  takeWithinReadingTime,
  type BriefLength,
} from "@/api/brief";
import { userPreferences } from "@/db/schema";
import { briefCoverage, coverageLines } from "@/worker/brief-coverage";

/**
 * How much of the brief the reader would open carries a summary? (#149-adjacent)
 *
 * READ-ONLY. Selects and writes nothing.
 *
 * THIS IS THE ACCEPTANCE NUMBER, and the reason it is a script rather than a
 * test is that it is a fact about the live corpus at an instant, not a property
 * of the code. "The summariser ran" was true on the pass that produced one
 * summary in a ten-story brief; this is the number that was not.
 *
 * ── WHY THE INSTANT AND THE BOUNDS ARE PRINTED WITH IT ───────────────────
 * The brief's window is computed from `briefTime` and `timezone` and IT MOVES.
 * The worker summarises on a pass; the reader opens the app later; the window
 * has rolled in between. So a bare fraction cannot distinguish two different
 * failures:
 *
 *   selection is wrong    the worker summarised stories outside the window
 *   the window moved      the worker summarised the right stories and the
 *                         window has since rolled past them
 *
 * Both look like "few summaries in my brief". Printing the instant and the
 * bounds is what keeps them separable, so we do not fix the wrong one twice.
 *
 *   npx tsx scripts/measure-brief-coverage.ts
 */
async function main(): Promise<void> {
  const now = new Date();
  const db = getDb();

  const [prefs] = await db
    .select({ briefTime: userPreferences.briefTime, timezone: userPreferences.timezone })
    .from(userPreferences)
    .limit(1);

  if (!prefs) {
    console.error("no user_preferences row, so there is no brief window to measure.");
    process.exitCode = 1;
    return;
  }

  const window = briefWindow(now, prefs.briefTime, prefs.timezone);
  const cards = await storiesInWindow(db, window);

  // The headline figure comes from the SHARED module, not from arithmetic done
  // here: the same number will be reported on every ingest pass once the step
  // summary from #164 can call it, and two implementations of one figure is how
  // a script and a report start disagreeing.
  for (const line of coverageLines(await briefCoverage(db, now))) console.log(line);
  console.log("");

  console.log(`measured at   ${now.toISOString()}`);
  console.log(`brief time    ${prefs.briefTime} ${prefs.timezone}`);
  console.log(`window        ${window.from.toISOString()}  ->  ${window.to.toISOString()}`);
  console.log(
    `              (${((window.to.getTime() - window.from.getTime()) / 3_600_000).toFixed(1)} hours wide)`,
  );
  console.log("");

  if (cards.length === 0) {
    // Not zero coverage — no denominator. An empty window and a window whose
    // stories are all unsummarised are different facts.
    console.log("the window is EMPTY: nothing arrived since the last brief time.");
    console.log("that is not 0% coverage, it is no denominator. Nothing to conclude.");
    return;
  }

  const withSummary = cards.filter((c) => c.summary !== null).length;
  console.log(
    `WHOLE WINDOW   ${withSummary}/${cards.length} carry a summary  (${((withSummary / cards.length) * 100).toFixed(0)}%)`,
  );

  // The reader sees a PREFIX of this ordering, and which prefix depends on a
  // length that lives in their browser. So the figure is reported per length
  // rather than pretending the worker knows which one they chose.
  console.log("");
  console.log("what a reader would actually open:");
  for (const length of BRIEF_LENGTHS as readonly BriefLength[]) {
    const shown = takeWithinReadingTime(cards, length);
    if (shown.length === 0) {
      console.log(`  length ${String(length).padEnd(4)} no stories fit`);
      continue;
    }
    const covered = shown.filter((c) => c.summary !== null).length;
    console.log(
      `  length ${String(length).padEnd(4)} ${covered}/${shown.length}  (${((covered / shown.length) * 100).toFixed(0)}%)`,
    );
  }

  // The front of the list is what a reader reads first and is where a miss is
  // most visible, so it is called out rather than left inside an average.
  const firstFive = cards.slice(0, 5);
  console.log("");
  console.log("the top of the brief, story by story:");
  for (const card of firstFive) {
    console.log(`  ${card.summary !== null ? "yes" : " NO"}  ${card.title.slice(0, 84)}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await getSql()
      .end({ timeout: 5 })
      .catch(() => {});
  });
