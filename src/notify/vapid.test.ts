import { readFileSync } from "node:fs";
import { generateKeyPairSync, createPublicKey, verify as verifyWith } from "node:crypto";
import { describe, expect, it } from "vitest";
import { audienceOf, authorizationHeader, readVapidSettings, type VapidKeys } from "./vapid";

/** A real P-256 pair in the base64url form `web-push generate-vapid-keys` prints. */
function generateKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const priv = privateKey.export({ format: "jwk" }) as { d: string };
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);
  return {
    publicKey: point.toString("base64url"),
    privateKey: Buffer.from(priv.d, "base64url").toString("base64url"),
    subject: "mailto:owner@example.com",
  };
}

describe("readVapidSettings", () => {
  it("is disabled with an empty environment and names the variable", () => {
    const s = readVapidSettings({});
    expect(s.enabled).toBe(false);
    if (!s.enabled) expect(s.reason).toContain("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  });

  it.each([
    ["VAPID_PRIVATE_KEY", { NEXT_PUBLIC_VAPID_PUBLIC_KEY: "p" }],
    ["VAPID_SUBJECT", { NEXT_PUBLIC_VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "k" }],
  ])("names %s when it is the missing one", (missing, env) => {
    const s = readVapidSettings(env);
    expect(s.enabled).toBe(false);
    if (!s.enabled) expect(s.reason).toContain(missing);
  });

  // Push services reject a subject that is not a contact URL, and they do it
  // at send time. Catching it here turns a silent nightly failure into a
  // sentence on the screen.
  it("refuses a subject that is not a contact URL", () => {
    const s = readVapidSettings({
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "p",
      VAPID_PRIVATE_KEY: "k",
      VAPID_SUBJECT: "owner@example.com",
    });
    expect(s.enabled).toBe(false);
  });

  it("enables on a complete set", () => {
    expect(
      readVapidSettings({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "p",
        VAPID_PRIVATE_KEY: "k",
        VAPID_SUBJECT: "mailto:o@example.com",
      }).enabled,
    ).toBe(true);
  });
});

describe("audienceOf", () => {
  it("is the push service's origin, never the full endpoint", () => {
    expect(audienceOf("https://fcm.googleapis.com/fcm/send/abc123")).toBe(
      "https://fcm.googleapis.com",
    );
  });
});

describe("authorizationHeader", () => {
  const keys = generateKeys();
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
  const now = new Date("2026-09-22T08:00:00Z");

  it("is a vapid header carrying the token and the public key", () => {
    const header = authorizationHeader(keys, endpoint, now);
    expect(header.startsWith("vapid t=")).toBe(true);
    expect(header).toContain(`k=${keys.publicKey}`);
  });

  /**
   * THE ASSERTION THAT MATTERS, and the one a shape check would miss.
   *
   * Node signs ECDSA as DER by default. A push service answers a DER signature
   * with 401 and nothing else goes wrong — the brief simply never arrives,
   * which is the silent failure this whole ticket is about. Verifying the
   * signature against the public key is what proves `dsaEncoding` is right.
   */
  it("signs with a raw P-256 signature a push service can verify", () => {
    const header = authorizationHeader(keys, endpoint, now);
    const token = header.slice("vapid t=".length, header.indexOf(", k="));
    const [encodedHeader, encodedPayload, signature] = token.split(".");

    const publicKey = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: Buffer.from(keys.publicKey, "base64url").subarray(1, 33).toString("base64url"),
        y: Buffer.from(keys.publicKey, "base64url").subarray(33, 65).toString("base64url"),
      },
    });

    const ok = verifyWith(
      "sha256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(ok).toBe(true);
    expect(Buffer.from(signature, "base64url")).toHaveLength(64);
  });

  it("claims the endpoint's origin and an expiry in the future", () => {
    const header = authorizationHeader(keys, endpoint, now);
    const payload = JSON.parse(Buffer.from(header.split(".")[1], "base64url").toString("utf8")) as {
      aud: string;
      exp: number;
      sub: string;
    };
    expect(payload.aud).toBe("https://fcm.googleapis.com");
    expect(payload.sub).toBe(keys.subject);
    expect(payload.exp).toBeGreaterThan(Math.floor(now.getTime() / 1000));
  });

  it("refuses a public key that is not an uncompressed P-256 point", () => {
    expect(() =>
      authorizationHeader(
        { ...keys, publicKey: Buffer.from("short").toString("base64url") },
        endpoint,
        now,
      ),
    ).toThrow(/uncompressed P-256 point/);
  });
});

describe(".env.example", () => {
  it("documents all three variables this module reads", () => {
    const env = readFileSync(".env.example", "utf8");
    for (const name of ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
      expect(env, `${name} is not in .env.example`).toContain(name);
    }
  });
});
