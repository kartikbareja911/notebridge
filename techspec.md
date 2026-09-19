# Tech Spec — NoteBridge MCP

## 1. Architecture Overview

```
                         ┌───────────────────────────┐
                         │   MCP Clients              │
                         │  (Claude Desktop, Claude   │
                         │   Code, Cursor)            │
                         └───────────┬───────────────┘
                                     │  MCP protocol
                          stdio (local) │ HTTP + SSE (remote, authed)
                                     │
                         ┌───────────▼───────────────┐
                         │   NoteBridge MCP Server     │
                         │   (Node.js + TypeScript)    │
                         │   @modelcontextprotocol/sdk │
                         ├────────────────────────────┤
                         │  Tool handlers:             │
                         │  search_notes, get_note,    │
                         │  create_note, list_notes    │
                         ├────────────────────────────┤
                         │  Services:                  │
                         │   - Embedding service       │
                         │     (Vercel AI SDK)         │
                         │   - Auth service            │
                         │     (Better Auth / API key) │
                         └───────────┬───────────────┘
                                     │  Drizzle ORM
                         ┌───────────▼───────────────┐
                         │  PostgreSQL + pgvector      │
                         │  (Neon or Supabase, hosted) │
                         └────────────────────────────┘
```

## 2. Tech Stack (current, 2026)

| Layer                            | Choice                                                                      | Why                                                                  |
| -------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Language                         | TypeScript                                                                  | MCP SDK is first-class TS; type safety for tool schemas              |
| MCP implementation               | `@modelcontextprotocol/sdk` (official)                                      | Don't hand-roll the protocol                                         |
| Runtime                          | Node.js 22 LTS                                                              | Required by MCP SDK, stable                                          |
| Transport (local)                | stdio                                                                       | Required for Claude Desktop/Code local config                        |
| Transport (remote)               | HTTP + Server-Sent Events (SSE)                                             | Current MCP remote-server standard                                   |
| Database                         | PostgreSQL (hosted via Neon or Supabase)                                    | Reliable, supports pgvector                                          |
| Vector search                    | `pgvector` extension                                                        | Avoids standing up a separate vector DB for this scale               |
| ORM                              | Drizzle ORM                                                                 | Lightweight, modern, type-safe, faster than Prisma for this use case |
| Embeddings                       | Vercel AI SDK (`ai` package) + OpenAI `text-embedding-3-small` or Voyage AI | Current standard for embedding + streaming AI calls in TS            |
| LLM (for stretch summarize tool) | Anthropic API via Vercel AI SDK provider                                    | Consistent with Claude-first framing                                 |
| Auth (local)                     | Static API key in config                                                    | Simplicity for local/dev use                                         |
| Auth (remote)                    | Better Auth (session/OAuth)                                                 | Newer, actively adopted auth library; avoids Clerk vendor lock-in    |
| Deployment                       | Docker container → Fly.io or Railway                                        | Cheap, simple, supports long-lived processes for SSE                 |
| CI                               | GitHub Actions                                                              | Lint, typecheck, test on push                                        |
| Testing                          | Vitest                                                                      | Fast, modern, TS-native                                              |

## 3. MCP Tool Definitions

```ts
// search_notes
{
  name: "search_notes",
  description: "Semantic search across the user's notes. Returns the most relevant note chunks.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural language search query" },
      top_k: { type: "number", default: 5, description: "Number of results to return" }
    },
    required: ["query"]
  }
}

// get_note
{
  name: "get_note",
  description: "Fetch the full content of a single note by its id.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"]
  }
}

// create_note
{
  name: "create_note",
  description: "Create a new note in the user's knowledge base.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      tags: { type: "array", items: { type: "string" } }
    },
    required: ["title", "content"]
  }
}

// list_notes
{
  name: "list_notes",
  description: "List notes, optionally filtered by tag.",
  inputSchema: {
    type: "object",
    properties: { tag: { type: "string" } }
  }
}
```

## 4. Embedding & Retrieval Pipeline

1. On note create/ingest: split content into ~500-token chunks (simple recursive splitter).
2. Generate embeddings per chunk via embedding model.
3. Store each chunk + its vector in `note_chunks` table (see schema.md).
4. On `search_notes`: embed the query, run a cosine-similarity nearest-neighbor query against `note_chunks` using pgvector's `<=>` operator, return top-k chunks joined back to parent note metadata.

## 5. Auth Design

- **Local mode:** server reads an API key from an env var; MCP client config passes it via env when launching the stdio process. No network exposure, so this is low-risk.
- **Remote mode:** HTTP+SSE endpoint behind Better Auth session/JWT validation. Each authenticated user maps to a `user_id`, and all note queries are scoped (`WHERE user_id = ?`) — this is the multi-tenancy boundary.

## 6. Security Considerations

- Notes may contain personal data — encrypt `content` at rest at the column level if deploying with real personal data (pgcrypto or app-level AES-256).
- Rate-limit the remote HTTP endpoint (basic in-memory or Redis token bucket) to avoid abuse/cost blowup on the embedding API.
- Validate all tool inputs against the JSON schema before hitting the DB (MCP SDK does this partially; add explicit checks for lengths/types).

## 7. Deployment

- `Dockerfile` builds the Node app.
- `docker-compose.yml` for local dev: app + Postgres w/ pgvector extension.
- Production: Fly.io app (supports persistent SSE connections) + Neon/Supabase for managed Postgres.
- Environment config via `.env` (never committed) documented in `.env.example`.

## 8. Observability (lightweight, optional stretch)

- Structured logs (pino) for every tool call: tool name, latency, success/failure.
- Optional: pipe logs to a free-tier Logtail/Axiom for a "real production system" feel in the demo.
