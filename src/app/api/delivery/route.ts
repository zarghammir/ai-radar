import { getDb } from "@/db/client";
import { readDeliveryStatus } from "@/api/delivery";
import { handle, json } from "@/api/http";

/**
 * Is the brief actually reaching anyone?
 *
 * Public, matching GET /api/sources, which already serves per-source health on
 * the same instance. The two answer the same question about opposite ends of
 * the pipeline — is anything coming in, is anything going out — and splitting
 * their audiences would mean one of them was wrong.
 *
 * It carries no endpoint and no stored error text; see src/api/delivery.ts for
 * why that is a rule rather than an omission.
 */
export async function GET(): Promise<Response> {
  return handle(async () => json(await readDeliveryStatus(getDb())));
}
