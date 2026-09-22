#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { createNoteBridgeHttpServer } from "./http/server.js";
import { MemoryRateLimiter } from "./http/rate-limit.js";
import { createLogger } from "./logger.js";
import {
  DatabaseApiKeyAuthenticator,
  ensureUser,
  getLocalUser,
} from "./services/auth.js";
import { createEmbeddingProvider } from "./services/embedding.js";
import { DrizzleNoteRepository, NotesService } from "./services/notes.js";
import { DrizzleToolCallRecorder } from "./services/tool-calls.js";
import { createMcpServer } from "./tools/register.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const localUser = getLocalUser(config);
  const { database, close } = createDatabase(config);
  await ensureUser(database, localUser.id, "local@notebridge.test");

  const repository = new DrizzleNoteRepository(database);
  const notes = new NotesService(repository, createEmbeddingProvider(config));
  const toolCallRecorder = new DrizzleToolCallRecorder(database);
  const server = createNoteBridgeHttpServer({
    authenticate: new DatabaseApiKeyAuthenticator(database),
    createServer: (user) =>
      createMcpServer({
        notes,
        userId: user.id,
        logger,
        toolCallRecorder,
      }),
    logger,
    database,
    rateLimiter: new MemoryRateLimiter(
      config.RATE_LIMIT_MAX_REQUESTS,
      config.RATE_LIMIT_WINDOW_MS,
    ),
    maxBodyBytes: config.MAX_HTTP_BODY_BYTES,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "Shutting down NoteBridge HTTP server");
    await server.close();
    await close();
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT").finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => process.exit(0));
  });

  const address = await server.listen(config.PORT, config.HOST);
  logger.info(
    {
      host: config.HOST,
      port: address.port,
      path: "/mcp",
      transport: "streamable-http",
    },
    "NoteBridge MCP server listening",
  );
}

main().catch((error: unknown) => {
  console.error("NoteBridge HTTP server failed to start", error);
  process.exitCode = 1;
});
