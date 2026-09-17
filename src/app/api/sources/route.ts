import { getDb } from "@/db/client";
import { listSources } from "@/api/catalogue";
import { handle, json } from "@/api/http";

export async function GET(): Promise<Response> {
  return handle(async () => json({ sources: await listSources(getDb(), new Date()) }));
}
