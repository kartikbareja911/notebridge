import "dotenv/config";
import { eq, ilike } from "drizzle-orm";
import { loadConfig } from "../src/config.js";
import { createDatabase } from "../src/db/client.js";
import { notes } from "../src/db/schema.js";

async function main() {
  const target = process.argv.slice(2).join(" ").trim();
  if (!target) {
    console.error("Please provide a note ID or title snippet to delete.");
    process.exit(1);
  }

  const config = loadConfig();
  const { database, close } = createDatabase(config);

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    target,
  );
  const condition = isUuid ? eq(notes.id, target) : ilike(notes.title, `%${target}%`);

  const deleted = await database
    .delete(notes)
    .where(condition)
    .returning({ id: notes.id, title: notes.title });

  if (deleted.length === 0) {
    console.log(`No matching notes found for "${target}".`);
  } else {
    for (const item of deleted) {
      console.log(`✓ Deleted note: "${item.title}" (ID: ${item.id})`);
    }
  }

  await close();
}

void main();
