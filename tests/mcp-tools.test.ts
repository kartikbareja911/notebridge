import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NotesService } from "../src/services/notes.js";
import type { ToolCallRecord, ToolCallRecorder } from "../src/services/tool-calls.js";
import { createMcpServer } from "../src/tools/register.js";
import {
  DeterministicEmbeddingProvider,
  InMemoryNoteRepository,
} from "./helpers/note-repository.js";

const userId = "00000000-0000-4000-8000-000000000001";

async function createTestClient(toolCallRecorder?: ToolCallRecorder) {
  const notes = new NotesService(
    new InMemoryNoteRepository(),
    new DeterministicEmbeddingProvider(),
  );
  const server = createMcpServer({
    notes,
    userId,
    logger: pino({ level: "silent" }),
    ...(toolCallRecorder ? { toolCallRecorder } : {}),
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

const noteSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  content: z.string(),
});

const createdNoteSchema = z.object({ note: noteSchema });
const searchResultSchema = z.object({
  count: z.number(),
  results: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      snippet: z.string(),
      score: z.number(),
    }),
  ),
});
const listedNotesSchema = z.object({
  count: z.number(),
  notes: z.array(z.object({ id: z.uuid(), title: z.string() })),
});
const fetchedNoteSchema = z.object({
  note: noteSchema,
});

describe("NoteBridge MCP tools", () => {
  it("lists the expected core tools", async () => {
    const context = await createTestClient();
    try {
      const response = await context.client.listTools();
      expect(response.tools.map((tool) => tool.name)).toEqual([
        "search_notes",
        "get_note",
        "create_note",
        "list_notes",
      ]);
    } finally {
      await context.close();
    }
  });

  it("creates, searches, lists, and retrieves a note", async () => {
    const context = await createTestClient();
    try {
      const created = await context.client.callTool({
        name: "create_note",
        arguments: {
          title: "Runway Review",
          content: "We are worried about budget and runway for next quarter.",
          tags: ["finance", "planning"],
        },
      });
      const createdData = createdNoteSchema.parse(readStructured(created));
      const note = createdData.note;
      expect(note.title).toBe("Runway Review");

      const searched = await context.client.callTool({
        name: "search_notes",
        arguments: { query: "budget concerns", top_k: 5 },
      });
      const searchData = searchResultSchema.parse(readStructured(searched));
      expect(searchData.count).toBe(1);
      expect(searchData.results[0]?.id).toBe(note.id);
      expect(searchData.results[0]?.title).toBe("Runway Review");
      expect(searchData.results[0]?.snippet).toContain("runway");
      expect(searchData.results[0]?.score).toBeTypeOf("number");

      const listed = await context.client.callTool({
        name: "list_notes",
        arguments: { tag: "finance", limit: 10 },
      });
      const listData = listedNotesSchema.parse(readStructured(listed));
      expect(listData.count).toBe(1);
      expect(listData.notes[0]?.id).toBe(note.id);
      expect(listData.notes[0]?.title).toBe("Runway Review");

      const fetched = await context.client.callTool({
        name: "get_note",
        arguments: { id: note.id },
      });
      const fetchedData = fetchedNoteSchema.parse(readStructured(fetched));
      expect(fetchedData.note.id).toBe(note.id);
      expect(fetchedData.note.content).toContain("budget and runway");
    } finally {
      await context.close();
    }
  });

  it("returns a structured tool error for invalid input", async () => {
    const context = await createTestClient();
    try {
      const result = await context.client.callTool({
        name: "get_note",
        arguments: { id: "not-a-uuid" },
      });

      expect(result.isError).toBe(true);
      expect("content" in result).toBe(true);
      if ("content" in result) {
        const content = z.array(z.object({ type: z.string() })).parse(result.content);
        expect(content[0]).toMatchObject({ type: "text" });
      }
    } finally {
      await context.close();
    }
  });

  it("records tool metadata without persisting note content", async () => {
    const records: ToolCallRecord[] = [];
    const recorder: ToolCallRecorder = {
      record(call: ToolCallRecord): Promise<void> {
        records.push(call);
        return Promise.resolve();
      },
    };
    const context = await createTestClient(recorder);

    try {
      await context.client.callTool({
        name: "create_note",
        arguments: {
          title: "Sensitive title",
          content: "Sensitive note content that must not be logged.",
          tags: ["private"],
        },
      });

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        userId,
        toolName: "create_note",
        success: true,
      });
      expect(records[0]?.input).toEqual({
        title: "Sensitive title",
        tags: ["private"],
      });
      expect(records[0]?.latencyMs).toBeTypeOf("number");
    } finally {
      await context.close();
    }
  });
});
