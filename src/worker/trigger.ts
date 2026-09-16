import type postgres from "postgres";
import type { Db } from "@/db/client";
import { describeError } from "@/pipeline/run";
import { ingestOnce } from "./ingest";
import { readInternalSecret, secretMatches, type SecretEnv } from "./secret";

export interface TriggerDeps {
  db: Db;
  sql: postgres.Sql;
  /** Defaults to the process environment; injected in tests. */
  env?: SecretEnv;
}

/**
 * The internal ingest trigger, as a plain function so it can be tested without
 * a server. src/app/api/internal/ingest/route.ts is the thin Next wrapper.
 *
 * Order matters: the secret is checked before anything reads or writes, so a
 * caller who cannot authenticate leaves no trace in ingest_runs and costs
 * nothing to refuse.
 */
export async function handleIngestTrigger(request: Request, deps: TriggerDeps): Promise<Response> {
  let expected: string;
  try {
    expected = readInternalSecret(deps.env);
  } catch (error) {
    // A secret that cannot be read is not permission to run without one. It is
    // refused here and said out loud on the server, where an operator can see
    // it — the caller is told only that the trigger is unavailable.
    console.error(`/api/internal/ingest refused: ${describeError(error)}`);
    return Response.json(
      { error: "the internal ingest trigger is not configured" },
      { status: 503 },
    );
  }

  if (!secretMatches(request.headers.get("x-internal-secret"), expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const outcome = await ingestOnce(deps.db, deps.sql);
  if (!outcome.ran || !outcome.result) {
    return Response.json(
      { ran: false, reason: "another ingest is already running" },
      { status: 409 },
    );
  }

  const result = outcome.result;
  return Response.json({
    ran: true,
    sources: result.bySource.length,
    fetched: result.bySource.reduce((sum, r) => sum + r.fetched, 0),
    new: result.itemsInserted,
    stories: result.storiesCreated,
    failed: result.bySource.filter((r) => r.error).length,
  });
}
