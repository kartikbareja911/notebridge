import { and, arrayContains, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { noteChunks, notes } from "../db/schema.js";
import { chunkText } from "./chunking.js";
import type { EmbeddingProvider } from "./embedding.js";

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 1_000_000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

export interface CreateNoteInput {
  title: string;
  content: string;
  tags?: string[];
  source?: string;
}

export interface ChunkEmbeddingInput {
  title: string;
  tags: string[];
  content: string;
}

export interface ListNotesFilter {
  tag?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
}

export interface NoteSummary {
  id: string;
  title: string;
  tags: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDetail extends NoteSummary {
  content: string;
}

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  score: number;
  tags: string[];
  source: string;
  chunkIndex: number;
}

export interface TopicSummary {
  topic: string;
  summary: string;
  sources: {
    id: string;
    title: string;
    snippet: string;
    score: number;
  }[];
  count: number;
}

export interface NoteRepository {
  searchNotes(userId: string, embedding: number[], topK: number): Promise<SearchResult[]>;
  getNote(userId: string, id: string): Promise<NoteDetail | null>;
  createNote(
    userId: string,
    input: Required<Pick<CreateNoteInput, "title" | "content" | "source">> & {
      tags: string[];
    },
    chunks: { content: string; embedding: number[] }[],
  ): Promise<NoteDetail>;
  deleteNote(userId: string, id: string): Promise<boolean>;
  listNotes(userId: string, filter: ListNotesFilter): Promise<NoteSummary[]>;
}

export function createChunkEmbeddingText(input: ChunkEmbeddingInput): string {
  const tags = input.tags.length > 0 ? input.tags.join(", ") : "none";
  return [`Title: ${input.title}`, `Tags: ${tags}`, `Content: ${input.content}`].join(
    "\n",
  );
}

const rawSearchRowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  tags: z.array(z.string()),
  source: z.string(),
  snippet: z.string(),
  chunkIndex: z.coerce.number().int(),
  score: z.coerce.number(),
});

export class DrizzleNoteRepository implements NoteRepository {
  constructor(private readonly database: Database) {}

  async searchNotes(
    userId: string,
    embedding: number[],
    topK: number,
  ): Promise<SearchResult[]> {
    const vectorLiteral = `[${embedding.join(",")}]`;
    const result = await this.database.execute(sql`
      SELECT
        n.id,
        n.title,
        n.tags,
        n.source,
        c.content AS snippet,
        c.chunk_index AS "chunkIndex",
        1 - (c.embedding <=> ${vectorLiteral}::vector) AS score
      FROM note_chunks c
      INNER JOIN notes n ON n.id = c.note_id
      WHERE n.user_id = ${userId}
      ORDER BY c.embedding <=> ${vectorLiteral}::vector
      LIMIT ${topK}
    `);

    return result.rows.map((row) => rawSearchRowSchema.parse(row));
  }

  async getNote(userId: string, id: string): Promise<NoteDetail | null> {
    const [note] = await this.database
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, userId)))
      .limit(1);

    return note ? toNoteDetail(note) : null;
  }

  async createNote(
    userId: string,
    input: Required<Pick<CreateNoteInput, "title" | "content" | "source">> & {
      tags: string[];
    },
    chunks: { content: string; embedding: number[] }[],
  ): Promise<NoteDetail> {
    return this.database.transaction(async (transaction) => {
      const [note] = await transaction
        .insert(notes)
        .values({
          userId,
          title: input.title,
          content: input.content,
          tags: input.tags,
          source: input.source,
        })
        .returning();

      if (!note) {
        throw new Error("Failed to create note");
      }

      if (chunks.length > 0) {
        await transaction.insert(noteChunks).values(
          chunks.map((chunk, index) => ({
            noteId: note.id,
            chunkIndex: index,
            content: chunk.content,
            embedding: chunk.embedding,
          })),
        );
      }

      return toNoteDetail(note);
    });
  }

  async deleteNote(userId: string, id: string): Promise<boolean> {
    const deleted = await this.database
      .delete(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, userId)))
      .returning({ id: notes.id });
    return deleted.length > 0;
  }

  async listNotes(userId: string, filter: ListNotesFilter): Promise<NoteSummary[]> {
    const conditions = [eq(notes.userId, userId)];

    if (filter.tag) {
      conditions.push(arrayContains(notes.tags, [filter.tag]));
    }
    if (filter.createdAfter) {
      conditions.push(gte(notes.createdAt, filter.createdAfter));
    }
    if (filter.createdBefore) {
      conditions.push(lte(notes.createdAt, filter.createdBefore));
    }

    const rows = await this.database
      .select({
        id: notes.id,
        title: notes.title,
        tags: notes.tags,
        source: notes.source,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .where(and(...conditions))
      .orderBy(desc(notes.createdAt))
      .limit(filter.limit ?? 50);

    return rows.map(toNoteSummary);
  }
}

export class NotesService {
  constructor(
    private readonly repository: NoteRepository,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async searchNotes(userId: string, query: string, topK = 5): Promise<SearchResult[]> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      throw new Error("Search query cannot be empty");
    }

    const embedding = await this.embeddings.embedQuery(normalizedQuery);
    return this.repository.searchNotes(userId, embedding, topK);
  }

  async getNote(userId: string, id: string): Promise<NoteDetail | null> {
    return this.repository.getNote(userId, id);
  }

  async createNote(userId: string, input: CreateNoteInput): Promise<NoteDetail> {
    const title = input.title.trim();
    const content = input.content.trim();
    let tags = normalizeTags(input.tags ?? []);
    if (tags.length === 0) {
      tags = inferAutoTags(title, content);
    }

    if (title.length === 0) {
      throw new Error("Note title cannot be empty");
    }
    if (title.length > MAX_TITLE_LENGTH) {
      throw new Error(`Note title cannot exceed ${MAX_TITLE_LENGTH} characters`);
    }
    if (content.length === 0) {
      throw new Error("Note content cannot be empty");
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new Error(`Note content cannot exceed ${MAX_CONTENT_LENGTH} characters`);
    }

    const chunks = chunkText(content);
    const embeddings = await this.embeddings.embedTexts(
      chunks.map((chunk) =>
        createChunkEmbeddingText({
          title,
          tags,
          content: chunk,
        }),
      ),
    );
    const chunksWithEmbeddings = chunks.map((chunk, index) => {
      const embedding = embeddings[index];
      if (!embedding) {
        throw new Error(`Embedding missing for chunk ${index}`);
      }
      return { content: chunk, embedding };
    });

    return this.repository.createNote(
      userId,
      {
        title,
        content,
        tags,
        source: input.source ?? "manual",
      },
      chunksWithEmbeddings,
    );
  }

  async deleteNote(userId: string, id: string): Promise<boolean> {
    return this.repository.deleteNote(userId, id);
  }

  async listNotes(userId: string, filter: ListNotesFilter = {}): Promise<NoteSummary[]> {
    return this.repository.listNotes(userId, {
      ...filter,
      limit: Math.min(Math.max(filter.limit ?? 50, 1), 100),
    });
  }

  async summarizeTopic(userId: string, topic: string, topK = 5): Promise<TopicSummary> {
    const results = await this.searchNotes(userId, topic, topK);

    if (results.length === 0) {
      return {
        topic,
        summary: `No relevant notes found for topic "${topic}".`,
        sources: [],
        count: 0,
      };
    }

    const sources = results.map((r) => ({
      id: r.id,
      title: r.title,
      snippet: r.snippet,
      score: r.score,
    }));

    const keyTopics = results.map((r) => `- **${r.title}**: ${r.snippet}`).join("\n");
    const summary = `Found ${results.length} relevant note(s) regarding "${topic}":\n\n${keyTopics}`;

    return {
      topic,
      summary,
      sources,
      count: results.length,
    };
  }
}

function inferAutoTags(title: string, content: string): string[] {
  const text = `${title} ${content}`.toLowerCase();
  const keywords = [
    "ai",
    "api",
    "architecture",
    "budget",
    "career",
    "database",
    "demo",
    "design",
    "engineering",
    "finance",
    "learning",
    "meetings",
    "mcp",
    "performance",
    "postgres",
    "product",
    "reliability",
    "retrieval",
    "search",
    "security",
    "testing",
    "vector",
    "workflow",
  ];
  return keywords.filter((word) => text.includes(word)).slice(0, 5);
}

function normalizeTags(tags: string[]): string[] {
  const normalized = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  if (normalized.length > MAX_TAGS) {
    throw new Error(`A note cannot have more than ${MAX_TAGS} tags`);
  }
  if (normalized.some((tag) => tag.length > MAX_TAG_LENGTH)) {
    throw new Error(`Tags cannot exceed ${MAX_TAG_LENGTH} characters`);
  }
  return normalized;
}

function toNoteSummary(note: {
  id: string;
  title: string;
  tags: string[];
  source: string;
  createdAt: Date;
  updatedAt: Date;
}): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    tags: note.tags,
    source: note.source,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

function toNoteDetail(note: {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source: string;
  createdAt: Date;
  updatedAt: Date;
}): NoteDetail {
  return {
    ...toNoteSummary(note),
    content: note.content,
  };
}
