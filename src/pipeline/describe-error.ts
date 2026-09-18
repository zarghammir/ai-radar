import { redactConnectionParts } from "@/db/redact";

/**
 * The stored reason for a failure, cause chain included, with every fragment
 * of the database credential removed.
 *
 * A driver wraps a database error in one whose message is the SQL it was
 * running, and puts the database's own words on `cause`. Reading `.message`
 * alone leaves an operator with the statement that failed and no idea why:
 * a constraint, a bad cast and a full disk all look identical.
 *
 * WHY THIS IS ITS OWN LEAF MODULE (#103 review). It used to live in
 * src/pipeline/run.ts, so anything needing one error string imported the whole
 * ingestion pipeline — the adapter registry, clustering, ranking. That is
 * merely heavy for the worker, but src/api/internal-guard.ts needs it too, and
 * there it meant AUTHORISATION DEPENDED ON THE SUBSYSTEM IT AUTHORISES. This
 * file imports one leaf (@/db/redact) and nothing else, the same shape redact.ts
 * itself was given for the same reason.
 *
 * WHY THE REDACTION IS HERE AND NOT AT THE THREE PLACES THIS GETS PRINTED
 * (#99). What this returns is not only logged — it is WRITTEN to
 * `sources.lastError` and `ingestRuns.error` a few lines below, and
 * `GET /api/sources` serves `lastError` to anyone, with no authentication. So
 * a database failure mid-pass put the database's hostname on the public web
 * and left it there until that source next succeeded. Hardening the log sites
 * would have left the API serving the same fragment: this is the one point
 * both the log and the stored value pass through.
 *
 * THE DIAGNOSTIC COST IS ZERO, which is why this is not a trade. The host,
 * the user and the password are not information to the person who owns the
 * database — they already know where their database is. They are information
 * only to a stranger. What an operator actually needs is the failing
 * statement, the error code and the source key, and all three survive; the
 * tests assert that positively, so a function that returned "" could not pass.
 */
export function describeError(error: unknown): string {
  const seen: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    const text = current instanceof Error ? current.message : String(current);
    if (text && !seen.includes(text)) seen.push(text);
    if (!(current instanceof Error)) break;
    current = current.cause;
  }
  return redactConnectionParts(seen.join("\n") || String(error));
}
