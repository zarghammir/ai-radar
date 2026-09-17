import type postgres from "postgres";
import type { Db } from "@/db/client";
import { ingestOnce } from "./ingest";
import { type SecretEnv } from "./secret";
import { refuseUnlessInternal } from "@/api/internal-guard";

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
  // The same guard the source write uses, not a second copy of it. Two copies
  // of an authorisation check drift, and the one that drifts is the one nobody
  // is looking at.
  const refusal = refuseUnlessInternal(request, "/api/internal/ingest", deps.env);
  if (refusal) return refusal;

  const outcome = await ingestOnce(deps.db, deps.sql);
  if (!outcome.ran) {
    return Response.json(
      { ran: false, reason: "another ingest is already running" },
      { status: 409 },
    );
  }

  const { ingest, ranked } = outcome.result;
  return Response.json({
    ran: true,
    sources: ingest.bySource.length,
    fetched: ingest.bySource.reduce((sum, r) => sum + r.fetched, 0),
    new: ingest.itemsInserted,
    stories: ingest.storiesCreated,
    scored: ranked.ranked,
    failed: ingest.bySource.filter((r) => r.error).length,
  });
}
