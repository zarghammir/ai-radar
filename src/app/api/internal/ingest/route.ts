import { db, sql } from "@/db/client";
import { handleIngestTrigger } from "@/worker/trigger";

/** Never cached: POST handlers are not cached by Next, and this one has effects. */
export async function POST(request: Request): Promise<Response> {
  return handleIngestTrigger(request, { db, sql });
}
