import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

const globalDatabase = globalThis as unknown as {
  treasuryPool?: Pool;
  treasuryDb?: Database;
};

export function getPool() {
  if (!globalDatabase.treasuryPool) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured");
    }

    globalDatabase.treasuryPool = new Pool({
      connectionString,
      max: 10,
      ssl:
        process.env.DATABASE_SSL === "true"
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }

  return globalDatabase.treasuryPool;
}

export function getDb() {
  if (!globalDatabase.treasuryDb) {
    globalDatabase.treasuryDb = drizzle(getPool(), { schema });
  }

  return globalDatabase.treasuryDb;
}
