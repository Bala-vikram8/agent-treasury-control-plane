import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "../lib/db/client";

await migrate(getDb(), { migrationsFolder: "drizzle" });
await getPool().end();
console.log("Database migrations completed.");
