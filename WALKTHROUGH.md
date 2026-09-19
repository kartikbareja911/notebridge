# NoteBridge Walkthrough

This is the plain-language companion to the code. It explains what NoteBridge
does, what happens inside the server when a tool is called, and how to verify
the current build.

## What NoteBridge Is

NoteBridge is not a chat application and it does not contain its own AI model.
It is an MCP server. An AI client such as Claude, Cursor, or another
MCP-compatible app connects to NoteBridge and discovers four tools:

| Tool           | What it does                                                                 |
| -------------- | ---------------------------------------------------------------------------- |
| `search_notes` | Finds relevant note chunks by meaning using vector similarity.               |
| `get_note`     | Returns the complete original note for a known note id.                      |
| `create_note`  | Saves a new note, chunks it, embeds it, and makes it searchable immediately. |
| `list_notes`   | Lists note metadata and can filter by tag or creation date.                  |

The AI client decides when to call those tools. The user continues talking to
the AI normally.

## The Main Pieces

```text
MCP client
   |
   | stdio or authenticated Streamable HTTP
   v
NoteBridge
   |- HTTP authentication and rate limiting (remote only)
   |- MCP tool schemas and handlers
   |- NotesService
   |- embedding provider
   |- tool-call recorder
   v
PostgreSQL + pgvector
```

The important boundary is between the transport and the tool layer. Local and
remote modes share the same tool implementation, so both modes behave the same
way after a request has been accepted.

## What Happens During a Search

Suppose the user asks: "What did I write about budget concerns?"

1. The AI decides that `search_notes` is relevant.
2. The MCP client sends a tool call with `query: "budget concerns"`.
3. If this is remote mode, NoteBridge validates the bearer key before dispatch.
4. The tool handler calls `NotesService.searchNotes`.
5. The embedding provider converts the query into a vector.
6. Drizzle runs a PostgreSQL query that joins `note_chunks` to `notes`.
7. The database filters `notes.user_id` to the authenticated user.
8. pgvector orders chunks by cosine similarity using the `<=>` operator.
9. The server returns the top chunks with note id, title, snippet, score,
   tags, source, and chunk index.
10. The AI uses those snippets to answer and can call `get_note` for the full
    note when needed.

The demo query is useful because the seeded note that wins is titled "Runway
Review" and discusses burn rate. That proves retrieval is semantic rather than
simple keyword matching.

## What Happens During Note Creation

1. The AI calls `create_note` with a title, content, and optional tags.
2. The MCP SDK validates the input against the JSON-compatible Zod shape.
3. `NotesService` trims and validates the values.
4. `chunkText` splits the content into paragraph-aware pieces.
5. Each chunk is embedded together with its note title and tags.
6. A database transaction inserts the parent note and all chunk vectors.
7. The tool returns the created note.
8. The next `search_notes` call can find the new note immediately.

The stored chunk text is still the raw note content. The title and tags are
added only to the text that is embedded, which improves retrieval without
changing what the model receives as a snippet.

## Data and Multi-Tenancy

The main tables are:

| Table         | Purpose                                                         |
| ------------- | --------------------------------------------------------------- |
| `users`       | One row per user identity.                                      |
| `notes`       | Full note content, title, tags, source, and owning `user_id`.   |
| `note_chunks` | Searchable chunks and their 1536-dimensional vectors.           |
| `api_keys`    | Hashed remote API keys and the user they identify.              |
| `tool_calls`  | Tool name, sanitized input, latency, success flag, and user id. |

`notes.user_id` is the tenancy boundary. Every note query includes it. Chunk
queries join through `notes`, so a user cannot see another user's chunks even
if the API caller guesses a note id.

For the isolation demo, user A owns the seeded notes. User B has a valid API
key but no notes. User B sees zero search results and receives `null` when
trying to retrieve a note id that belongs to user A.

## Local Mode: Step by Step

Local mode uses the `stdio` MCP transport. The client starts the server as a
child process and sends MCP messages over standard input/output.

| You do                                    | NoteBridge does                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| Start with `npm run dev` or client config | Loads `.env`, connects to PostgreSQL, and opens stdio.                  |
| Ask the client a question                 | Advertises the four tools through MCP.                                  |
| Client calls a tool                       | Runs the same validated handler used by remote mode.                    |
| Client closes                             | Receives `SIGTERM` or `SIGINT`, closes MCP, and ends the database pool. |

Run the repeatable local demo:

```powershell
npm run demo:local
```

It verifies the full create, search, retrieve, and list workflow without
requiring an interactive AI client.

## Remote Mode: Step by Step

Remote mode uses MCP Streamable HTTP at `/mcp`.

| Step                      | What happens                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Client sends request      | `src/http/server.ts` checks method, path, bearer header, rate limit, and body size.           |
| Key is present            | The raw key is hashed and looked up in `api_keys`.                                            |
| Key is valid              | The matching `user_id` becomes the owner of the MCP session and every tool call.              |
| Key is missing or invalid | The server returns `401` before MCP dispatch or tool execution.                               |
| Session exists            | A POST or GET must include the session id, and the session owner must match the current user. |
| Tool is called            | The tool runs with the authenticated `user_id`; the call is logged with sanitized input.      |

Start it locally:

```powershell
npm run dev:http
```

Create a key:

```powershell
npx tsx src\db\create-api-key.ts --user-id "00000000-0000-4000-8000-000000000001" --email "user@example.com" --label "remote-demo-a"
```

Run the full remote and tenant-isolation demo:

```powershell
$env:NOTEBRIDGE_REMOTE_API_KEY="<key for user A>"
$env:NOTEBRIDGE_REMOTE_API_KEY_B="<key for user B>"
npm run demo:remote
```

The expected output is:

```text
1. Unauthenticated request rejected with HTTP 401
2. Remote tools: search_notes, get_note, create_note, list_notes
3. Remote semantic search -> Runway Review
4. Tenant isolation -> user B saw 0 search results and null retrieval
```

## Authentication and Security

Remote v1 uses bearer API keys because MCP clients already support
authorization headers. This is a deliberate deviation from the original
Better Auth plan. The database stores only a SHA-256-derived hash of each key.
The raw value is printed when the key is created and is not recoverable later.

The server also:

- Authenticates before MCP dispatch.
- Checks session ownership.
- Scopes every note and chunk query by the authenticated user id.
- Applies an in-memory per-key rate limit.
- Limits JSON body size.
- Excludes note content from tool-call logs and persisted metadata.
- Returns structured MCP errors instead of crashing a request.

The rate limiter is intentionally simple for v1 and is local to one Node.js
process. A multi-instance deployment should use Redis or an equivalent shared
store.

## Tool-Call Observability

Every successful or failed tool call is recorded in `tool_calls` with:

- User id.
- Tool name.
- Sanitized input.
- Latency in milliseconds.
- Success flag.
- Timestamp.

The `create_note` handler records the title and tags but deliberately excludes
the note content.

## Current Build Status

- Phase 0 foundation: complete.
- Phase 1 schema, migrations, seed data, embeddings, and chunking: complete.
- Phase 2 local stdio server and all four tools: complete and live-tested.
- Phase 3 Streamable HTTP, hashed bearer auth, rate limiting, and tenant
  isolation: implemented and verified locally.
- Dockerfile source, `.dockerignore`, and production image build: complete and
  verified locally with Docker Desktop.
- Phase 3 hosted deployment: pending credentials and a hosted pgvector database.
- Phase 4 tool-call logging, README, automated tests, and CI: complete.
- Milestone video recordings: still pending.
- Phase 5 stretch features: not started.

The only core v1 item not yet proven is a public deployment. The local HTTP
server has been exercised end to end against PostgreSQL, including two real API
keys and cross-user isolation.

## Important Files

| File                         | Responsibility                                                   |
| ---------------------------- | ---------------------------------------------------------------- |
| `src/config.ts`              | Validates environment configuration.                             |
| `src/server.ts`              | Local stdio entrypoint.                                          |
| `src/http-server.ts`         | Remote HTTP entrypoint.                                          |
| `src/http/server.ts`         | Authentication, request limits, sessions, and MCP HTTP dispatch. |
| `src/http/rate-limit.ts`     | In-memory per-key request limiter.                               |
| `src/services/auth.ts`       | API key generation, hashing, lookup, and local identity.         |
| `src/services/notes.ts`      | Note validation, retrieval, creation, and vector search.         |
| `src/services/embedding.ts`  | OpenAI and local BGE embedding providers.                        |
| `src/services/chunking.ts`   | Paragraph-aware note chunking.                                   |
| `src/services/tool-calls.ts` | Persistent tool-call recording.                                  |
| `src/tools/definitions.ts`   | Model-facing schemas and tool descriptions.                      |
| `src/tools/register.ts`      | Tool handlers, error handling, and logging.                      |
| `src/db/schema.ts`           | Drizzle table definitions.                                       |
| `src/db/seed.ts`             | Repeatable realistic demo data.                                  |
| `src/db/create-api-key.ts`   | User and API key provisioning.                                   |
| `scripts/demo-local.ts`      | End-to-end stdio demonstration.                                  |
| `scripts/demo-remote.ts`     | End-to-end HTTP authentication and isolation demonstration.      |

## Verification Commands

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:local
```

For remote verification, start `npm run dev:http` in one terminal and run
`npm run demo:remote` with both key environment variables in another.

## What Is Deliberately Not Included

- A browser dashboard.
- PDF ingestion.
- LLM summarization or auto-tagging.
- OAuth or browser account sign-in.
- Shared rate limiting across multiple server instances.
- A claim that the public deployment exists before it has actually been
  deployed and verified.

Those are stretch features rather than requirements for the four-tool v1
server.
