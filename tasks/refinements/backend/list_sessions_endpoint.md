# `GET /sessions` — list visible debate sessions

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.session_management.list_sessions_endpoint`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `backend.api_skeleton` — settled (HTTP server, error handling, OpenAPI, request logging).
- `backend.auth` — settled (`app.authenticate` decorator + `request.authUser` shape).
- `backend.session_management.create_session_endpoint` — settled (`apps/server/src/sessions/routes.ts` plus the `SessionResponse` schema this task reuses).
- `data_and_methodology.schema.sessions_table` — settled ([0002_sessions.sql](../../../apps/server/migrations/0002_sessions.sql)).
- `data_and_methodology.schema.session_participants_table` — settled ([0003_session_participants.sql](../../../apps/server/migrations/0003_session_participants.sql)) — the visibility-gate join target.

## What this task is

Second sibling under `backend.session_management`. Lands `GET /sessions` — an authenticated user issues a GET; the server returns every session the caller is permitted to see, ordered `created_at DESC`.

The "permitted to see" rule applies the architecture's cross-session reference visibility ([docs/architecture.md, "Cross-session reference permissions"](../../../docs/architecture.md#cross-session-reference-permissions)):

- **Public sessions** — every authenticated user can see them. (The architecture says any authenticated user may *reference* a public session's graph; listing is the strictly weaker operation, so the same gate suffices.)
- **Private sessions** — only the host or a current/past participant (a row in `session_participants` for that user in that session) can see them.

This task lands the basic endpoint that returns the visible set. The sibling `backend.session_management.session_listing_filters` adds query-param filtering (by host, by participation, future status sub-filters, pagination) on top of this visibility gate; the visibility gate is the canonical "what can I see?" question and stays here.

The artifact shape:

- `apps/server/src/sessions/routes.ts` — extend the existing plugin with `GET /sessions`. Reuses the `SessionResponse` schema declared at top-level; adds a new `SessionListResponse` wrapper schema (with `$id`) so the array shape is shareable.
- `apps/server/src/sessions/routes.test.ts` — extend the existing Vitest unit suite with the new endpoint's cases (memory-backed pool shim with `sessions` and `session_participants` stores).
- `tests/behavior/backend/list-sessions.feature` + `tests/behavior/steps/backend-list-sessions.steps.ts` — Cucumber + pglite scenarios exercising the visibility gate against the migrated schema.

## Why it needs to be done

Two downstream consumers wait on this:

- **`backend.session_management.session_listing_filters`** depends directly on `list_sessions_endpoint` per the `.tji`. The filter endpoint refines the query params on top of the visibility-gated base query this task lands; without the gate, filters would have nothing to layer on.
- **Moderator-UI / participant-UI lobbies.** "Pick a session to join" needs a listing endpoint. Both UI surfaces (per `tasks/40-moderator-ui.tji` and `tasks/50-participant-ui.tji`) consume this list to render a session-picker.

## Inputs / context

From [docs/architecture.md — cross-session reference permissions](../../../docs/architecture.md#cross-session-reference-permissions):

> Sessions are public by default; the host may mark a session private. Reference rules follow:
>
> - Public session — any authenticated user can reference the session's nodes and edges in a new session.
> - Private session — only participants of the original session (or the host) can reference its nodes and edges.

Listing is the necessary prerequisite to "reference" (you can't reference what you don't know about), and the rule lifts cleanly: a user who is permitted to reference a session is permitted to see it in their list. The architecture's host-can-see-their-own-private-session implication is captured naturally — the host is always a participant by construction of `POST /sessions` (the sibling create endpoint inserts the host into `session_participants` is a *future* refinement; until then the host is captured by `sessions.host_user_id`). To keep the visibility rule robust against either implementation, the SQL gate ORs both signals: `host_user_id = $1 OR EXISTS (... session_participants ...)`.

From [`apps/server/migrations/0002_sessions.sql`](../../../apps/server/migrations/0002_sessions.sql):

- `id UUID PK`, `host_user_id UUID NOT NULL`, `privacy TEXT NOT NULL DEFAULT 'public'`, `topic TEXT NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `ended_at TIMESTAMPTZ NULL`.
- Partial index `sessions_public_idx ON (created_at DESC) WHERE privacy = 'public'` — the access path for the "all public sessions, newest first" half of the query.

From [`apps/server/migrations/0003_session_participants.sql`](../../../apps/server/migrations/0003_session_participants.sql):

- `(session_id, user_id, role, joined_at, left_at)` — the M-N join. Visibility considers "any row for this (session_id, user_id)" — historical (left) rows count, because once you were a participant you've seen the session's content. Today's row supply for `session_participants` is empty for `POST /sessions`-created sessions (the create endpoint doesn't yet auto-insert the host); the gate accommodates both pre- and post-host-participant-row futures via the OR.

From [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts):

- `sessionResponseSchema` / `sessionResponseRef` / `SESSION_RESPONSE_SCHEMA_ID` — the canonical per-session shape this endpoint returns inside an array.
- `sessionRowToResponse(row)` — the snake_case → camelCase mapper. Reused unchanged.
- `__buildTestSessionsApp(...)` — the Vitest helper that wires the auth middleware + the sessions routes plugin; the new tests extend the same helper.

From [`apps/server/src/auth/middleware.ts`](../../../apps/server/src/auth/middleware.ts) — `app.authenticate` preHandler decorator. On failure it throws `ApiError(401, 'auth-required', ...)` before the handler runs; the existing centralized error handler emits the canonical envelope.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest covers pure handler logic + Fastify `.inject()` cases; Cucumber+pglite covers the end-to-end query against the migrated schema.

## Constraints / requirements

- **Endpoint**: `GET /sessions`.
- **Auth**: required. `preHandler: app.authenticate`; 401 `auth-required` on any failure mode (middleware-owned).
- **Query string** (JSON Schema, attached to `schema.querystring`):

  ```jsonc
  {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "status": { "type": "string", "enum": ["active", "ended"] }
    }
  }
  ```

  - `status` optional. Absent → both active and ended sessions returned (no filter).
  - `'active'` → `WHERE ended_at IS NULL` applied to the visibility-filtered set.
  - `'ended'` → `WHERE ended_at IS NOT NULL` applied to the visibility-filtered set.
  - Sibling task `session_listing_filters` may extend the query-string surface (host filter, participant filter, pagination); this task lands the `status` toggle because it falls naturally out of the `ended_at IS NULL` lifecycle inference (see [the sessions_table refinement's "no explicit `status` column" decision](../data-and-methodology/sessions_table.md#decisions)) and the parameter is the cheapest possible follow-on to "show me my list."

- **Visibility rule (load-bearing)** — the canonical "what can I see?" gate, parameterized on `request.authUser.id`:

  ```sql
  WHERE privacy = 'public'
     OR host_user_id = $1
     OR EXISTS (
          SELECT 1 FROM session_participants sp
          WHERE sp.session_id = sessions.id AND sp.user_id = $1
        )
  ```

  Three signals (any-one suffices): public session; you are the host; you are/were a participant.

- **Ordering**: `ORDER BY created_at DESC`. Most-recently-created first. The partial index on `(created_at DESC) WHERE privacy = 'public'` covers the dominant access pattern; the OR-branches fall back to a sort but the result sets are small for any one user, so the cost is acceptable for v1. Sibling-task pagination (in `session_listing_filters`) is the cure for any future scale concern.

- **Response shape** — 200 + JSON body:

  ```json
  {
    "sessions": [
      { "id": "<uuid>", "hostUserId": "<uuid>", "privacy": "public" | "private",
        "topic": "<string>", "createdAt": "<iso-8601>", "endedAt": "<iso-8601>" | null }
    ]
  }
  ```

  Each array element is a `SessionResponse`; the wrapper schema `SessionListResponse` carries the `sessions` key.

- **Pagination intentionally deferred.** The endpoint returns ALL visible sessions in one response. `session_listing_filters` may add `?limit` / `?cursor` once the surface needs them; today's row supply is small (a single user's history) and the cost of one query is the floor. Marking this here so a future reader sees the deliberate scope split.

- **Status codes**:
  - 200 — successful query (possibly empty `sessions` array).
  - 400 — invalid query string (e.g. `?status=garbage` — Fastify's validator emits `validation-failed`).
  - 401 — unauthenticated (`auth-required` envelope, emitted by the auth middleware).
  - 500 — DB error or unhandled exception.

- **Module shape**:
  - `apps/server/src/sessions/routes.ts` — register `GET /sessions` in the existing `sessionsRoutesPlugin`. Add `SESSION_LIST_RESPONSE_SCHEMA_ID` + `sessionListResponseSchema` exports next to the per-session schema.
  - `apps/server/src/sessions/routes.test.ts` — extend the existing Vitest suite; the memory-backed pool shim gains a `session_participants` store and recognises the new SELECT.
  - `tests/behavior/backend/list-sessions.feature` + `tests/behavior/steps/backend-list-sessions.steps.ts` — new files.

- **Pool injection contract** — same as `POST /sessions`. The plugin already accepts `{ pool?: DbPool }`; nothing new at the registration layer.

- **Test layers per ADR 0022**:
  - **Vitest** — 7 cases extending the existing suite: authenticated → 200 + ordered list; no auth → 401; only-public for a no-history user; public + private-where-participant for a participant; hide private-where-not-a-participant; `?status=active` filters out ended; `?status=ended` returns only ended.
  - **Cucumber+pglite** — 4 scenarios: empty DB → empty list; two public sessions → both listed in DESC order; private NOT visible to non-participant; private IS visible to a participant.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; the new cases bring the total from 753 to 760 (+7).
- `pnpm run test:behavior:smoke` (Cucumber) green; new feature adds 4 scenarios (136 → 140).
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- Generated OpenAPI document at `/docs/json` lists `GET /sessions` tagged `sessions` with the `cookieAuth` security requirement and a 200 response referencing the `SessionListResponse` schema.

## Decisions

- **Visibility rule = public OR host OR participant.** Three alternatives surveyed:
  - **public OR host OR participant** (chosen). Lifts the architecture's "cross-session reference permission" rule cleanly to a listing context (listing is strictly weaker than reference; the same gate suffices). Host is captured by `sessions.host_user_id` AND by future participant-row supply — OR-ing both signals makes the gate robust to either implementation of participant-row population on session creation. Past participants (rows with `left_at IS NOT NULL`) remain visible because once you saw a session you've seen it; hiding it post-leave would surprise users and complicate replay/audit flows.
  - **public only; private requires explicit fetch** (rejected). Forces UI surfaces to maintain a per-user list of "private sessions I'm in" out-of-band. The platform's source of truth IS the join table; the listing endpoint reads from it directly.
  - **public + host only; private-participants must be invited via a separate flow** (rejected). Requires a separate "my sessions" endpoint or a session-listing query param that lifts the gate. Either way it's a second API surface for the same semantic question. The OR-gate covers both audiences with one query.

- **Visibility gate is parameterized SQL, not application-layer post-filter.** Two alternatives surveyed:
  - **SQL WHERE with `EXISTS` subquery** (chosen). The query returns exactly the visible rows; the handler never sees a forbidden session at all. Parameterized — `$1 = request.authUser.id`. No information leak. The `EXISTS` form (rather than a JOIN + DISTINCT) avoids row-duplication when a user has multiple historical participant rows for the same session (leave-and-rejoin produces multiple rows per the participants-table refinement's F5 decision).
  - **`SELECT * FROM sessions` followed by JS filter** (rejected). Wastes I/O at scale (every public session passes through the application even if only N visible), and inverts the source-of-truth: the SQL gate is the canonical answer, not "what the handler chose to keep."

- **`status` query param is included in THIS task, not deferred to `session_listing_filters`.** Two alternatives surveyed:
  - **Include `status`** (chosen). The lifecycle inference is documented in the sessions-table refinement ("no explicit `status` column — inferred from `ended_at IS NULL`"); the query param is a one-line WHERE extension and the cheapest possible follow-on to the visibility-gated SELECT. The task description explicitly lists it (`?status=active|ended`). The filters task can layer further filters on top without overlapping this one.
  - **Defer to filters task** (rejected). Would force the filters task to re-touch this endpoint immediately; better to land the natural pair (visibility + lifecycle toggle) here and let the filters task add the orthogonal axes (host filter, participant filter, pagination).

- **Response shape: `{ sessions: SessionResponse[] }`, NOT a raw array.** Three alternatives surveyed:
  - **`{ sessions: [...] }`** (chosen). The wrapper key gives the response a place to grow — pagination metadata (`nextCursor`, `total`), filter echo (`{ appliedFilters: ... }`), or operational metadata — without breaking the response contract. Mirrors common patterns in REST APIs that anticipate evolution. Clients destructure `{ sessions } = await fetch(...)` and ignore unknown sibling keys.
  - **Raw array `[...]`** (rejected). Forces a future pagination story to add a wrapper later, which is a breaking change. The marginal byte cost of the wrapper key is zero in practice.
  - **`{ data: [...] }`** (rejected). Generic-named wrapper key (JSON:API style) signals "this is some generic API"; `sessions` says "this is the sessions list" and reads better at call sites.

- **`SessionListResponse` schema declared with `$id`, registered into Fastify's schema store via `app.addSchema`.** Future endpoints that return a list-of-sessions shape (e.g. a future `GET /users/:id/sessions`, or the filters endpoint that may differentiate via a different path) reference it by `{ $ref: 'SessionListResponse#' }`. The `refResolver` in `openapi.ts` preserves `$id` as the `components.schemas` key.

- **Ordering is `created_at DESC` only.** No secondary sort key. The `sessions.id` is UUID v4 (no monotonic property), so tie-breaking on id is no-op-meaningful; in practice `created_at` is `TIMESTAMPTZ` at NOW() resolution and ties are astronomically unlikely for a single user's list. If/when the filters task adds pagination, a stable secondary sort (id) becomes necessary; today's API doesn't.

- **Pagination intentionally deferred.** Stated in task description; recorded here so a reader is not surprised. The sibling `session_listing_filters` is the right place; today's row supply per user is small (one user's session history) and a single round-trip is fine.

- **Empty `sessions` array on no matches.** No 404. The query "list your sessions" has a meaningful empty answer (a new user with no sessions). 404 is for "the resource itself does not exist"; the listing resource exists, and its current content is empty.

- **Past participants stay visible.** The `EXISTS` join does NOT filter on `left_at IS NULL`. Once a user has been a participant in a session, they retain visibility forever — this matches the audit/replay framing (a participant who left can still review the session they were in). The sibling filters task may add a future `?participant_active_only=true` filter if a use case for "only sessions I'm currently in" emerges.

## Open questions

- **Pagination strategy** — limit+offset vs. cursor (`created_at, id`). Deferred to `session_listing_filters`; the choice depends on the consumer (the lobby UI vs. an admin/audit surface).
- **Host filter ergonomics** — `?host=<userId>` or `?host=me`? Deferred to `session_listing_filters`.
- **Per-session participant role disclosure** — should the list carry "your role in this session" (moderator/debater-A/debater-B) so the UI can render badges without a follow-up fetch? Deferred — adds a join and a denormalized field; the simpler one-shot list is enough for v1.

## Status

**Done** — 2026-05-10. Landed as:

- Routes plugin extension: [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — `GET /sessions` registered alongside `POST /sessions`. Query-string schema, visibility-gated parameterized SQL, snake_case → camelCase mapping via the existing `sessionRowToResponse` helper, response wrapped in `{ sessions: [...] }` shape.
- `SessionListResponse` schema declared at top-level of routes.ts as `sessionListResponseSchema` with `$id: 'SessionListResponse'`; registered via `app.addSchema`. The `refResolver` in `openapi.ts` preserves the id so the generated document carries `components.schemas.SessionListResponse`.
- Vitest unit tests: [`apps/server/src/sessions/routes.test.ts`](../../../apps/server/src/sessions/routes.test.ts) — extended with the `GET /sessions` describe block (7 cases): authenticated → 200 + ordered list; no auth → 401; only-public for a no-history user; public + private-where-participant for a participant; hide private-where-not-a-participant; `?status=active` filters out ended; `?status=ended` returns only ended. The memory pool shim gains a `session_participants` store and recognises the visibility-gated SELECT.
- Cucumber+pglite scenarios: [`tests/behavior/backend/list-sessions.feature`](../../../tests/behavior/backend/list-sessions.feature) (4 scenarios) with step defs at [`tests/behavior/steps/backend-list-sessions.steps.ts`](../../../tests/behavior/steps/backend-list-sessions.steps.ts). Exercise the visibility gate against the migrated schema — assert response array length AND each entry's `id` matches an expected sessions-row id.
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 753 → 760 (+7); Cucumber 136 → 140 (+4).
