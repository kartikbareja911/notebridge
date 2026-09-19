import { z } from "zod";

const uuidDescription = "UUID of the note returned by search_notes or list_notes.";

export const searchNotesInputShape = {
  query: z
    .string()
    .trim()
    .min(1)
    .max(2_000)
    .describe(
      "Natural-language description of the information the user wants to recall.",
    ),
  top_k: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Maximum number of relevant note chunks to return. Defaults to 5."),
};

export const getNoteInputShape = {
  id: z.uuid().describe(uuidDescription),
};

export const createNoteInputShape = {
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("Short descriptive title for the new note."),
  content: z
    .string()
    .trim()
    .min(1)
    .max(1_000_000)
    .describe("Complete note content to save and make searchable."),
  tags: z
    .array(z.string().trim().min(1).max(50))
    .max(20)
    .optional()
    .describe("Optional lowercase labels used to organize and filter the note."),
};

export const listNotesInputShape = {
  tag: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .optional()
    .describe("Optional tag that a note must contain."),
  created_after: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("Optional ISO 8601 timestamp; only newer notes are returned."),
  created_before: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("Optional ISO 8601 timestamp; only older notes are returned."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Maximum number of notes to return. Defaults to 50."),
};

export const searchNotesSchema = z.object(searchNotesInputShape).strict();
export const getNoteSchema = z.object(getNoteInputShape).strict();
export const createNoteSchema = z.object(createNoteInputShape).strict();
export const listNotesSchema = z.object(listNotesInputShape).strict();

export function getToolCatalog() {
  return [
    {
      name: "search_notes",
      title: "Search Notes",
      description:
        "Use this when the user asks about something they may have written down previously or asks you to recall information from their notes. Searches note content by meaning, not just matching keywords, and returns the most relevant chunks.",
      inputSchema: z.toJSONSchema(searchNotesSchema, { target: "draft-7" }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "get_note",
      title: "Get Note",
      description:
        "Use this after search_notes or list_notes when the user needs the complete original content of one note rather than only matching snippets.",
      inputSchema: z.toJSONSchema(getNoteSchema, { target: "draft-7" }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "create_note",
      title: "Create Note",
      description:
        "Use this when the user asks you to save, capture, or remember information as a new note. The note is persisted and immediately becomes available to semantic search.",
      inputSchema: z.toJSONSchema(createNoteSchema, { target: "draft-7" }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    {
      name: "list_notes",
      title: "List Notes",
      description:
        "Use this when the user wants to browse recent notes or filter notes by tag or creation date. This lists note metadata; use get_note when full content is needed.",
      inputSchema: z.toJSONSchema(listNotesSchema, { target: "draft-7" }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ] as const;
}
