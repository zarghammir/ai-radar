import { createPrivateKey, sign as signWith } from "node:crypto";

/**
 * VAPID: proving to a push service that this server is who it claims to be.
 *
 * WRITTEN AGAINST node:crypto RATHER THAN A PACKAGE, deliberately. The usual
 * dependency (`web-push`) exists mostly to do RFC 8291 payload encryption —
 * ECDH, HKDF and AES-GCM — and this build sends NO PAYLOAD, so none of that
 * code would run. What is left is a signed JWT, which Node does natively.
 *
 * The trade is stated rather than buried: no payload means the notification's
 * text is fetched by the service worker when it arrives instead of travelling
 * inside the push. That costs an offline case — a push received with no
 * network shows a generic line instead of the headline — and buys no new
 * dependency, no hand-rolled cryptography, and a notification whose contents
 * are current at the moment it is READ rather than at the moment it was sent.
 *
 * NO KEY IS EVER RETURNED OR LOGGED. It is read here, used here, and the only
 * thing that leaves is a signature.
 */

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export type VapidEnv = Partial<Record<string, string>>;

export type VapidSettings = { enabled: true; keys: VapidKeys } | { enabled: false; reason: string };

/**
 * The keys, or the variable an operator would have to set.
 *
 * Never throws, for the same reason readLlmSettings does not: delivery is
 * optional and a worker that collects seventeen feeds must not die because a
 * notification key is missing.
 */
export function readVapidSettings(env: VapidEnv = process.env): VapidSettings {
  const publicKey = (env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (env.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (env.VAPID_SUBJECT ?? "").trim();

  if (!publicKey) return { enabled: false, reason: "NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set" };
  if (!privateKey) return { enabled: false, reason: "VAPID_PRIVATE_KEY is not set" };
  if (!subject) return { enabled: false, reason: "VAPID_SUBJECT is not set" };
  if (!/^(mailto:|https:)/.test(subject)) {
    return {
      enabled: false,
      reason: `VAPID_SUBJECT must be a mailto: or https: URL, not "${subject}"`,
    };
  }
  return { enabled: true, keys: { publicKey, privateKey, subject } };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function fromBase64url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

/**
 * The signing key, rebuilt from the raw bytes the generator prints.
 *
 * `npx web-push generate-vapid-keys` emits base64url values, not PEM: the
 * private key is the 32-byte scalar and the public key is an uncompressed
 * P-256 point, `0x04 || x || y`. Node will not import those directly, so they
 * are assembled into a JWK, which is the documented path and involves no
 * hand-rolled cryptography.
 */
export function privateKeyFrom(keys: VapidKeys) {
  const d = fromBase64url(keys.privateKey);
  const point = fromBase64url(keys.publicKey);

  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error(
      `NEXT_PUBLIC_VAPID_PUBLIC_KEY is not an uncompressed P-256 point (expected 65 bytes starting 0x04, got ${point.length})`,
    );
  }
  if (d.length !== 32) {
    throw new Error(`VAPID_PRIVATE_KEY is not a 32-byte P-256 scalar (got ${d.length})`);
  }

  return createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: base64url(d),
      x: base64url(point.subarray(1, 33)),
      y: base64url(point.subarray(33, 65)),
    },
  });
}

/** The push service this endpoint belongs to — the JWT's audience. */
export function audienceOf(endpoint: string): string {
  return new URL(endpoint).origin;
}

/** Twelve hours. The spec's ceiling is 24; half of it survives a slow queue. */
export const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

/**
 * The `Authorization` header value for one endpoint.
 *
 * ES256 signatures must be the raw 64-byte r||s pair, not the DER encoding
 * Node produces by default — `dsaEncoding` is what selects that, and a push
 * service answers a DER signature with 401.
 */
export function authorizationHeader(keys: VapidKeys, endpoint: string, now: Date): string {
  const header = base64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = base64url(
    JSON.stringify({
      aud: audienceOf(endpoint),
      exp: Math.floor(now.getTime() / 1000) + TOKEN_LIFETIME_SECONDS,
      sub: keys.subject,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = signWith("sha256", Buffer.from(signingInput), {
    key: privateKeyFrom(keys),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${signingInput}.${base64url(signature)}, k=${keys.publicKey}`;
}
