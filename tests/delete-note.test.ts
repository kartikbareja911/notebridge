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

describe("delete_note tool", () => {
  it("deletes a note by id", async () => {
    const { client, close } = await createTestClient();

    const createResponse = await client.callTool({
      name: "create_note",
      arguments: {
        title: "Temporary Note",
        content: "This note will be deleted.",
      },
    });

    const createData = readStructured(createResponse) as { note: { id: string } };
    const noteId = createData.note.id;

    const deleteResponse = await client.callTool({
      name: "delete_note",
      arguments: { id: noteId },
    });

    const deleteData = readStructured(deleteResponse) as { deleted: boolean; id: string };
    expect(deleteData.deleted).toBe(true);
    expect(deleteData.id).toBe(noteId);

    await close();
  });
});
