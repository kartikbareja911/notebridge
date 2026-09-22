import { randomUUID } from "node:crypto";
import type { EmbeddingProvider } from "../../src/services/embedding.js";
import type {
  CreateNoteInput,
  ListNotesFilter,
  NoteDetail,
  NoteRepository,
  NoteSummary,
  SearchResult,
} from "../../src/services/notes.js";

interface StoredNote extends NoteDetail {
  userId: string;
}

interface StoredChunk {
  noteId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
}

export class InMemoryNoteRepository implements NoteRepository {
  private readonly notes = new Map<string, StoredNote>();
  private readonly chunks: StoredChunk[] = [];

  searchNotes(
    userId: string,
    embedding: number[],
    topK: number,
  ): Promise<SearchResult[]> {
    const results = this.chunks
      .flatMap((chunk) => {
        const note = this.notes.get(chunk.noteId);
        if (note?.userId !== userId) {
          return [];
        }
        return [
          {
            id: note.id,
            title: note.title,
            snippet: chunk.content,
            score: cosineSimilarity(embedding, chunk.embedding),
            tags: note.tags,
            source: note.source,
            chunkIndex: chunk.chunkIndex,
          },
        ];
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, topK);
    return Promise.resolve(results);
  }

  getNote(userId: string, id: string): Promise<NoteDetail | null> {
    const note = this.notes.get(id);
    if (note?.userId !== userId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(toDetail(note));
  }

  deleteNote(userId: string, id: string): Promise<boolean> {
    const note = this.notes.get(id);
    if (note?.userId !== userId) {
      return Promise.resolve(false);
    }
    this.notes.delete(id);
    for (let index = this.chunks.length - 1; index >= 0; index -= 1) {
      const chunk = this.chunks[index];
      if (chunk?.noteId === id) {
        this.chunks.splice(index, 1);
      }
    }
    return Promise.resolve(true);
  }

  createNote(
    userId: string,
    input: Required<Pick<CreateNoteInput, "title" | "content" | "source">> & {
      tags: string[];
    },
    chunks: { content: string; embedding: number[] }[],
  ): Promise<NoteDetail> {
    const now = new Date();
    const note: StoredNote = {
      id: randomUUID(),
      userId,
      title: input.title,
      content: input.content,
      tags: input.tags,
      source: input.source,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.notes.set(note.id, note);
    this.chunks.push(
      ...chunks.map((chunk, index) => ({
        noteId: note.id,
        chunkIndex: index,
        content: chunk.content,
        embedding: chunk.embedding,
      })),
    );
    return Promise.resolve(toDetail(note));
  }

  listNotes(userId: string, filter: ListNotesFilter): Promise<NoteSummary[]> {
    const results = [...this.notes.values()]
      .filter((note) => note.userId === userId)
      .filter((note) => !filter.tag || note.tags.includes(filter.tag))
      .filter(
        (note) => !filter.createdAfter || new Date(note.createdAt) >= filter.createdAfter,
      )
      .filter(
        (note) =>
          !filter.createdBefore || new Date(note.createdAt) <= filter.createdBefore,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, filter.limit ?? 50)
      .map(toSummary);
    return Promise.resolve(results);
  }
}

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  embedQuery(text: string): Promise<number[]> {
    return Promise.resolve(this.createEmbedding(text));
  }

  embedTexts(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => this.createEmbedding(text)));
  }

  private createEmbedding(text: string): number[] {
    const vector = Array.from({ length: 64 }, () => 0);
    for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let hash = 0;
      for (const character of token) {
        hash = (hash * 31 + character.charCodeAt(0)) % vector.length;
      }
      const current = vector[hash] ?? 0;
      vector[hash] = current + 1;
    }
    return vector;
  }
}

function toSummary(note: StoredNote): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    tags: note.tags,
    source: note.source,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function toDetail(note: StoredNote): NoteDetail {
  return {
    ...toSummary(note),
    content: note.content,
  };
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}
