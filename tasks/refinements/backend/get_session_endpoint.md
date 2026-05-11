# `GET /sessions/:id` — fetch a single session's metadata

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.session_management.get_session_endpoint`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `backend.api_skeleton` — settled (HTTP server, error handling, OpenAPI, request logging).
- `backend.auth` — settled (`app.authenticate` decorator + `request.authUser` shape).
- `backend.session_management.create_session_endpoint` — settled (`apps/server/src/sessions/routes.ts` plus the `SessionResponse` schema this task reuses).
- `backend.session_management.list_sessions_endpoint` — settled (the visibility WHERE clause this task lifts verbatim).
- `data_and_methodology.schema.sessions_table` — settled.
- `data_and_methodology.schema.session_participants_table` — settled (visibility-gate join target).

## What this task is

Third sibling under `backend.session_management`. Lands `GET /sessions/:id` — an authenticated user issues a GET against a specific session id; the server returns the session's metadata (the `SessionResponse` shape) if and only if the caller can see it. The visibility predicate is identical to the one `GET /sessions` applies for filtering its result set: public OR host OR participant.

The artifact shape:

- `apps/server/src/sessions/routes.ts` — extend the existing plugin with `GET /sessions/:id`. Reuses `sessionResponseRef`, `sessionRowToResponse`, and the SAME visibility WHERE clause `GET /sessions` uses (inlined here with a comment cross-referencing the list endpoint for the canonical rationale — the predicate is two lines of SQL; factoring it into a helper would obscure the SQL surface for marginal DRY benefit).
- `apps/server/src/sessions/routes.test.ts` — extend the existing Vitest unit suite with the new endpoint's cases.
- `tests/behavior/backend/get-session.feature` + `tests/behavior/steps/backend-get-session.steps.ts` — new files.

## Why it needs to be done

Two downstream consumers wait on this:

- **`backend.session_management.end_session_endpoint`** and **`backend.session_management.session_privacy_toggle`** need a way for callers to confirm post-mutation state without re-listing. A `GET /sessions/:id` is the canonical "what does this session look like NOW?" surface.
- **Moderator-UI / participant-UI session detail views.** A user picks a session from the list, lands on its detail page, and the page issues `GET /sessions/:id` to render the header (topic, host, privacy, started-at, ended-at). The list endpoint doesn't carry enough detail-shaped affordance for refresh-on-tab-return; the fetch endpoint does.

## Inputs / context

From [docs/architecture.md — cross-session reference permissions](../../../docs/architecture.md#cross-session-reference-permissions): the public-by-default / host-may-mark-private rule. Listing is strictly weaker than referencing; fetching a single session's metadata is also strictly weaker than referencing — the same visibility gate suffices.

From [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts):

- `sessionResponseSchema` / `sessionResponseRef` / `SESSION_RESPONSE_SCHEMA_ID` — the canonical per-session shape this endpoint returns.
- `sessionRowToResponse(row)` — the snake_case → camelCase mapper. Reused unchanged.
- The `GET /sessions` handler's visibility WHERE clause — the canonical statement of "what can this caller see?" — lifted verbatim into the fetch handler's SELECT.
- `__buildTestSessionsApp(...)` — the Vitest helper that wires the auth middleware + the sessions routes plugin; the new tests extend the same helper.

From [`tasks/refinements/backend/list_sessions_endpoint.md`](./list_sessions_endpoint.md) — the visibility-rule decision (`public OR host OR participant`) and its rationale. This task reuses that decision; the only difference is the WHERE clause adds `AND id = $2` so the result is at most one row.

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts) — `ApiError.notFound(...)` produces a 404 with `code: 'not-found'`. Used for both "the id isn't in the DB" AND "the caller can't see this id" — the two cases are deliberately indistinguishable from outside (the existence-leak rule below).

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest covers pure handler logic + Fastify `.inject()` cases; Cucumber+pglite covers the end-to-end query against the migrated schema.

## Constraints / requirements

- **Endpoint**: `GET /sessions/:id`.
- **Auth**: required. `preHandler: app.authenticate`; 401 `auth-required` on any failure mode (middleware-owned).
- **Path param** (JSON Schema, attached to `schema.params`):

  ```jsonc
  {
    "type": "object",
    "required": ["id"],
    "additionalProperties": false,
    "properties": {
      "id": { "type": "string", "format": "uuid" }
    }
  }
  ```

  A non-UUID `:id` produces 400 `validation-failed` from the Fastify validator. The handler never runs on a malformed id.

- **Visibility rule (lifted verbatim from `list_sessions_endpoint`)** — the SAME predicate, parameterized on `request.authUser.id` AND the path-param id:

  ```sql
  SELECT id, host_user_id, privacy, topic, created_at, ended_at
  FROM sessions
  WHERE id = $1
    AND (
          privacy = 'public'
          OR host_user_id = $2
          OR EXISTS (
               SELECT 1 FROM session_participants sp
               WHERE sp.session_id = sessions.id AND sp.user_id = $2
             )
        )
  ```

  Zero rows → 404 (whether the id doesn't exist at all, or it exists but isn't visible to this caller — the handler cannot and must not distinguish).

- **Response shape** — 200 + a single `SessionResponse` object (NOT wrapped in `{ session: ... }`; the fetch endpoint's resource IS the session). camelCase via `sessionRowToResponse`.

- **Status codes**:
  - 200 — visible session found.
  - 400 — `:id` is not a UUID (`validation-failed` envelope).
  - 401 — unauthenticated (`auth-required` envelope, emitted by the auth middleware).
  - 404 — session does not exist OR exists but is not visible to the caller (`not-found` envelope, single phrasing for both branches).
  - 500 — DB error or unhandled exception.

- **Test layers per ADR 0022**:
  - **Vitest** — 7 cases: authenticated + visible → 200; no auth → 401; unknown id → 404; private not visible to caller → 404 (NOT 403); private visible to host → 200; private visible to participant → 200; non-UUID path param → 400.
  - **Cucumber+pglite** — 3 scenarios: successful fetch; private NOT visible to non-participant → 404; unknown id → 404.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; new cases bring the total from 760 to 767 (+7).
- `pnpm run test:behavior:smoke` (Cucumber) green; new feature adds 3 scenarios (140 → 143).
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- Generated OpenAPI document at `/docs/json` lists `GET /sessions/{id}` tagged `sessions` with the `cookieAuth` security requirement and a 200 response referencing `SessionResponse`.

## Decisions

- **404 (NOT 403) for "private session not visible to the caller."** Two alternatives surveyed:
  - **404 for both "does not exist" and "exists but not visible"** (chosen). The two cases are indistinguishable from outside, which is the point — a 403 on an invisible private session would leak the session's existence to a caller who is not entitled to know it exists. With 404 the caller learns only "there's no session at this id that I can see"; whether that's because the id is unused or because the host hasn't included them as a participant is the host's information to share, not the platform's to broadcast via status-code discrimination. Mirrors the documented behavior of `ApiError.notFound` (`apps/server/src/errors.ts`): "the referenced entity does not exist (or is not visible to the caller; we use the same status for both to avoid leaking existence)."
  - **403 for "exists but not visible"** (rejected). Distinguishable from 404, so an attacker enumerating uuids could probe a private session's existence by observing 403 vs. 404 responses. The information leak is small per request but catastrophic in aggregate (a private session's mere existence may be sensitive; e.g. an HR investigation, a confidential deliberation). The no-leak property is cheap to provide and impossible to retrofit.

- **Visibility rule reused verbatim from `list_sessions_endpoint`.** The list endpoint's WHERE clause IS the canonical "what can this caller see?" predicate. Two alternatives surveyed:
  - **Inline the same predicate** (chosen). The SQL is two lines (a `privacy = 'public' OR host_user_id = $? OR EXISTS (...)` block); inlining keeps the SQL surface visible at the call site, with a comment cross-referencing the list endpoint as the canonical source of the decision. Factoring into a TypeScript helper would obscure the SQL surface for marginal DRY benefit (the only thing being shared is a string fragment; the surrounding SELECT shape is different in each endpoint).
  - **Factor into a `buildVisibilityWhereClause(paramOffset)` helper** (rejected for v1). Adds indirection without saving meaningful code; the cross-endpoint coupling is the visibility-rule decision (recorded in the list-endpoint refinement), not a code-level abstraction. If a third endpoint also needs the same gate (e.g. `POST /sessions/:id/end` will), revisit at that point — three call sites is the canonical threshold for extracting a helper.

- **Reuse `SessionResponse` schema; do NOT introduce a wrapper.** The list endpoint returns `{ sessions: SessionResponse[] }` because the wrapper has room to grow (pagination, filter echo). The fetch endpoint's resource IS the session — there is no second axis along which the response could grow. Returning a bare `SessionResponse` matches the REST convention "GET /resource/:id returns the resource."

- **Path-param validation via JSON Schema (`format: 'uuid'`).** Fastify's ajv validator enforces UUID shape before the handler runs; the centralized error handler renders the `validation-failed` envelope. This catches malformed input (`/sessions/not-a-uuid` → 400) at the cheapest possible layer; no DB round-trip, no handler entry.

- **404 envelope's `message` is generic, NOT id-echoing.** The error envelope is `{ error: { code: 'not-found', message: 'session not found or not visible' } }` — the message does NOT include the requested id. Including the id would leak nothing (the caller already sent it), but it would also serve no debugging purpose — the caller knows what they asked for. Generic message keeps the envelope shape uniform with other 404s.

- **No participation-role disclosure in the response.** The fetch endpoint returns ONLY the `SessionResponse` shape (id, hostUserId, privacy, topic, createdAt, endedAt). It does NOT carry "your role in this session" or the participant list — those are sibling endpoints (`participant_assignment` will own the role-mutation surface; a future `GET /sessions/:id/participants` will own the participant list). Keeping the fetch endpoint focused on the session row itself maintains a clean separation: one endpoint per resource shape.

## Open questions

- **ETag / `If-None-Match` support** — the response is cacheable client-side until the session's privacy or ended-at changes. Adding an `ETag` header (hash of `(id, privacy, ended_at)`) would let polling clients short-circuit on 304. Deferred — premature for v1; the UI today re-fetches on tab focus and the cost is one small row read.
- **Participant role on the response** — would the moderator-UI's session header benefit from "you are the host" / "you are a participant" / "you are a public viewer" on the response so it can render a badge without a follow-up fetch? Deferred — `participant_assignment` is the canonical owner of role data, and the fetch endpoint can stay focused on the session shape.

## Status

**Done** — 2026-05-10. Landed as:

- Routes plugin extension: [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — `GET /sessions/:id` registered alongside the existing `POST /sessions` and `GET /sessions` routes. Path-param schema validates `id` as a UUID; visibility-gated parameterized SQL mirrors the list endpoint's WHERE clause; snake_case → camelCase via the existing `sessionRowToResponse` helper; bare `SessionResponse` body (no wrapper).
- Vitest unit tests: [`apps/server/src/sessions/routes.test.ts`](../../../apps/server/src/sessions/routes.test.ts) — extended with the `GET /sessions/:id` describe block (7 cases): authenticated + visible → 200; no auth → 401; unknown id → 404; private not visible → 404 (NOT 403); private visible to host → 200; private visible to participant → 200; non-UUID → 400.
- Cucumber+pglite scenarios: [`tests/behavior/backend/get-session.feature`](../../../tests/behavior/backend/get-session.feature) (3 scenarios) with step defs at [`tests/behavior/steps/backend-get-session.steps.ts`](../../../tests/behavior/steps/backend-get-session.steps.ts). Successful fetch; private not visible → 404; unknown id → 404.
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 760 → 767 (+7); Cucumber 140 → 143 (+3).
