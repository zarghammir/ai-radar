import { db } from "@/db/client";
import { listTopics } from "@/api/catalogue";
import { handle, json } from "@/api/http";

export async function GET(): Promise<Response> {
  return handle(async () => json({ topics: await listTopics(db, new Date()) }));
}
