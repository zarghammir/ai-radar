import { readInternalSecret, secretMatches, type SecretEnv } from "@/worker/secret";
import { describeError } from "@/pipeline/describe-error";

/**
 * THE RULE FOR EVERY ROUTE UNDER src/app/api (#103).
 *
 *   `internal/` means OPERATOR-ONLY and is secret-guarded.
 *   Everything outside it is READER-FACING and must not mutate operator state.
 *
 * Deliberately a rule and not a list. This module exists because
 * `PUT /api/sources/[key]` sat outside `internal/` with no guard at all, so
 * anyone on the internet could disable every source by key — and the keys are
 * in src/db/seed-data.ts, in a public repository. A list of guarded routes
 * would not have survived that route being added, in the same way that
 * catalogue.ts's list of excluded fields did not survive a new field (#101).
 * A rule tells the next author where their route belongs before they write it.
 *
 * "Operator state" is anything that changes what the product DOES: which
 * sources run, what gets ingested, how ranking behaves. Reader state — saves,
 * read marks, hidden stories — is a different question, and a different
 * ticket (#65 moves it onto the device, #95 covers shared topicKeys).
 *
 * WHAT THIS IS NOT. It is not authentication. The app is single-user and
 * self-hosted by design (schema.ts:206), and accounts are a different product.
 * This is the guard that already protects the ingest trigger, applied to the
 * other route that has the same blast radius.
 */
export function refuseUnlessInternal(
  request: Request,
  route: string,
  env?: SecretEnv,
): Response | null {
  let expected: string;
  try {
    expected = readInternalSecret(env);
  } catch (error) {
    // A secret that cannot be read is not permission to run without one. It is
    // refused here and said out loud on the server, where an operator can see
    // it — the caller is told only that the route is unavailable. Said once,
    // in one place, so the two internal routes cannot drift into telling a
    // caller different amounts about why they were refused.
    console.error(`${route} refused: ${describeError(error)}`);
    return Response.json({ error: `${route} is not configured` }, { status: 503 });
  }

  if (!secretMatches(request.headers.get("x-internal-secret"), expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}
