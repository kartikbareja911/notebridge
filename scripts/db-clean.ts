import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { createDatabase } from "../src/db/client.js";
import { noteChunks, notes, toolCalls } from "../src/db/schema.js";

async function main() {
  const config = loadConfig();
  const { database, close } = createDatabase(config);

  console.log("Cleaning database for production deployment...");

  try {
    await database.delete(noteChunks);
    await database.delete(notes);
    await database.delete(toolCalls);
    console.log("✓ Successfully purged all notes, note_chunks, and tool_calls.");
    console.log("Database is clean and ready for production!");
  } catch (error) {
    console.error("Failed to clean database:", error);
    process.exitCode = 1;
  } finally {
    await close();
  }
}

void main();
