import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import {
  NOTIFICATION_CHANNELS,
  readState,
  savedItems,
  stories,
  topics,
  userPreferences,
} from "@/db/schema";
import { ApiError } from "./http";
import { buildCards, type StoryCard } from "./stories";

// No THEMES here any more. The theme is the reader's and lives on their device
// (#94), so this module has nothing to validate it against — ThemeScript reads
// it before first paint and the server never sees it.

/** The single-user preferences row. Version 1 has no accounts. */
export const PREFERENCES_ID = 1;

async function storyExists(db: Db, storyId: number): Promise<boolean> {
  const [row] = await db.select({ id: stories.id }).from(stories).where(eq(stories.id, storyId));
  return Boolean(row);
}

async function requireStory(db: Db, storyId: number): Promise<void> {
  if (!(await storyExists(db, storyId))) {
    throw new ApiError("NOT_FOUND", `no story with id ${storyId}`);
  }
}

// ── Saved ────────────────────────────────────────────────────────────────────

export const saveBodySchema = z.object({
  note: z.string().max(2000).nullish(),
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
});

/**
 * Saving is idempotent: saving something already saved updates the note and
 * tags and succeeds. A second tap on a phone must not be an error.
 */
export async function saveStory(
  db: Db,
  storyId: number,
  input: z.infer<typeof saveBodySchema>,
): Promise<{ saved: true; storyId: number; note: string | null; tags: string[] }> {
  await requireStory(db, storyId);
  const note = input.note ?? null;
  const tags = input.tags ?? [];
  const [row] = await db
    .insert(savedItems)
    .values({ storyId, note, tags })
    .onConflictDoUpdate({
      target: savedItems.storyId,
      set: { note: sql`excluded.note`, tags: sql`excluded.tags` },
    })
    .returning({ note: savedItems.note, tags: savedItems.tags });
  return { saved: true, storyId, note: row.note, tags: row.tags };
}

/** Also idempotent: unsaving something that was never saved is a success. */
export async function unsaveStory(
  db: Db,
  storyId: number,
): Promise<{ saved: false; storyId: number }> {
  await requireStory(db, storyId);
  await db.delete(savedItems).where(eq(savedItems.storyId, storyId));
  return { saved: false, storyId };
}

export interface SavedCard extends StoryCard {
  note: string | null;
  tags: string[];
  savedAt: string;
}

export async function listSaved(
  db: Db,
  archived: boolean,
  limit: number,
): Promise<{ stories: SavedCard[]; nextCursor: null; hasMore: false }> {
  const rows = await db
    .select()
    .from(savedItems)
    .where(eq(savedItems.archived, archived))
    .orderBy(desc(savedItems.createdAt), desc(savedItems.id))
    .limit(limit);

  const ids = rows.map((r) => r.storyId);
  const storyRows = ids.length
    ? await db.select().from(stories).where(inArray(stories.id, ids))
    : [];
  const cards = await buildCards(db, storyRows);
  const byId = new Map(cards.map((c) => [c.id, c]));

  // Ordered by when it was saved, which is the order the saves came back in —
  // the story rows arrive in whatever order the database chose.
  const out: SavedCard[] = [];
  for (const saved of rows) {
    const card = byId.get(saved.storyId);
    if (!card) continue;
    out.push({
      ...card,
      note: saved.note,
      tags: saved.tags,
      savedAt: saved.createdAt.toISOString(),
    });
  }
  return { stories: out, nextCursor: null, hasMore: false };
}

// ── Read and hidden ──────────────────────────────────────────────────────────

/**
 * Read and hidden are separate facts about one story, kept in one row.
 *
 * Reading something does not hide it and hiding does not mark it read, so each
 * write must leave the other alone rather than reset it to a default.
 */
async function setReadState(
  db: Db,
  storyId: number,
  patch: { readAt?: Date | null; hidden?: boolean },
): Promise<{ readAt: Date | null; hidden: boolean }> {
  await requireStory(db, storyId);
  const [row] = await db
    .insert(readState)
    .values({
      storyId,
      readAt: patch.readAt ?? null,
      hidden: patch.hidden ?? false,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: readState.storyId,
      set: {
        ...(patch.readAt !== undefined ? { readAt: patch.readAt } : {}),
        ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
        updatedAt: new Date(),
      },
    })
    .returning({ readAt: readState.readAt, hidden: readState.hidden });
  return row;
}

export const readBodySchema = z.object({ read: z.boolean().optional() });
export const hideBodySchema = z.object({ hidden: z.boolean().optional() });

export async function markRead(db: Db, storyId: number, read: boolean, now: Date) {
  const row = await setReadState(db, storyId, { readAt: read ? now : null });
  return {
    storyId,
    read: row.readAt !== null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

export async function markHidden(db: Db, storyId: number, hidden: boolean) {
  const row = await setReadState(db, storyId, { hidden });
  return { storyId, hidden: row.hidden };
}

// ── Preferences ──────────────────────────────────────────────────────────────

export interface Preferences {
  topicKeys: string[];
  briefTime: string;
  timezone: string;
  notificationChannel: string;
  updatedAt: string;
}

export const preferencesPatchSchema = z
  .object({
    topicKeys: z.array(z.string().min(1)).max(100),
    briefTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "briefTime must be HH:MM"),
    timezone: z.string().min(1),
    notificationChannel: z.enum(NOTIFICATION_CHANNELS),
  })
  .partial()
  .strict();

const DEFAULTS = {
  topicKeys: [] as string[],
  briefTime: "07:30",
  timezone: "UTC",
  // `as const` because these columns are typed to their own value sets; a
  // widened string does not satisfy them.
  briefLength: "10" as const,
  notificationChannel: "none" as const,
  theme: "system",
  onboardedAt: null,
};

function serialise(row: typeof userPreferences.$inferSelect): Preferences {
  return {
    topicKeys: row.topicKeys,
    briefTime: row.briefTime,
    timezone: row.timezone,
    notificationChannel: row.notificationChannel,
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
  if (patch.topicKeys?.length) {
    const known = await db
      .select({ key: topics.key })
      .from(topics)
      .where(inArray(topics.key, patch.topicKeys));
    const found = new Set(known.map((k) => k.key));
    const missing = patch.topicKeys.filter((k) => !found.has(k));
    // A silently dropped key is a preference the reader believes they set.
    if (missing.length) {
      throw new ApiError("VALIDATION_ERROR", `unknown topic: ${missing.join(", ")}`);
    }
  }
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

export function parseStoryId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError("VALIDATION_ERROR", "storyId must be a positive whole number");
  }
  return id;
}
