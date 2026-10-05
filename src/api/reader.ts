import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { userPreferences } from "@/db/schema";
import { ApiError } from "./http";
import type { StoryCard } from "./stories";

// No THEMES here any more. The theme is the reader's and lives on their device
// (#94), so this module has nothing to validate it against — ThemeScript reads
// it before first paint and the server never sees it.

/** The single-user preferences row. Version 1 has no accounts. */
export const PREFERENCES_ID = 1;

// ── Saved ────────────────────────────────────────────────────────────────────

export const saveBodySchema = z.object({
  note: z.string().max(2000).nullish(),
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
});

export interface SavedCard extends StoryCard {
  note: string | null;
  tags: string[];
  savedAt: string;
}

// ── Preferences ──────────────────────────────────────────────────────────────

/**
 * What the ONE shared row still carries: when the brief is cut and in which
 * zone. That is the instance's configuration — the same clock for every
 * reader, because there is one collector and one window — and since #203 it
 * is written only through the secret-guarded internal route.
 *
 * NO topicKeys, since #203. They were the last field every reader wrote into
 * this row and the ranker read back out for everyone, which made one visitor's
 * welcome-screen pick another visitor's feed. They live on the device now,
 * beside briefLength, theme and onboardedAt (#94), and reach the server as a
 * cookie per request. The column is still in the table; nothing writes or
 * reads it, and dropping it waits for the destructive migration in #190.
 */
export interface Preferences {
  briefTime: string;
  timezone: string;
  updatedAt: string;
}

export const preferencesPatchSchema = z
  .object({
    briefTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "briefTime must be HH:MM"),
    timezone: z.string().min(1),
  })
  .partial()
  // strict() is what turns "a field that moved to the device" into a 400
  // rather than a silently dropped write. topicKeys is now one of those.
  .strict();

const DEFAULTS = {
  topicKeys: [] as string[],
  briefTime: "07:30",
  timezone: "UTC",
  // `as const` because these columns are typed to their own value sets; a
  // widened string does not satisfy them.
  briefLength: "10" as const,
  theme: "system",
  onboardedAt: null,
};

function serialise(row: typeof userPreferences.$inferSelect): Preferences {
  return {
    briefTime: row.briefTime,
    timezone: row.timezone,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Reading preferences creates the row if it is not there, so a fresh install
 *  answers with defaults rather than a 404 nobody can act on. */
export async function getPreferences(db: Db): Promise<Preferences> {
  const [existing] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.id, PREFERENCES_ID));
  if (existing) return serialise(existing);

  const [created] = await db
    .insert(userPreferences)
    .values({ id: PREFERENCES_ID, ...DEFAULTS })
    .onConflictDoNothing()
    .returning();
  if (created) return serialise(created);

  const [raced] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.id, PREFERENCES_ID));
  return serialise(raced);
}

export async function updatePreferences(
  db: Db,
  patch: z.infer<typeof preferencesPatchSchema>,
): Promise<Preferences> {
  if (patch.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: patch.timezone });
    } catch {
      throw new ApiError(
        "VALIDATION_ERROR",
        `timezone "${patch.timezone}" is not an IANA time zone`,
      );
    }
  }

  await getPreferences(db);
  const [row] = await db
    .update(userPreferences)
    .set({
      ...patch,
      // Server-set, and ignored on input.
      updatedAt: new Date(),
    })
    .where(eq(userPreferences.id, PREFERENCES_ID))
    .returning();
  return serialise(row);
}
