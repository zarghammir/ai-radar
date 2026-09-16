import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and edit it.");
}

// Reuse the connection across hot reloads in development.
const globalForDb = globalThis as unknown as { __aiRadarSql?: ReturnType<typeof postgres> };
const sql =
  globalForDb.__aiRadarSql ??
  postgres(connectionString, { max: 10, prepare: false, onnotice: () => {} });
if (process.env.NODE_ENV !== "production") globalForDb.__aiRadarSql = sql;

export const db = drizzle(sql, { schema });
export type Db = typeof db;
export { schema };
