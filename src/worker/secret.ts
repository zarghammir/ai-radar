import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Values that ship in .env.example and therefore protect nothing.
 *
 * Kept as a constant rather than read from the file at runtime, because the
 * file is not in the container image. src/worker/secret.test.ts pins this list
 * against .env.example, so changing the placeholder there fails the suite
 * instead of leaving the guard blind to the value people actually copy.
 */
export const SECRET_PLACEHOLDERS: readonly string[] = ["change-me"];

const HOW_TO_GENERATE = "Generate one with: openssl rand -hex 32";

/**
 * The secret that guards /api/internal/*, or a refusal to start without one.
 *
 * Starting with no secret would expose the ingest trigger to anyone who can
 * reach the port, so this throws rather than defaulting to something.
 */
/**
 * Only the variable this guard reads. Next narrows NodeJS.ProcessEnv to a
 * required NODE_ENV, so a plain `{ INTERNAL_API_SECRET }` literal is not a
 * ProcessEnv and could not be passed in a test.
 */
export type SecretEnv = Partial<Record<string, string>>;

export function readInternalSecret(env: SecretEnv = process.env): string {
  const secret = (env.INTERNAL_API_SECRET ?? "").trim();

  if (!secret) {
    throw new Error(
      `INTERNAL_API_SECRET is not set. The internal ingest trigger will not run without it. ${HOW_TO_GENERATE}`,
    );
  }

  if (SECRET_PLACEHOLDERS.includes(secret)) {
    throw new Error(
      `INTERNAL_API_SECRET is still the .env.example placeholder "${secret}", which is public and protects nothing. ${HOW_TO_GENERATE}`,
    );
  }

  return secret;
}

/**
 * Compares a supplied secret against the expected one in constant time.
 *
 * Digesting first gives both sides a fixed length, so an attacker learns
 * nothing from the length of their guess and timingSafeEqual cannot throw on
 * mismatched buffers — a throw here would turn a wrong header into a 500.
 */
export function secretMatches(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
