import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { NotesService } from "../src/services/notes.js";
import { createMcpServer } from "../src/tools/register.js";
import {
  DeterministicEmbeddingProvider,
  InMemoryNoteRepository,
} from "./helpers/note-repository.js";

const userId = "00000000-0000-4000-8000-000000000001";

async function createTestClient() {
  const notes = new NotesService(
    new InMemoryNoteRepository(),
    new DeterministicEmbeddingProvider(),
  );
  const server = createMcpServer({
    notes,
    userId,
    logger: pino({ level: "silent" }),
  });
  const client = new Client({ name: "notebridge-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function readStructured(result: unknown): unknown {
  if (typeof result !== "object" || result === null) {
    throw new Error("Expected a tool result object");
  }
  const structured = "structuredContent" in result ? result.structuredContent : undefined;
  expect(structured).toBeTypeOf("object");
  expect(structured).not.toBeNull();
  return structured;
}

describe("Direct file & PDF parsing in ingest_document", () => {
  it("ingests a local Markdown document by file_path", async () => {
    const { client, close } = await createTestClient();

    const response = await client.callTool({
      name: "ingest_document",
      arguments: {
        file_path: "README.md",
      },
    });

    const data = readStructured(response) as {
      note: { id: string; title: string; source: string; content: string };
    };

    expect(data.note.title).toBe("README");
    expect(data.note.source).toBe("markdown");
    expect(data.note.content).toContain("NoteBridge");

    await close();
  });
});
