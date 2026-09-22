import { describe, expect, it, vi } from "vitest";
import { sendPush } from "./push";
import type { VapidKeys } from "./vapid";
import { generateKeyPairSync } from "node:crypto";

function keys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const priv = privateKey.export({ format: "jwk" }) as { d: string };
  return {
    publicKey: Buffer.concat([
      Buffer.from([0x04]),
      Buffer.from(jwk.x, "base64url"),
      Buffer.from(jwk.y, "base64url"),
    ]).toString("base64url"),
    privateKey: Buffer.from(priv.d, "base64url").toString("base64url"),
    subject: "mailto:o@example.com",
  };
}

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const NOW = new Date("2026-09-22T08:00:00Z");
const reply = (status: number, body = "") =>
  vi.fn(async () => new Response(body, { status })) as unknown as typeof globalThis.fetch;

describe("sendPush", () => {
  it("reports a delivery on 201", async () => {
    expect(await sendPush(keys(), ENDPOINT, NOW, reply(201))).toEqual({ kind: "delivered" });
  });

  /**
   * 404 and 410 are the push service saying this browser is finished with us,
   * and they are separated from every other failure because they need the
   * OPPOSITE handling: a retired subscription must be deleted, and one that
   * failed for any other reason must be kept. Collapsed into one, this either
   * keeps dead rows failing forever or throws away a working reader over one
   * bad night.
   */
  it.each([404, 410])("reports %s as gone, not as a failure", async (status) => {
    const outcome = await sendPush(keys(), ENDPOINT, NOW, reply(status));
    expect(outcome.kind).toBe("gone");
  });

  it.each([400, 429, 500, 502])("reports %s as a failure that keeps the row", async (status) => {
    const outcome = await sendPush(keys(), ENDPOINT, NOW, reply(status, "nope"));
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") expect(outcome.detail).toContain(String(status));
  });

  it("reports a network error as a failure rather than throwing", async () => {
    const boom = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const outcome = await sendPush(keys(), ENDPOINT, NOW, boom);
    expect(outcome.kind).toBe("failed");
  });

  // A misconfigured key pair is the operator's problem, not the browser's.
  // Reporting it as `gone` would delete every subscription on the instance.
  it("reports a malformed key pair as a failure, never as gone", async () => {
    const broken = { ...keys(), publicKey: Buffer.from("nope").toString("base64url") };
    const outcome = await sendPush(broken, ENDPOINT, NOW, reply(201));
    expect(outcome.kind).toBe("failed");
  });

  it("sends no body, because the service worker fetches the brief itself", async () => {
    const fetchImpl = reply(201);
    await sendPush(keys(), ENDPOINT, NOW, fetchImpl);
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["content-length"]).toBe("0");
    expect((init.headers as Record<string, string>).authorization).toContain("vapid t=");
  });
});
