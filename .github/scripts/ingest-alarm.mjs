#!/usr/bin/env node
/**
 * Decide what the scheduled collector should do about an open alarm issue.
 *
 * WHY THIS EXISTS. Ingestion failed 25+ consecutive scheduled runs across four
 * days and NOTHING TOLD ANYONE. It was found because a person happened to look.
 * A red run on a public repository is only a notification if somebody opens the
 * Actions tab, and nobody does that on a schedule.
 *
 * The missing column behind that outage is worth fixing. THIS IS WORTH MORE:
 * it would have caught the outage on day one, and it catches the NEXT cause
 * too — a bad seed, a suspended database, a rotated credential, a broken feed
 * host — none of which an auto-migrate would have touched.
 *
 * WHY A DECISION FUNCTION RATHER THAN INLINE YAML. A notifier nobody has seen
 * fire is an unreported unknown, and the shell version can only be tested by
 * breaking production ingestion. This is pure: outcome plus "is an alarm
 * already open" in, one action out, and `--self-test` drives all four cases
 * including the ones that must do NOTHING.
 *
 * NOT-SPAMMING IS A REQUIREMENT, NOT A NICETY. Thirty failures must produce one
 * issue, or the alarm trains its reader to filter it — which is how a real one
 * gets missed. So: open on the first failure, stay quiet while it is still
 * failing, close on recovery.
 */

/**
 * @param {"success"|"failure"} outcome  what the ingestion run did
 * @param {boolean} alarmOpen            is there already an open alarm issue
 * @returns {"open"|"close"|"nothing"}
 */
export function decide(outcome, alarmOpen) {
  if (outcome === "failure") return alarmOpen ? "nothing" : "open";
  if (outcome === "success") return alarmOpen ? "close" : "nothing";
  throw new Error(`unknown outcome ${JSON.stringify(outcome)}`);
}

const decideFlag = process.argv.indexOf("--decide");
if (decideFlag !== -1) {
  const outcome = process.argv[decideFlag + 1];
  const alarmOpen = process.argv[decideFlag + 2] === "true";
  process.stdout.write(decide(outcome, alarmOpen));
} else if (process.argv.includes("--self-test")) {
  // Every case, including both "nothing" branches — a notifier that only ever
  // fires is as broken as one that never does, and the silent cases are the
  // ones no manual test exercises.
  const cases = [
    ["failure", false, "open"], // the outage starts — this is the one that was missing
    ["failure", true, "nothing"], // still failing — 30 runs must not make 30 issues
    ["success", true, "close"], // recovered — the alarm clears itself
    ["success", false, "nothing"], // ordinary green run
  ];
  let bad = 0;
  for (const [outcome, alarmOpen, want] of cases) {
    const got = decide(outcome, alarmOpen);
    const ok = got === want;
    if (!ok) bad++;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} decide(${outcome}, ${alarmOpen}) = ${got}, want ${want}`,
    );
  }
  let threw = false;
  try {
    decide("weird", false);
  } catch {
    threw = true;
  }
  if (!threw) {
    bad++;
    console.log("  FAIL an unknown outcome must throw rather than silently do nothing");
  } else {
    console.log("  ok   an unknown outcome throws");
  }
  console.log(bad === 0 ? "RESULT: all 5 cases pass" : `RESULT: ${bad} case(s) wrong`);
  process.exit(bad === 0 ? 0 : 1);
}
