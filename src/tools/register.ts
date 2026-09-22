import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "pino";
import type { NotesService } from "../services/notes.js";
import type { ToolCallRecorder } from "../services/tool-calls.js";
import {
  createNoteInputShape,
  deleteNoteInputShape,
  getNoteInputShape,
  ingestDocumentInputShape,
  listNotesInputShape,
  searchNotesInputShape,
  summarizeTopicInputShape,
} from "./definitions.js";

interface ToolDependencies {
  notes: NotesService;
  userId: string;
  logger: Logger;
  toolCallRecorder?: ToolCallRecorder;
}

export function createMcpServer(dependencies: ToolDependencies): McpServer {
  const server = new McpServer(
    { name: "notebridge", version: "0.1.0" },
    {
      instructions:
        "Use NoteBridge tools when the user's request depends on their personal notes. Prefer search_notes before get_note, and use create_note only when the user asks to save information.",
    },
  );

  server.registerTool(
    "search_notes",
    {
      title: "Search Notes",
      description:
        "Use this when the user asks about something they may have written down previously or asks you to recall information from their notes. Searches note content by meaning, not just matching keywords, and returns the most relevant chunks.",
      inputSchema: searchNotesInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, top_k }): Promise<CallToolResult> =>
      executeTool(dependencies, "search_notes", { query, top_k }, async () => {
        const results = await dependencies.notes.searchNotes(
          dependencies.userId,
          query,
          top_k,
        );
        return { results, count: results.length };
      }),
  );

  server.registerTool(
    "get_note",
    {
      title: "Get Note",
      description:
        "Use this after search_notes or list_notes when the user needs the complete original content of one note rather than only matching snippets.",
      inputSchema: getNoteInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }): Promise<CallToolResult> =>
      executeTool(dependencies, "get_note", { id }, async () => ({
        note: await dependencies.notes.getNote(dependencies.userId, id),
      })),
  );

  server.registerTool(
    "create_note",
    {
      title: "Create Note",
      description:
        "Use this when the user asks you to save, capture, or remember information as a new note. The note is persisted and immediately becomes available to semantic search.",
      inputSchema: createNoteInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ title, content, tags }): Promise<CallToolResult> =>
      executeTool(dependencies, "create_note", { title, tags }, async () => ({
        note: await dependencies.notes.createNote(dependencies.userId, {
          title,
          content,
          ...(tags ? { tags } : {}),
        }),
      })),
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete Note",
      description:
        "Use this when the user asks to delete or remove a note from their knowledge base by its unique note ID.",
      inputSchema: deleteNoteInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }): Promise<CallToolResult> =>
      executeTool(dependencies, "delete_note", { id }, async () => {
        const deleted = await dependencies.notes.deleteNote(dependencies.userId, id);
        return { deleted, id };
      }),
  );

  server.registerTool(
    "list_notes",
    {
      title: "List Notes",
      description:
        "Use this when the user wants to browse recent notes or filter notes by tag or creation date. This lists note metadata; use get_note when full content is needed.",
      inputSchema: listNotesInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ tag, created_after, created_before, limit }): Promise<CallToolResult> =>
      executeTool(
        dependencies,
        "list_notes",
        { tag, created_after, created_before, limit },
        async () => {
          const notes = await dependencies.notes.listNotes(dependencies.userId, {
            ...(tag ? { tag } : {}),
            ...(created_after ? { createdAfter: new Date(created_after) } : {}),
            ...(created_before ? { createdBefore: new Date(created_before) } : {}),
            limit,
          });
          return { notes, count: notes.length };
        },
      ),
  );

  server.registerTool(
    "summarize_topic",
    {
      title: "Summarize Topic",
      description:
        "Use this when the user asks to summarize, synthesize, or digest all notes related to a specific topic or theme.",
      inputSchema: summarizeTopicInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ topic, top_k }): Promise<CallToolResult> =>
      executeTool(dependencies, "summarize_topic", { topic, top_k }, async () => {
        const summary = await dependencies.notes.summarizeTopic(
          dependencies.userId,
          topic,
          top_k,
        );
        return { summary };
      }),
  );

  server.registerTool(
    "ingest_document",
    {
      title: "Ingest Document",
      description:
        "Use this when the user provides plain text, Markdown content, or a file_path to a PDF/Markdown file to ingest, chunk, auto-tag, and index into the knowledge base.",
      inputSchema: ingestDocumentInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      title,
      document_content,
      file_path,
      source,
      tags,
    }): Promise<CallToolResult> =>
      executeTool(
        dependencies,
        "ingest_document",
        { title, file_path, source, tags },
        async () => {
          let content = document_content ?? "";
          let detectedSource = source;
          let docTitle = title;

          if (file_path) {
            const normalizedPath = file_path.trim();
            const basename = normalizedPath.split(/[/\\]/).at(-1) ?? "Ingested Document";
            docTitle ??= basename.replace(/\.[^/.]+$/, "");

            if (normalizedPath.toLowerCase().endsWith(".pdf")) {
              const { parsePdfFile } = await import("../services/pdf.js");
              const parsedPdf = await parsePdfFile(normalizedPath);
              content = parsedPdf.text;
              detectedSource = "pdf";
            } else {
              const { readFile } = await import("node:fs/promises");
              content = await readFile(normalizedPath, "utf8");
              if (normalizedPath.toLowerCase().endsWith(".md")) {
                detectedSource = "markdown";
              }
            }
          }

          docTitle ??= "Ingested Document";

          if (content.trim().length === 0) {
            throw new Error("No readable text content found in document or file.");
          }

          return {
            note: await dependencies.notes.createNote(dependencies.userId, {
              title: docTitle,
              content: content.trim(),
              source: detectedSource,
              ...(tags ? { tags } : {}),
            }),
          };
        },
      ),
  );

  return server;
}

async function executeTool(
  dependencies: ToolDependencies,
  toolName: string,
  input: Record<string, unknown>,
  operation: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  const startedAt = performance.now();
  const sanitizedInput = sanitizeToolInput(input);

  try {
    const output = await operation();
    const latencyMs = Math.round(performance.now() - startedAt);
    dependencies.logger.info(
      {
        toolName,
        input: sanitizedInput,
        latencyMs,
        success: true,
      },
      "MCP tool call completed",
    );
    await recordToolCall(dependencies, {
      toolName,
      input: sanitizedInput,
      latencyMs,
      success: true,
    });

    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown tool error";
    const latencyMs = Math.round(performance.now() - startedAt);
    dependencies.logger.error(
      {
        toolName,
        input: sanitizedInput,
        latencyMs,
        success: false,
        error: message,
      },
      "MCP tool call failed",
    );
    await recordToolCall(dependencies, {
      toolName,
      input: sanitizedInput,
      latencyMs,
      success: false,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: { code: "TOOL_ERROR", message } }, null, 2),
        },
      ],
      structuredContent: { error: { code: "TOOL_ERROR", message } },
      isError: true,
    };
  }
}

async function recordToolCall(
  dependencies: ToolDependencies,
  call: {
    toolName: string;
    input: Record<string, unknown>;
    latencyMs: number;
    success: boolean;
  },
): Promise<void> {
  if (!dependencies.toolCallRecorder) {
    return;
  }

  try {
    await dependencies.toolCallRecorder.record({
      userId: dependencies.userId,
      ...call,
    });
  } catch (error: unknown) {
    dependencies.logger.error(
      {
        toolName: call.toolName,
        error: error instanceof Error ? error.message : "Unknown logging error",
      },
      "Failed to persist MCP tool call",
    );
  }
}

function sanitizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => key !== "content" && value !== undefined,
    ),
  );
}
