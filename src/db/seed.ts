import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { ensureUser } from "../services/auth.js";
import { createEmbeddingProvider } from "../services/embedding.js";
import { chunkText } from "../services/chunking.js";
import { createChunkEmbeddingText, DrizzleNoteRepository } from "../services/notes.js";
import { createDatabase } from "./client.js";
import { noteChunks, notes } from "./schema.js";

interface SeedNote {
  title: string;
  content: string;
  tags: string[];
}

const seedNotes: SeedNote[] = [
  {
    title: "Q3 Marketing Plan",
    content:
      "The Q3 launch focuses on developer communities, short technical demos, and case studies. The main risk is that paid acquisition costs keep rising, so we should shift more of the budget toward content and partner channels. Track activation, qualified signups, and demo-to-trial conversion weekly.",
    tags: ["marketing", "q3", "planning"],
  },
  {
    title: "Runway Review",
    content:
      "We currently have nine months of runway under the base-case hiring plan. I am worried about the burn rate if enterprise sales cycles take longer than expected. Freeze two non-critical hires and revisit the plan after the next renewal cohort closes.",
    tags: ["finance", "budget", "strategy"],
  },
  {
    title: "Interview Prep: Platform Team",
    content:
      "Review distributed systems fundamentals, especially idempotency, backpressure, and consistency tradeoffs. Prepare stories about the migration that reduced p95 latency by 38% and the incident caused by an unsafe retry policy. Questions to ask: on-call maturity, deployment cadence, and service ownership.",
    tags: ["career", "interviews", "engineering"],
  },
  {
    title: "Product Discovery: Weekly Summaries",
    content:
      "Users want summaries that preserve decisions and action items rather than compressing everything equally. Prototype a weekly digest that highlights changed commitments, unresolved questions, and links back to source notes. Avoid autonomous external messages in the first version.",
    tags: ["product", "research", "summaries"],
  },
  {
    title: "Postgres Indexing Notes",
    content:
      "Use B-tree indexes for equality and range predicates, GIN for arrays and JSONB, and HNSW for vector similarity. Verify query plans with EXPLAIN ANALYZE. Indexes are not free: every write pays maintenance cost, so remove indexes that do not support observed workloads.",
    tags: ["engineering", "postgres", "database"],
  },
  {
    title: "Book Notes: Shape Up",
    content:
      "Fixed time, variable scope is the central planning principle. A project should begin with a clear appetite and a bounded problem, then stop or reshape work that exceeds the appetite. Small teams need end-to-end ownership and uninterrupted time to make meaningful progress.",
    tags: ["books", "product", "management"],
  },
  {
    title: "Trip Idea: Japan in November",
    content:
      "Fly into Tokyo, stay for four nights, then take the train to Kyoto. Prioritize quieter neighborhoods, a day trip to Nara, and at least one ryokan stay. Keep two unscheduled days for weather and spontaneous food stops. Buy the rail pass only if the route math supports it.",
    tags: ["travel", "japan", "personal"],
  },
  {
    title: "Home Office Upgrade",
    content:
      "The biggest improvement would be better task lighting and a quieter microphone. Test a compact boom arm before buying a new desk. Keep cable routing simple and reserve one drawer for adapters, labels, and spare batteries.",
    tags: ["personal", "workspace", "shopping"],
  },
  {
    title: "API Design Principles",
    content:
      "Prefer explicit resource names, stable identifiers, and predictable error shapes. Make pagination and filtering consistent across endpoints. Version only when compatibility cannot be preserved, and document retries, rate limits, and idempotency semantics clearly.",
    tags: ["engineering", "api", "architecture"],
  },
  {
    title: "Customer Call: Acme Analytics",
    content:
      "Acme needs tenant-level audit logs and a way to export data to their warehouse. Their security team will not approve a pilot until SSO and retention controls are documented. The champion is the platform lead, while procurement remains the main decision gate.",
    tags: ["customers", "sales", "security"],
  },
  {
    title: "Learning Plan: Retrieval Systems",
    content:
      "Study chunking, embedding evaluation, hybrid retrieval, reranking, and grounded answer generation. Build a small evaluation set with exact facts that should be retrieved. Measure recall before optimizing latency or prompt style.",
    tags: ["learning", "ai", "retrieval"],
  },
  {
    title: "Meeting Notes: Reliability Review",
    content:
      "The checkout timeout spike came from a saturated connection pool, not the database itself. Add queue-depth alerts, cap retries at the client boundary, and test behavior when a dependency degrades rather than fails completely. Owner: Priya. Follow-up in two weeks.",
    tags: ["meetings", "reliability", "incidents"],
  },
  {
    title: "Content Ideas for Launch",
    content:
      "Write a post about why personal knowledge needs an open protocol. Follow it with a practical installation guide and a short video showing semantic search that finds an idea without matching its exact words. End with a candid limitations section.",
    tags: ["content", "writing", "launch"],
  },
  {
    title: "Hiring Rubric: Backend Engineer",
    content:
      "Look for strong debugging instincts, clear written communication, and comfort owning production systems. Coding exercises should include an ambiguous requirement and a failure mode. Avoid trivia that does not predict day-to-day performance.",
    tags: ["hiring", "engineering", "management"],
  },
  {
    title: "Security Checklist for Remote MCP",
    content:
      "Authenticate before invoking tools, scope every query by user id, rate-limit expensive operations, and avoid logging note content. Validate inputs, set content-size limits, and isolate credentials from tool output. Review transport behavior against the current MCP specification.",
    tags: ["security", "mcp", "remote"],
  },
  {
    title: "Weekly Review Template",
    content:
      "What moved the most important project forward? What created avoidable drag? Which commitment is now at risk? Pick no more than three outcomes for next week and schedule the first concrete block for each one.",
    tags: ["productivity", "planning", "reflection"],
  },
  {
    title: "Design Notes: Command Palette Search",
    content:
      "Search should open from the keyboard, accept plain language, and show enough source context to build trust. Result rows need title, snippet, tags, and a clear selected state. Keep empty and error states quiet and actionable.",
    tags: ["design", "search", "ux"],
  },
  {
    title: "Ideas for Better Demos",
    content:
      "A strong demo starts with the before state and makes the invisible system visible. Use realistic data, show one failure boundary, and keep the final workflow under five minutes. Prepare a backup recording for network or authentication failures.",
    tags: ["demo", "portfolio", "presentation"],
  },
];

async function main(): Promise<void> {
  const config = loadConfig();

  const { database, close } = createDatabase(config);

  try {
    await ensureUser(database, config.NOTEBRIDGE_USER_ID, "local@notebridge.test");

    const repository = new DrizzleNoteRepository(database);
    const embedder = createEmbeddingProvider(config);
    const prepared = seedNotes.map((note) => ({
      ...note,
      chunks: chunkText(note.content),
    }));
    const embeddings = await embedder.embedTexts(
      prepared.flatMap((note) =>
        note.chunks.map((content) =>
          createChunkEmbeddingText({
            title: note.title,
            tags: note.tags,
            content,
          }),
        ),
      ),
    );

    let embeddingIndex = 0;
    let inserted = 0;

    for (const note of prepared) {
      const existing = await database
        .select({ id: notes.id })
        .from(notes)
        .where(
          and(eq(notes.userId, config.NOTEBRIDGE_USER_ID), eq(notes.title, note.title)),
        )
        .limit(1);

      const noteEmbeddings = note.chunks.map(() => {
        const embedding = embeddings[embeddingIndex];
        embeddingIndex += 1;
        if (!embedding) {
          throw new Error(`Missing embedding for seeded note: ${note.title}`);
        }
        return embedding;
      });

      if (existing.length > 0) {
        const [existingNote] = existing;
        if (existingNote) {
          await database.transaction(async (transaction) => {
            await transaction
              .update(notes)
              .set({
                content: note.content,
                tags: note.tags,
                source: "manual",
                updatedAt: new Date(),
              })
              .where(eq(notes.id, existingNote.id));
            await transaction
              .delete(noteChunks)
              .where(eq(noteChunks.noteId, existingNote.id));
            await transaction.insert(noteChunks).values(
              note.chunks.map((content, index) => ({
                noteId: existingNote.id,
                chunkIndex: index,
                content,
                embedding: noteEmbeddings[index] ?? [],
              })),
            );
          });
        }
        continue;
      }

      await repository.createNote(
        config.NOTEBRIDGE_USER_ID,
        {
          title: note.title,
          content: note.content,
          tags: note.tags,
          source: "manual",
        },
        note.chunks.map((content, index) => ({
          content,
          embedding: noteEmbeddings[index] ?? [],
        })),
      );
      inserted += 1;
    }

    console.error(`Seed complete: ${inserted} notes inserted`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("Database seed failed", error);
  process.exitCode = 1;
});
