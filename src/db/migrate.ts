import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadConfig } from "../config.js";
import { createDatabase } from "./client.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { database, close } = createDatabase(config);

  try {
    await migrate(database, { migrationsFolder: "./drizzle" });
    console.error("Database migrations completed");
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("Database migration failed", error);
  process.exitCode = 1;
});
