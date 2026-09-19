# Implementation Plan — NoteBridge MCP

Total estimated time: 2–3 weeks, part-time. Structured in phases so there is always a working demo at the end of each phase (never a half-broken state going into the next).

## Phase 0 — Setup (Day 1)

- [ ] Init repo, TypeScript config, ESLint/Prettier.
- [ ] `docker-compose.yml`: Postgres with pgvector extension enabled on startup.
- [ ] Install `@modelcontextprotocol/sdk`, Drizzle, `ai` (Vercel AI SDK), `pino`.
- [ ] Write `.env.example` with all required vars (`DATABASE_URL`, `OPENAI_API_KEY` or embedding provider key, `NOTEBRIDGE_API_KEY`).

## Phase 1 — Data layer (Days 2–3)

- [ ] Write Drizzle schema matching `schema.md`.
- [ ] Run migrations against local Docker Postgres.
- [ ] Write a seed script with 15–20 realistic sample notes (varied topics) so search has something meaningful to demo against.
- [ ] Write the embedding service: `embedText(text): number[]`.
- [ ] Write the chunking utility: `chunkText(content, maxTokens=500): string[]`.

## Phase 2 — Core MCP server, local/stdio mode (Days 4–7)

- [ ] Implement MCP server entrypoint using the official SDK with stdio transport.
- [ ] Implement `search_notes` tool end-to-end (embed query → pgvector search → return formatted results).
- [ ] Implement `get_note`, `create_note`, `list_notes` tools.
- [ ] Connect to Claude Desktop locally via config file; manually test each tool in a real conversation.
- [ ] **Milestone demo:** record a short clip of Claude Desktop calling `search_notes` and answering correctly from seeded data.

## Phase 3 — Remote transport + auth (Days 8–11)

- [ ] Add HTTP + SSE transport alongside stdio (MCP SDK supports both from the same tool handlers — don't duplicate logic).
- [ ] Integrate Better Auth for session/token-based auth on the HTTP endpoint.
- [ ] Scope all queries by `user_id`; write a test with two seeded users to confirm no data leakage.
- [ ] Add basic rate limiting on the HTTP endpoint.
- [ ] Dockerize the app; deploy to Fly.io (or Railway) pointed at a hosted Postgres (Neon/Supabase) with pgvector enabled.
- [ ] **Milestone demo:** connect a remote MCP client config to the deployed URL and repeat the search demo against the live server.

## Phase 4 — Polish + observability (Days 12–14)

- [ ] Add `tool_calls` logging on every tool invocation (latency, success/failure).
- [ ] Write a clear README: setup instructions, tool docs, architecture diagram, demo GIF/video link.
- [ ] Add basic tests (Vitest) for chunking, embedding call mocking, and the search query logic.
- [ ] GitHub Actions CI: lint + typecheck + test on push.

## Phase 5 — Stretch (optional, if time remains)

- [ ] `summarize_topic` tool using the LLM to synthesize across multiple retrieved chunks.
- [ ] Minimal Next.js dashboard for browsing/managing notes (per design.md).
- [ ] PDF ingestion endpoint.
- [ ] Auto-tagging on ingest via LLM.

## Definition of Done (v1)

- Local stdio mode works fully in Claude Desktop with all 4 core tools.
- Remote HTTP+SSE mode is deployed, authenticated, and multi-tenant safe.
- README + demo recording exist and are good enough to link directly from a resume/portfolio.
