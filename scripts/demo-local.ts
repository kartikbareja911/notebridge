import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

async function main(): Promise<void> {
  const serverPath = join(process.cwd(), "dist", "server.js");
  if (!existsSync(serverPath)) {
    throw new Error(`dist/server.js not found — run \`npm run build\` first`);
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/server.js"],
    cwd: process.cwd(),
    env: readEnvironment(),
    stderr: "pipe",
  });
  const adapter: Transport = {
    start: () => transport.start(),
    send: (message) => transport.send(message),
    close: () => transport.close(),
  };
  transport.onmessage = (message) => adapter.onmessage?.(message);
  transport.onerror = (error) => adapter.onerror?.(error);
  transport.onclose = () => adapter.onclose?.();
  transport.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

  const client = new Client({
    name: "notebridge-local-demo",
    version: "1.0.0",
  });
  await client.connect(adapter);

  try {
    console.log("NoteBridge local stdio demo");
    const tools = await client.listTools();
    console.log(`1. Connected tools: ${tools.tools.map((tool) => tool.name).join(", ")}`);

    const search = readStructured(
      await client.callTool({
        name: "search_notes",
        arguments: { query: "budget concerns", top_k: 3 },
      }),
    );
    const results = readArray(search, "results");
    const first = readObject(results[0] ?? null);
    console.log(
      `2. Semantic search "budget concerns" -> ${readString(first, "title")} (score ${readNumber(first, "score").toFixed(3)})`,
    );

    const noteId = readString(first, "id");
    const fetched = readStructured(
      await client.callTool({
        name: "get_note",
        arguments: { id: noteId },
      }),
    );
    const note = readObject(fetched.note);
    console.log(`3. Retrieved "${readString(note, "title")}" by id`);

    const marker = `demo-${Date.now()}`;
    const created = readStructured(
      await client.callTool({
        name: "create_note",
        arguments: {
          title: "NoteBridge Demo Capture",
          content: `This note proves create-and-search works. Marker ${marker}.`,
          tags: ["demo", "notebridge"],
        },
      }),
    );
    const createdNote = readObject(created.note);
    console.log(`4. Created note ${readString(createdNote, "id")}`);

    const verification = readStructured(
      await client.callTool({
        name: "search_notes",
        arguments: { query: marker, top_k: 3 },
      }),
    );
    const verificationTitle = readString(
      readObject(readArray(verification, "results")[0] ?? null),
      "title",
    );
    console.log(`5. Immediately searchable -> ${verificationTitle}`);

    const listed = readStructured(
      await client.callTool({
        name: "list_notes",
        arguments: { tag: "demo", limit: 5 },
      }),
    );
    console.log(`6. Notes tagged "demo": ${readNumber(listed, "count")}`);
  } finally {
    await client.close();
  }
}

function readEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function readStructured(result: unknown): Record<string, unknown> {
  const record = readObject(result);
  if (result && typeof result === "object" && "isError" in result && result.isError) {
    throw new Error(`MCP tool failed: ${JSON.stringify(record)}`);
  }
  const structured = record.structuredContent;
  return readObject(structured);
}

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object in the demo output");
  }
  return value as Record<string, unknown>;
}

function readArray(value: Record<string, unknown>, key: string): unknown[] {
  const item = value[key];
  if (!Array.isArray(item)) {
    throw new Error(`Expected ${key} to be an array`);
  }
  return item;
}

function readString(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  if (typeof item !== "string") {
    throw new Error(`Expected ${key} to be a string`);
  }
  return item;
}

function readNumber(value: Record<string, unknown>, key: string): number {
  const item = value[key];
  if (typeof item !== "number") {
    throw new Error(`Expected ${key} to be a number`);
  }
  return item;
}

main().catch((error: unknown) => {
  console.error("Local demo failed", error);
  process.exitCode = 1;
});
