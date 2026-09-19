#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { createLogger } from "./logger.js";
import { ensureUser, getLocalUser } from "./services/auth.js";
import { createEmbeddingProvider } from "./services/embedding.js";
import { DrizzleNoteRepository, NotesService } from "./services/notes.js";
import { DrizzleToolCallRecorder } from "./services/tool-calls.js";
import { createMcpServer } from "./tools/register.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const user = getLocalUser(config);
  const { database, close } = createDatabase(config);
  await ensureUser(database, user.id);
  const repository = new DrizzleNoteRepository(database);
  const notes = new NotesService(repository, createEmbeddingProvider(config));
  const server = createMcpServer({
    notes,
    userId: user.id,
    logger,
    toolCallRecorder: new DrizzleToolCallRecorder(database),
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "Shutting down NoteBridge");
    await server.close();
    await close();
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT").finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => process.exit(0));
  });

  await server.connect(new StdioServerTransport());
  logger.info("NoteBridge MCP server connected over stdio");
}

main().catch((error: unknown) => {
  console.error("NoteBridge failed to start", error);
  process.exitCode = 1;
});
