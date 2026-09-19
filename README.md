# NoteBridge MCP

NoteBridge is an MCP server that gives an AI client live access to a personal
knowledge base. It exposes four tools over local `stdio` or authenticated
Streamable HTTP:

- `search_notes`: semantic search across note chunks.
- `get_note`: retrieve one complete note by id.
- `create_note`: save a note and make it immediately searchable.
- `list_notes`: browse notes by tag or creation date.

The server is built with TypeScript, the official MCP SDK, Drizzle ORM,
PostgreSQL, and pgvector.

## Architecture

```text
MCP client (Claude, Cursor, etc.)
        |
        +-- local stdio --------------------+
        |                                   |
        +-- authenticated Streamable HTTP --+
                                            |
                                  NoteBridge MCP server
                                  - tool validation
                                  - user-scoped services
                                  - embedding provider
                                  - tool-call recording
                                            |
                                  PostgreSQL + pgvector
```

The local and remote entrypoints share the same tool registration and service
layer. Remote requests are authenticated at the HTTP boundary before MCP
dispatch. Every note and chunk query is scoped by the authenticated user id.

## Requirements

- Node.js 22 or newer.
- PostgreSQL with the `pgvector` extension.
- Optional: an OpenAI API key when using hosted embeddings.

The repository includes a Docker Compose service for local PostgreSQL. If
Docker is unavailable, use any PostgreSQL 16+ instance with pgvector enabled.

## Local Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Create the environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Start PostgreSQL with pgvector:

   ```powershell
   docker compose up -d
   ```

   > **Note (this machine):** PostgreSQL 18 + pgvector is already installed
   > inside the Ubuntu WSL distro and auto-starts with WSL (systemd). WSL
   > forwards it to `127.0.0.1:5432`, so the connection string in `.env` works
   > as-is and the Docker Compose step can be skipped. If the database is ever
   > unreachable, run `wsl -d Ubuntu` and check
   > `sudo systemctl status postgresql`.

4. Apply migrations and load the demo notes:

   ```powershell
   npm run db:migrate
   npm run db:seed
   ```

5. Build the server:

   ```powershell
   npm run build
   ```

### Embedding Providers

`EMBEDDING_PROVIDER=openai` uses `text-embedding-3-small` and requires
`OPENAI_API_KEY`.

`EMBEDDING_PROVIDER=local` uses `Xenova/bge-small-en-v1.5`. It downloads the
model on first use and does not require a hosted API. Local 384-dimensional
vectors are zero-padded to the 1536-dimensional database column.

Use local embeddings for an offline, repeatable development demo:

```dotenv
EMBEDDING_PROVIDER=local
```

## Local MCP Client

Point an MCP client at the compiled stdio entrypoint. A typical configuration
looks like this:

```json
{
  "mcpServers": {
    "notebridge": {
      "command": "node",
      "args": ["C:\\notebridge\\dist\\server.js"],
      "env": {
        "DATABASE_URL": "postgres://notebridge:notebridge@127.0.0.1:5432/notebridge",
        "EMBEDDING_PROVIDER": "openai",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

The exact configuration file and schema depend on the MCP client. Restart the
client after changing its server configuration.

Verify the local flow without an interactive client:

```powershell
npm run demo:local
```

The demo connects over stdio, lists all four tools, searches for
`"budget concerns"`, retrieves a note, creates a note, immediately searches for
it, and lists it by tag.

## Remote Streamable HTTP

Start the HTTP server:

```powershell
npm run dev:http
```

The MCP endpoint is `http://127.0.0.1:3000/mcp`. Requests require a bearer API
key. API keys are stored only as SHA-256-derived hashes, and the raw key is
printed once when it is created.

Create a user and key directly:

```powershell
npx tsx src\db\create-api-key.ts --user-id "00000000-0000-4000-8000-000000000001" --email "user@example.com" --label "local-remote"
```

Create an isolated second user for a tenant test:

```powershell
npx tsx src\db\create-api-key.ts --user-id "00000000-0000-4000-8000-000000000002" --email "other@example.com" --label "tenant-test"
```

Run the remote demo with both keys:

```powershell
$env:NOTEBRIDGE_REMOTE_API_KEY="<first key>"
$env:NOTEBRIDGE_REMOTE_API_KEY_B="<second key>"
npm run demo:remote
```

The demo proves that an unauthenticated request receives `401`, the
authenticated client sees all four tools, semantic search returns the expected
seeded note, and the second user cannot search or retrieve the first user's
note.

A client that supports Streamable HTTP can be configured with a bearer header:

```json
{
  "mcpServers": {
    "notebridge-remote": {
      "url": "https://notebridge.example.com/mcp",
      "headers": {
        "Authorization": "Bearer nb_..."
      }
    }
  }
}
```

Remote client configuration formats vary. If a desktop client only supports
stdio, use that client's HTTP bridge instead of changing NoteBridge's transport.

## Container

Build the production image:

```powershell
docker build -t notebridge-mcp .
```

Apply migrations once before starting the server:

```powershell
docker run --rm --env-file .env notebridge-mcp node dist/db/migrate.js
docker run --rm --env-file .env -p 3000:3000 notebridge-mcp
```

The image defaults to `HOST=0.0.0.0`, `PORT=3000`, and runs as the non-root
`node` user. A hosted deployment still needs a PostgreSQL database with
pgvector and environment secrets supplied by the hosting platform.

## Environment

All supported variables are documented in `.env.example`.

| Variable                  | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `DATABASE_URL`            | PostgreSQL connection string.                                   |
| `NOTEBRIDGE_API_KEY`      | Local stdio identity marker; replace outside local development. |
| `NOTEBRIDGE_USER_ID`      | User id used by local stdio and seeding.                        |
| `EMBEDDING_PROVIDER`      | `openai` or `local`.                                            |
| `OPENAI_API_KEY`          | Required for OpenAI embeddings.                                 |
| `EMBEDDING_MODEL`         | OpenAI embedding model name.                                    |
| `LOCAL_EMBEDDING_MODEL`   | Hugging Face model used by local embeddings.                    |
| `HOST`                    | HTTP bind address. Use `0.0.0.0` in containers.                 |
| `PORT`                    | HTTP port.                                                      |
| `RATE_LIMIT_MAX_REQUESTS` | Requests allowed per key in one window.                         |
| `RATE_LIMIT_WINDOW_MS`    | Rate-limit window length.                                       |
| `MAX_HTTP_BODY_BYTES`     | Maximum accepted JSON request size.                             |
| `LOG_LEVEL`               | Pino log level.                                                 |

## Security Model

- Remote authentication happens before an MCP tool handler can run.
- Every note, chunk search, retrieval, and listing operation filters by the
  authenticated user id.
- Remote sessions are owned by a user; another user cannot reuse a session id.
- API keys are hashed before storage and are never returned after creation.
- Note content is excluded from structured logs and `tool_calls` input.
- The HTTP boundary rejects oversized bodies and applies in-memory per-key rate
  limits.

The in-memory rate limiter is per process. A horizontally scaled deployment
should replace it with Redis or another shared limiter. TLS, backups, database
access controls, and secret management are deployment responsibilities.

## Quality Checks

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

GitHub Actions runs lint, typecheck, tests, and the production build on pushes
and pull requests.

## Project Layout

```text
src/server.ts                 local stdio entrypoint
src/http-server.ts            remote HTTP entrypoint
src/http/                     HTTP transport and rate limiting
src/tools/                    MCP schemas and tool registration
src/services/                 notes, embeddings, chunking, auth, logging
src/db/                       schema, migrations, seed, key provisioning
scripts/demo-local.ts         repeatable stdio demo
scripts/demo-remote.ts        repeatable remote and isolation demo
tests/                        Vitest coverage
```

See `WALKTHROUGH.md` for a plain-language explanation of how the system works
and `tracker.md` for implementation status.
