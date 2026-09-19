# Rules — NoteBridge MCP (for the building agent)

These are binding conventions for whoever/whatever builds this project (human or AI agent). Follow them unless a doc above explicitly says otherwise.

## General

1. Follow `prd.md` for scope. Do not add features not listed in Core or Stretch without flagging it first.
2. Build in the phase order defined in `implementationplan.md`. Do not start Phase 3 (remote/auth) work before Phase 2 (local core tools) is fully working and demoed.
3. Update `tracker.md` status for each task as you complete it — do not batch updates at the end.
4. If you deviate from `techspec.md` or `schema.md` (e.g., a package doesn't support what's written), log it in the Decisions Log in `tracker.md` with the reason.

## Code style

5. TypeScript strict mode on. No `any` unless truly unavoidable, and comment why when used.
6. All MCP tool input schemas must be defined with full JSON Schema (types, required fields, descriptions) — never accept untyped/unvalidated input.
7. All async DB/network calls must have explicit error handling — a failed tool call should return a clear MCP error response, never crash the server process.
8. No secrets committed. All config via `.env`, with `.env.example` kept up to date whenever a new variable is introduced.
9. Keep tool handler functions small — business logic (embedding, search, chunking) belongs in `src/services/`, not inline in the tool handler.

## Database

10. All schema changes go through Drizzle migrations — never hand-edit the database directly, even in local dev.
11. Every table holding user data must have a `user_id` column from day one, even in single-user local mode (per `schema.md` rationale) — no exceptions, to avoid a breaking migration later.
12. Never log full note `content` in plaintext logs if the deployment is intended to hold real personal data — log ids/metadata only.

## Security

13. Remote (HTTP) mode must reject any unauthenticated request before it reaches a tool handler — auth check happens at the transport/middleware layer, not inside each tool.
14. All tool queries must be scoped by the authenticated `user_id`. Any query touching `notes` or `note_chunks` without a `user_id` filter is a bug — treat it as a blocking issue, not a nit.
15. Rate-limit the remote endpoint before deploying it publicly, even for a demo.

## Testing & demo readiness

16. Every tool needs at least one test proving it returns the correct shape given a known seeded input.
17. Do not mark a phase "done" in `tracker.md` without having actually run the manual demo flow described in `appflow.md` for that phase.
18. The final deliverable must include a recorded demo (per `design.md` demo script) — a project without a demo recording is not considered complete for portfolio purposes.

## Documentation

19. Keep `README.md` (separate from these planning docs) in sync with actual setup steps — if a setup step changes, update the README in the same commit/session.
20. Tool descriptions (the ones the AI model reads) are product copy, not internal comments — write them clearly enough that a model with no other context would know exactly when to use the tool.
