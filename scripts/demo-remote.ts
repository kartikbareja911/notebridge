import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

async function main(): Promise<void> {
  const url = process.env.NOTEBRIDGE_REMOTE_URL ?? "http://127.0.0.1:3000/mcp";
  const apiKey = process.env.NOTEBRIDGE_REMOTE_API_KEY;
  if (!apiKey) {
    throw new Error("NOTEBRIDGE_REMOTE_API_KEY is required");
  }

  const unauthorized = await fetch(url, {
    method: "GET",
  });
  console.log(`1. Unauthenticated request rejected with HTTP ${unauthorized.status}`);

  const client = await connectClient(url, apiKey, "notebridge-remote-demo-a");
  const secondApiKey = process.env.NOTEBRIDGE_REMOTE_API_KEY_B;
  const secondClient = secondApiKey
    ? await connectClient(url, secondApiKey, "notebridge-remote-demo-b")
    : null;

  try {
    const tools = await client.listTools();
    console.log(`2. Remote tools: ${tools.tools.map((tool) => tool.name).join(", ")}`);

    const search = readStructured(
      await client.callTool({
        name: "search_notes",
        arguments: { query: "budget concerns", top_k: 3 },
      }),
    );
    const results = search.results;
    if (!Array.isArray(results)) {
      throw new Error("Expected search results array");
    }
    const first: unknown = results[0];
    const title = readOptionalString(first, "title") ?? "no result";
    console.log(`3. Remote semantic search -> ${title}`);

    const noteId = readOptionalString(first, "id");
    if (secondClient) {
      if (!noteId) {
        throw new Error("Expected an id for the first search result");
      }

      const secondSearch = readStructured(
        await secondClient.callTool({
          name: "search_notes",
          arguments: { query: "budget concerns", top_k: 3 },
        }),
      );
      if (secondSearch.count !== 0) {
        throw new Error("Tenant isolation failed: user B saw user A's search data");
      }

      const secondFetch = readStructured(
        await secondClient.callTool({
          name: "get_note",
          arguments: { id: noteId },
        }),
      );
      if (secondFetch.note !== null) {
        throw new Error("Tenant isolation failed: user B retrieved user A's note");
      }

      console.log(
        "4. Tenant isolation -> user B saw 0 search results and null retrieval",
      );
    }
  } finally {
    await secondClient?.close();
    await client.close();
  }
}

async function connectClient(url: string, apiKey: string, name: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  });
  const adapter: Transport = {
    start: () => transport.start(),
    send: (message, options) =>
      options ? transport.send(message, options) : transport.send(message),
    close: () => transport.close(),
  };
  transport.onmessage = (message) => adapter.onmessage?.(message);
  transport.onerror = (error) => adapter.onerror?.(error);
  transport.onclose = () => adapter.onclose?.();

  const client = new Client({
    name,
    version: "1.0.0",
  });
  await client.connect(adapter);
  return client;
}

function readStructured(result: unknown): Record<string, unknown> {
  if (typeof result !== "object" || result === null) {
    throw new Error("Expected an MCP tool result");
  }
  const record = result as Record<string, unknown>;
  if (record.isError) {
    throw new Error(`MCP tool failed: ${JSON.stringify(record)}`);
  }
  return readObject(record.structuredContent);
}

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object");
  }
  return value as Record<string, unknown>;
}

function readOptionalString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return null;
  }
  const item = value[key as keyof typeof value];
  return typeof item === "string" ? item : null;
}

main().catch((error: unknown) => {
  console.error("Remote demo failed", error);
  process.exitCode = 1;
});
