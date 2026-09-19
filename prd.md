# PRD — NoteBridge MCP

## 1. Summary

NoteBridge MCP is a Model Context Protocol (MCP) server that gives any MCP-compatible AI client (Claude Desktop, Claude Code, Cursor, Windsurf) live, tool-based access to a personal knowledge base of notes and documents. Instead of a standalone chat UI, the "app" is a set of callable tools an AI model can invoke directly during a normal conversation — search my notes, create a note, summarize a topic across notes, link related notes.

## 2. Problem Statement

People take notes across scattered tools (Notion, Obsidian, plain markdown, PDFs) but their AI assistant has no live access to that knowledge unless they paste it in manually every time. There is no standard, portable way to expose "my own data" to any AI client at once — each app builds its own one-off chat UI.

## 3. Goals

- Give any MCP client the ability to search, retrieve, and create notes in a personal knowledge base, using natural language.
- Support both **local (stdio)** usage for personal/dev use and **remote (HTTP+SSE, authenticated)** usage so the server could be shared or run in the cloud.
- Use retrieval that understands meaning, not just keyword match (semantic/vector search).
- Ship a working, demoable product in 2–3 weeks, not a research project.

## 4. Non-Goals (Out of Scope for v1)

- Real-time multi-user collaboration on notes.
- A polished note-taking UI (a minimal web UI for managing notes is enough; the "product" is the MCP tools, not the UI).
- Fine-tuning or hosting a custom LLM — use hosted embedding + LLM APIs.
- Mobile app.

## 5. Target Users

- Primary: the developer themself (dogfooding) — proof that it works end-to-end.
- Secondary (for portfolio framing): any developer/knowledge worker who wants their AI assistant to have live access to their own notes.

## 6. Core Features (v1)

1. **Ingest** — upload/add plain text, markdown, or PDF notes into the knowledge base (chunked + embedded).
2. **`search_notes(query, top_k)` tool** — semantic search across all notes, returns top relevant chunks with source note title/id.
3. **`get_note(id)` tool** — fetch a full note by id.
4. **`create_note(title, content, tags?)` tool** — let the AI client create a new note on the user's behalf (e.g., "save this summary as a note").
5. **`list_notes(filter?)` tool** — list notes, optionally filtered by tag or date.
6. **Auth** — API key (local) upgraded to OAuth/session-based auth for the remote deployment, so notes are private per user.
7. **Two transport modes** — stdio for local Claude Desktop/Code use, HTTP+SSE for a hosted, authenticated remote server.

## 7. Stretch Features (v1.5, if time allows)

- `summarize_topic(topic)` — pulls multiple relevant chunks and asks the LLM to synthesize a cross-note summary.
- Auto-tagging of notes on ingest using the LLM.
- A minimal web dashboard to browse/manage notes (not required for the MCP functionality itself).

## 8. Success Metrics (for a portfolio project, these are demo-quality bars, not business KPIs)

- Claude Desktop can successfully call `search_notes` and return a correct, relevant answer live, on camera, in a recorded demo.
- Server is deployed and reachable remotely with working auth (not just localhost).
- README clearly documents setup, tools, and includes a demo GIF/video.

## 9. Risks / Open Questions

- Embedding + vector search cost/latency at small scale should be negligible (Postgres + pgvector is fine, no need for a dedicated vector DB).
- MCP spec is young — some client behavior (esp. remote transport support) may vary; validate against the latest MCP spec version before building auth flows.
- Decide day 1: is the corpus your own real notes, or seeded sample data for the demo? (Recommend: seed realistic sample data so the demo isn't dependent on your actual private notes.)
