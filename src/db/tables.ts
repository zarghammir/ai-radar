import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Every table in the schema, read off the schema module's own exports.
 *
 * Genuinely derived: a table is covered the moment it is declared, with no
 * edit here or anywhere else. That matters because a hand-written list is a
 * list someone forgets to extend — three test files each carried their own
 * truncate list and each had missed a different table, which produces the
 * order-dependent kind of failure that surfaces later as a flake.
 *
 * Writing this out by hand a second time would have been the same defect in a
 * new place, which is what the first attempt at this actually was.
 */
export const ALL_TABLE_NAMES: string[] = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => getTableName(table))
  .sort();

/** Every table, emptied, for a test that wants a clean slate. */
export const TRUNCATE_ALL = `TRUNCATE ${ALL_TABLE_NAMES.map((n) => `"${n}"`).join(", ")} RESTART IDENTITY CASCADE`;
