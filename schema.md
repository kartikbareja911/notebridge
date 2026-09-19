# Schema — NoteBridge MCP

Database: PostgreSQL 16+, with the `pgvector` extension enabled.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Users (single row for local mode; real table for remote/multi-tenant mode)
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notes (parent record, human/model-facing unit)
CREATE TABLE notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,            -- full original content (encrypt at app layer if handling sensitive data)
  tags          TEXT[] DEFAULT '{}',
  source        TEXT DEFAULT 'manual',    -- 'manual' | 'pdf_upload' | 'markdown_import'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notes_user_id ON notes(user_id);
CREATE INDEX idx_notes_tags ON notes USING GIN (tags);

-- Note chunks (retrieval unit — what's actually embedded and searched)
CREATE TABLE note_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id       UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,          -- order within the parent note
  content       TEXT NOT NULL,
  embedding     VECTOR(1536) NOT NULL,     -- dimension depends on embedding model (1536 for text-embedding-3-small)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vector similarity index (approximate nearest neighbor, IVFFlat or HNSW)
CREATE INDEX idx_note_chunks_embedding
  ON note_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_note_chunks_note_id ON note_chunks(note_id);

-- API keys (local mode auth)
CREATE TABLE api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash      TEXT NOT NULL,             -- store a hash, never the raw key
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);

-- Tool call log (lightweight observability)
CREATE TABLE tool_calls (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  tool_name     TEXT NOT NULL,
  input         JSONB,
  latency_ms    INTEGER,
  success       BOOLEAN,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Example query: semantic search

```sql
SELECT n.id, n.title, c.content AS snippet,
       1 - (c.embedding <=> $1) AS similarity
FROM note_chunks c
JOIN notes n ON n.id = c.note_id
WHERE n.user_id = $2
ORDER BY c.embedding <=> $1
LIMIT $3;
```

(`$1` = query embedding vector, `$2` = current user id, `$3` = top_k)

## Drizzle ORM notes

- Define the above as Drizzle schema objects in `src/db/schema.ts`.
- Use `drizzle-kit` for migrations (`npm run db:generate`, `npm run db:migrate`).
- The `vector` column type needs the `pgvector` Drizzle extension/custom type helper — confirm current package name at build time (`drizzle-orm` + a pgvector column helper, or a small custom SQL type) since Drizzle's native vector support is still evolving.
