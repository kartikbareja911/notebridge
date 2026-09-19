import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AppConfig } from "../config.js";
import * as schema from "./schema.js";

const { Pool } = pg;

export function createDatabase(config: Pick<AppConfig, "DATABASE_URL">) {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
  });

  const database = drizzle(pool, { schema });

  return {
    database,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

export type Database = ReturnType<typeof createDatabase>["database"];
