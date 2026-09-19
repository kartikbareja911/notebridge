# App Flow — NoteBridge MCP

## 1. Local Setup Flow (developer / user)

1. User clones the repo, runs `docker compose up` (spins up Postgres + pgvector locally).
2. User runs `npm run db:migrate` to create tables, `npm run db:seed` to load sample notes.
3. User adds NoteBridge to their Claude Desktop config (`claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "notebridge": {
         "command": "node",
         "args": ["./dist/server.js"],
         "env": {
           "NOTEBRIDGE_API_KEY": "local-dev-key",
           "DATABASE_URL": "postgres://..."
         }
       }
     }
   }
   ```
4. User restarts Claude Desktop. NoteBridge's tools now appear as available tools in any new chat.

## 2. Core Usage Flow: Searching Notes

1. User, in a normal Claude Desktop conversation, types: _"What did I write about Q3 marketing plans?"_
2. Claude recognizes this matches the `search_notes` tool's description and decides to call it.
3. Claude sends a tool call: `search_notes({ query: "Q3 marketing plans", top_k: 5 })`.
4. NoteBridge server:
   a. Embeds the query text.
   b. Runs a pgvector similarity search against `note_chunks`.
   c. Joins results back to parent notes, returns top 5 chunks with note titles + snippet text.
5. Claude receives the tool result (structured JSON), synthesizes a natural-language answer citing which notes it came from, and replies to the user.

## 3. Core Usage Flow: Creating a Note

1. User: _"Save a note titled 'Interview prep' summarizing what we just discussed."_
2. Claude calls `create_note({ title: "Interview prep", content: "...", tags: ["career"] })`.
3. Server chunks + embeds the new content, inserts into `notes` and `note_chunks` tables.
4. Server returns the new note's id; Claude confirms to the user: "Saved as note #42."

## 4. Remote/Authenticated Flow (stretch)

1. User deploys NoteBridge to Fly.io; server exposes an HTTPS + SSE MCP endpoint.
2. User signs in via Better Auth (email/OAuth), receives a session token.
3. User configures a remote MCP client entry pointing to `https://notebridge.fly.dev/mcp` with the token as a bearer header.
4. All subsequent tool calls are scoped to that authenticated user's `user_id` — two different users hitting the same server never see each other's notes.

## 5. Ingestion Flow (PDF/markdown upload, stretch)

1. User runs a small CLI script or hits an `/ingest` HTTP endpoint with a file.
2. Server extracts text (markdown parsed directly; PDF via a text-extraction library).
3. Text is chunked, embedded, and stored exactly as in the `create_note` flow.

## 6. Error/Edge Case Flows

- **No relevant notes found:** `search_notes` returns an empty array; Claude should gracefully tell the user nothing matched rather than hallucinating an answer.
- **Invalid/missing auth (remote mode):** server returns 401 before any tool executes; MCP client surfaces an auth error to the user.
- **Oversized note content:** server validates content length server-side and returns a clear MCP tool error instead of silently truncating.
