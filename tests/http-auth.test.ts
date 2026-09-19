import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createNoteBridgeHttpServer } from "../src/http/server.js";
import { MemoryRateLimiter } from "../src/http/rate-limit.js";
import type { ApiKeyAuthenticator, AuthenticatedUser } from "../src/services/auth.js";
import { NotesService } from "../src/services/notes.js";
import { createMcpServer } from "../src/tools/register.js";
import {
  DeterministicEmbeddingProvider,
  InMemoryNoteRepository,
} from "./helpers/note-repository.js";

const userA: AuthenticatedUser = {
  id: "00000000-0000-4000-8000-000000000101",
  email: "a@notebridge.test",
};
const userB: AuthenticatedUser = {
  id: "00000000-0000-4000-8000-000000000202",
  email: "b@notebridge.test",
};

const openContexts: { close(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

async function createHttpTestContext(rateLimit = 60): Promise<{
  url: string;
  connectClient(token: string): Promise<Client>;
}> {
  const repository = new InMemoryNoteRepository();
  const notes = new NotesService(repository, new DeterministicEmbeddingProvider());
  const usersByToken = new Map<string, AuthenticatedUser>([
    ["token-user-a", userA],
    ["token-user-b", userB],
  ]);
  const authenticator: ApiKeyAuthenticator = {
    authenticate(rawKey: string): Promise<AuthenticatedUser | null> {
      return Promise.resolve(usersByToken.get(rawKey) ?? null);
    },
  };

  const logger = pino({ level: "silent" });
  const server = createNoteBridgeHttpServer({
    authenticate: authenticator,
    createServer: (user) =>
      createMcpServer({
        notes,
        userId: user.id,
        logger,
      }),
    logger,
    rateLimiter: new MemoryRateLimiter(rateLimit, 60_000),
  });
  const address = await server.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${address.port}/mcp`;
  const clients: Client[] = [];

  const context = {
    url,
    async connectClient(token: string): Promise<Client> {
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      });
      const client = new Client({
        name: `notebridge-test-${token}`,
        version: "1.0.0",
      });
      const transportAdapter: Transport = {
        start: () => transport.start(),
        send: (message, sendOptions) =>
          sendOptions ? transport.send(message, sendOptions) : transport.send(message),
        close: () => transport.close(),
      };
      transport.onmessage = (message) => transportAdapter.onmessage?.(message);
      transport.onerror = (error) => transportAdapter.onerror?.(error);
      transport.onclose = () => transportAdapter.onclose?.();
      clients.push(client);
      await client.connect(transportAdapter);
      return client;
    },
    async close(): Promise<void> {
      await Promise.all(clients.splice(0).map((client) => client.close()));
      await server.close();
    },
  };
  openContexts.push(context);
  return context;
}

function readStructured(result: unknown): Record<string, unknown> {
  if (typeof result !== "object" || result === null || !("structuredContent" in result)) {
    throw new Error("Expected structured tool output");
  }
  const structured = result.structuredContent;
  if (typeof structured !== "object" || structured === null) {
    throw new Error("Expected structured tool output object");
  }
  return structured as Record<string, unknown>;
}

describe("authenticated Streamable HTTP", () => {
  it("rejects unauthenticated requests before MCP handling", async () => {
    const context = await createHttpTestContext();
    const response = await fetch(context.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "unauthorized-test", version: "1.0.0" },
        },
      }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("isolates notes between authenticated users", async () => {
    const context = await createHttpTestContext();
    const clientA = await context.connectClient("token-user-a");
    const clientB = await context.connectClient("token-user-b");

    const created = readStructured(
      await clientA.callTool({
        name: "create_note",
        arguments: {
          title: "Private runway note",
          content: "Only user A should see the budget concerns and runway plan.",
          tags: ["private"],
        },
      }),
    );
    const createdNote = created.note;
    if (
      typeof createdNote !== "object" ||
      createdNote === null ||
      !("id" in createdNote)
    ) {
      throw new Error("Expected created note");
    }
    const noteId = createdNote.id;
    expect(noteId).toBeTypeOf("string");

    const userASearch = readStructured(
      await clientA.callTool({
        name: "search_notes",
        arguments: { query: "budget concerns", top_k: 5 },
      }),
    );
    expect(userASearch.count).toBe(1);

    const userBSearch = readStructured(
      await clientB.callTool({
        name: "search_notes",
        arguments: { query: "budget concerns", top_k: 5 },
      }),
    );
    expect(userBSearch.count).toBe(0);

    const userBFetch = readStructured(
      await clientB.callTool({
        name: "get_note",
        arguments: { id: noteId },
      }),
    );
    expect(userBFetch.note).toBeNull();
  });

  it("returns 429 after the endpoint rate limit is exceeded", async () => {
    const context = await createHttpTestContext(1);
    const headers = {
      Authorization: "Bearer token-user-a",
    };

    const first = await fetch(context.url, { method: "GET", headers });
    expect(first.status).toBe(400);

    const second = await fetch(context.url, { method: "GET", headers });
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTypeOf("string");
  });
});
