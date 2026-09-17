import { handleIngestTrigger } from "@/worker/trigger";

/**
 * The internal ingest trigger. POST handlers are not cached by Next, and this
 * one has effects.
 *
 * The database client is imported at request time rather than at the top of
 * the file on purpose: src/db/client.ts throws when DATABASE_URL is unset, and
 * `next build` imports every route module to collect its page data. A
 * top-level import therefore fails any build without a database — which is
 * exactly what the Docker image build is.
 */
export async function POST(request: Request): Promise<Response> {
  const { getDb, getSql } = await import("@/db/client");
  return handleIngestTrigger(request, { db: getDb(), sql: getSql() });
}
