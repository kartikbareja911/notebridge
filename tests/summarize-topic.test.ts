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
    notes,
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

describe("summarize_topic & auto-tagging", () => {
  it("auto-tags a note when created without explicit tags", async () => {
    const { client, close } = await createTestClient();

    const response = await client.callTool({
      name: "create_note",
      arguments: {
        title: "Postgres Database Performance Optimization",
        content:
          "Detailed notes on database query tuning and index optimization for vector search.",
      },
    });

    const data = readStructured(response) as { note: { tags: string[] } };
    expect(data.note.tags).toContain("database");
    expect(data.note.tags).toContain("postgres");
    expect(data.note.tags).toContain("performance");

    await close();
  });

  it("summarizes a topic across created notes", async () => {
    const { client, close } = await createTestClient();

    await client.callTool({
      name: "create_note",
      arguments: {
        title: "Database Reliability",
        content:
          "Notes on postgres index optimization and high availability database architecture.",
        tags: ["database", "reliability"],
      },
    });

    const response = await client.callTool({
      name: "summarize_topic",
      arguments: {
        topic: "database architecture",
        top_k: 5,
      },
    });

    const data = readStructured(response) as {
      summary: {
        topic: string;
        count: number;
        summary: string;
        sources: { title: string }[];
      };
    };

    expect(data.summary.topic).toBe("database architecture");
    expect(data.summary.count).toBeGreaterThan(0);
    expect(data.summary.summary).toContain("Database Reliability");

    await close();
  });
});
