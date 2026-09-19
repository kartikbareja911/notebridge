# Design Doc — NoteBridge MCP

## 1. Design Philosophy

The primary "interface" of this product is not a UI — it's the tool schema itself. The AI model is the user of these tools, so tool names, descriptions, and parameter names must be unambiguous and self-explanatory, the same way you'd design a clean public API. A minimal web dashboard exists only as a secondary, human-facing convenience for managing notes directly.

## 2. Tool Design Principles

- **Verb-first, unambiguous names**: `search_notes`, not `notes` or `query`.
- **Descriptions written for a model, not a human developer** — explain _when_ to use the tool, not just what it does. Example: "Use this when the user asks about something they previously wrote down or asks you to recall past notes."
- **Small, composable tools** rather than one giant multi-purpose tool — this lets the calling model chain them naturally (e.g., `search_notes` → `get_note` for full detail).
- **Structured, predictable return shapes** — always return JSON with consistent keys (`id`, `title`, `snippet`, `score`) so the model can reliably parse and cite results.

## 3. Minimal Web Dashboard (optional, human-facing only)

Not required for MCP functionality, but useful for demo polish and for managing notes without going through an AI client.

**Pages:**

- `/notes` — list view, searchable, filterable by tag.
- `/notes/[id]` — single note view/edit.
- `/settings` — API key management (local mode) or account/session info (remote mode).

**Visual direction:**

- Clean, minimal, content-first layout — this is a utility tool, not a consumer app. Avoid heavy branding; focus on legibility (generous whitespace, a simple serif or clean sans for note content, monospace for tags/metadata).
- Framework: Next.js App Router + Tailwind + shadcn/ui components (Card, Input, Badge for tags, Command palette for search — shadcn's `Command` component is a natural fit for a search-first note tool).
- Dark mode by default (developer-tool audience).

## 4. Data Model Design Rationale (see schema.md for full DDL)

- Notes and chunks are split into two tables because search operates at the chunk level (for precision) while the user/model reads and edits at the note level (for coherence). This is standard RAG design.
- `user_id` is present on `notes` from day one, even in local single-user mode, so the schema doesn't need a breaking migration when remote multi-tenant mode is added later.

## 5. Demo Script (for portfolio video / interview walkthrough)

1. Show Claude Desktop with NoteBridge connected (tools visible in the UI).
2. Ask a natural question that requires semantic (not keyword) matching — e.g., ask about "budget concerns" when the actual note says "worried about runway," to prove it's real semantic search, not string match.
3. Ask Claude to save a new note from the conversation; show it appear in the dashboard/db.
4. (If remote deployed) Show two different authenticated sessions with separate, non-overlapping notes to prove tenant isolation.

## 6. Accessibility / Quality Bar for the Dashboard

- Keyboard-navigable search (cmd+k style command palette).
- Sufficient color contrast (dark mode default, but respect `prefers-color-scheme`).
- No dashboard feature should be required to demonstrate the MCP server itself — the dashboard is a bonus, not the core deliverable.
