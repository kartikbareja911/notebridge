import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { createDatabase } from "../src/db/client.js";
import { createEmbeddingProvider } from "../src/services/embedding.js";
import { DrizzleNoteRepository, NotesService } from "../src/services/notes.js";
import { parsePdfFile } from "../src/services/pdf.js";

async function main() {
  const filePath = process.argv.slice(2).join(" ").trim();
  if (!filePath) {
    console.error("Please provide a file path to ingest.");
    process.exit(1);
  }

  const config = loadConfig();
  const { database, close } = createDatabase(config);

  console.log(`Parsing PDF file: ${filePath}`);
  const pdfResult = await parsePdfFile(filePath);
  console.log(
    `Extracted ${pdfResult.text.length} characters from PDF (${pdfResult.numpages} pages).`,
  );

  const basename = filePath.split(/[/\\]/).pop() ?? "Ingested Document";
  const title = basename.replace(/\.[^/.]+$/, "");

  const repository = new DrizzleNoteRepository(database);
  const embeddings = createEmbeddingProvider(config);
  const notesService = new NotesService(repository, embeddings);

  const note = await notesService.createNote(config.NOTEBRIDGE_USER_ID, {
    title,
    content: pdfResult.text.trim(),
    source: "pdf",
  });

  console.log("✓ PDF Note successfully created & vector-indexed!");
  console.log(`ID: ${note.id}`);
  console.log(`Title: ${note.title}`);
  console.log(`Tags: ${note.tags.join(", ")}`);
  console.log(`Created At: ${note.createdAt}`);

  await close();
}

void main();
