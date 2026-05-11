# `POST /sessions` — create a debate session

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.session_management.create_session_endpoint`
**Effort estimate**: 1d
**Inherited dependencies**:

- `backend.api_skeleton` — settled (HTTP server, error handling, OpenAPI, request logging).
- `backend.auth` — settled (`app.authenticate` decorator + `request.authUser` shape).
- `data_and_methodology.schema.sessions_table` — settled ([0002_sessions.sql](../../../apps/server/migrations/0002_sessions.sql)).
- `data_and_methodology.schema.session_events_table` — settled ([0010_session_events.sql](../../../apps/server/migrations/0010_session_events.sql)).
- `data_and_methodology.event_types.session_lifecycle_events` — settled (`sessionCreatedPayloadSchema` in `packages/shared-types`).
- `data_and_methodology.event_types.event_validation` — settled (`validateEvent` server-side wrapper in `apps/server/src/events/validate.ts`).

## What this task is

First sibling under `backend.session_management`. Lands `POST /sessions` — an authenticated user POSTs a topic (and optionally a privacy setting), the server inserts a new row into `sessions` AND emits the corresponding `session-created` event into `session_events` atomically, and returns the created session in camelCase.

The endpoint is the entry point to the rest of the session-management surface — `GET /sessions/:id`, `POST /sessions/:id/end`, the privacy-toggle endpoint, participant assignment, and the WebSocket subscribe-to-session handshake all key off rows this endpoint creates.

The artifact shape:

- `apps/server/src/sessions/routes.ts` — Fastify plugin registering `POST /sessions` (and a barrel to grow into as siblings land).
- `apps/server/src/sessions/routes.test.ts` — Vitest unit tests against a memory-backed pool shim.
- `tests/behavior/backend/create-session.feature` + `tests/behavior/steps/backend-create-session.steps.ts` — Cucumber + pglite scenarios exercising the full transactional write against the migrated schema.
- `apps/server/src/server.ts` registers the new plugin after the auth middleware.
- `apps/server/src/openapi.ts` already declares the `sessions` tag; the new route attaches it. A reusable `SessionResponse` schema is exported from `routes.ts` so future session endpoints reference one definition rather than redeclaring the shape.

## Why it needs to be done

Three downstream consumers wait on this:

- **Every sibling under `backend.session_management`** — `list_sessions_endpoint`, `get_session_endpoint`, `end_session_endpoint`, `session_privacy_toggle`, `participant_assignment` — operates on rows this endpoint creates. Without it the row supply is zero and the rest of the surface has nothing to read.
- **`backend.websocket_protocol.ws_subscribe_to_session`** — the WS subscribe handshake requires a session id the caller can authenticate against; the id originates here.
- **`data_and_methodology.replay_primitive` / projection** — the projection's `project_from_log` consumes `session_events` rows. Without the `session-created` event landing in the log at sequence=1, replay has no anchor for the session's lifecycle. This endpoint is the first writer into `session_events` for any session.

## Inputs / context

From [`apps/server/migrations/0002_sessions.sql`](../../../apps/server/migrations/0002_sessions.sql):

- `id UUID PK DEFAULT gen_random_uuid()` — server fills it; the caller never supplies a UUID.
- `host_user_id UUID NOT NULL REFERENCES users(id)` — from `request.authUser.id` (the authenticated user becomes host).
- `privacy TEXT NOT NULL DEFAULT 'public' CHECK (privacy IN ('public','private'))` — body default `'public'`.
- `topic TEXT NOT NULL` — body required; constrained at the API layer (1..256 chars).
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` — server fills it.
- `ended_at TIMESTAMPTZ NULL` — null on creation; flipped by `end_session_endpoint` later.

From [`apps/server/migrations/0010_session_events.sql`](../../../apps/server/migrations/0010_session_events.sql) and [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts):

- `kind = 'session-created'` — already in the CHECK list.
- `sequence` — application-managed, monotonic per session; for a brand-new session the first event is `sequence = 1` (no MAX-select needed).
- `actor` — `host_user_id` (the user who created the session).
- `payload` — JSONB matching `sessionCreatedPayloadSchema`:

  ```ts
  z.object({
    host_user_id: z.string().uuid(),
    privacy: z.enum(['public', 'private']),
    topic: z.string(),
    created_at: z.string().datetime({ offset: true }),
  });
  ```

  Note: the payload is **snake_case** (matches the SQL column names and the cross-workspace `@a-conversa/shared-types` schema). The HTTP response body is **camelCase** (matches the existing API conventions — `{ userId, screenName }` on `/auth/me`, `{ hostUserId, ... }` here). The two cases serve different audiences and stay separated.

From [`apps/server/src/auth/middleware.ts`](../../../apps/server/src/auth/middleware.ts):

- `app.authenticate` preHandler decorator — attached to the route options. On success it populates `request.authUser = { id, screenName }`; on any failure mode it throws `ApiError(401, 'auth-required', ...)`.

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts) — `ApiError.badRequest(...)` and the catalog of factories. Body-validation failures fall through Fastify's schema validator to the centralized error handler, which renders `{ error: { code: 'validation-failed', message, issues } }`.

From [`apps/server/src/events/validate.ts`](../../../apps/server/src/events/validate.ts) — `validateEvent(envelope)` runs the two-stage envelope + payload parse and throws a typed `EventValidationError` on failure. We pass the freshly-constructed envelope through it before INSERT so the schema-on-write invariant holds (every row in `session_events` is structurally valid by construction).

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest covers pure handler logic + Fastify `.inject()` cases; Cucumber+pglite covers the end-to-end transactional write against the migrated schema.

## Constraints / requirements

- **Endpoint**: `POST /sessions`.
- **Auth**: required (`preHandler: app.authenticate`). The middleware fires before the handler; on any failure the route is short-circuited with a 401 `auth-required` envelope.
- **Body shape** (JSON Schema, attached to `schema.body` so Fastify's validator runs it and any failure is caught by the existing 400 `validation-failed` branch in `error-handler.ts`):

  ```jsonc
  {
    "type": "object",
    "required": ["topic"],
    "additionalProperties": false,
    "properties": {
      "topic": { "type": "string", "minLength": 1, "maxLength": 256 },
      "privacy": { "type": "string", "enum": ["public", "private"] }
    }
  }
  ```

  - `topic` required; 1..256 chars (lower bound rejects empty strings; the upper bound is a defensive cap — `sessions.topic` is TEXT with no DB-level length cap, but 256 is the platform's documented soft ceiling, plenty for "the topic of a debate" with margin for any reasonable formulation).
  - `privacy` optional; defaults to `'public'` server-side when absent. Enum-constrained at the schema layer so the DB CHECK constraint is never reachable from a well-formed request.

- **Transactional shape (load-bearing)**. The session row insert AND the `session-created` event insert MUST happen in a single transaction:

  ```text
  BEGIN
    INSERT INTO sessions (host_user_id, privacy, topic) VALUES (...) RETURNING id, host_user_id, privacy, topic, created_at, ended_at;
    -- Build the envelope from the returned row.
    -- validateEvent(envelope) — throws EventValidationError if drift between this code and shared-types.
    INSERT INTO session_events (session_id, sequence, kind, actor, payload, created_at)
      VALUES ($1, 1, 'session-created', $host_user_id, $payload::jsonb, $created_at);
  COMMIT
  ```

  On any error after BEGIN, ROLLBACK and re-throw. The error handler renders the canonical envelope. The two writes are atomic — a partial state where the row exists but the event log doesn't, or vice versa, is impossible.

- **Why sequence=1 hard-coded**. A brand-new session has no prior events; the first event is sequence=1 by construction. There is no MAX-select to run, no race against a concurrent writer (the row doesn't exist yet, so no other event can already reference it). The `UNIQUE (session_id, sequence)` constraint is the safety net; failing it here would mean a programmer bug, not a concurrency hazard.

- **`session-created` payload validation MUST run before INSERT**. Construct the full envelope (`id, sessionId, sequence, kind, actor, payload, createdAt`), call `validateEvent(envelope)` from `apps/server/src/events/validate.ts`, then INSERT. The validator catches any drift between this handler's payload construction and the shared-types `sessionCreatedPayloadSchema` at the earliest possible moment — the event-log invariant ("every row is structurally valid") holds because every writer runs the same gate. The validator's `id` and `sessionId` fields must be UUIDs; since `gen_random_uuid()` produced them on the sessions row insert, this is well-formed by construction, but the call costs ~10µs and pays back the first time someone changes the payload shape without re-running the validator.

- **Response shape** (returned 201 + JSON body):

  ```json
  {
    "id": "<uuid>",
    "hostUserId": "<uuid>",
    "privacy": "public" | "private",
    "topic": "<string>",
    "createdAt": "<iso-8601>",
    "endedAt": null
  }
  ```

  - All fields camelCase. `endedAt` is null on creation (the row's `ended_at` column is null).
  - The `id` is the server-generated UUID returned via `INSERT ... RETURNING`.
  - The `createdAt` is the server-clock timestamp `NOW()` produced by the DB at insert time, returned via the same RETURNING clause and serialized to ISO-8601.

- **`SessionResponse` schema is exported**. Declared once in `apps/server/src/sessions/routes.ts` as a top-level JSON Schema constant (`sessionResponseSchema`); attached to the route's `schema.response[201]` slot. Future session endpoints (`GET /sessions/:id`, `POST /sessions/:id/end`, the privacy-toggle endpoint) import the same constant rather than re-declaring the shape. Drift between writer and reader is caught at compile time.

- **Status codes**:
  - 201 — successful creation.
  - 400 — body validation failure (`validation-failed` envelope, emitted by `error-handler.ts`'s Fastify-validation branch).
  - 401 — unauthenticated (`auth-required` envelope, emitted by the auth middleware).
  - 500 — DB error or unhandled exception (canonical 500 envelope; the transaction is rolled back).

- **Module shape**:
  - `apps/server/src/sessions/routes.ts` — `sessionsRoutesPlugin` (Fastify plugin), `SESSION_RESPONSE_SCHEMA_ID`, `sessionResponseSchema`, `__buildTestSessionsApp` (test helper mirroring `__buildTestAuthApp`).
  - `apps/server/src/sessions/routes.test.ts` — Vitest unit suite.
  - `apps/server/src/server.ts` — registers `sessionsRoutesPlugin` after the auth middleware and OIDC routes.

- **Pool injection contract** — same shape as the auth-routes plugin. Production registers with `{}` and the plugin reaches for `getDefaultPool()` lazily on first request; tests pass a memory-backed shim (Vitest) or a pglite-backed adapter (Cucumber).

- **Test layers per ADR 0022**:
  - **Vitest** in `apps/server/src/sessions/routes.test.ts` — 5 cases: valid body + auth → 201 + correct response shape; no auth → 401 (middleware wiring); body missing topic → 400; topic too long → 400; invalid privacy → 400. The DB shim records both the sessions and session_events inserts so the test can assert both writes landed.
  - **Cucumber+pglite** in `tests/behavior/backend/create-session.feature` — 3 scenarios: successful creation (full transactional shape — assert the response shape, then SELECT the sessions row, then SELECT the session_events row and assert sequence=1 + payload); default privacy when omitted; empty topic rejected.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; new `apps/server/src/sessions/routes.test.ts` adds 5 cases (744 → 749).
- `pnpm run test:behavior:smoke` (Cucumber) green; new `tests/behavior/backend/create-session.feature` adds 3 scenarios (133 → 136).
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- Generated OpenAPI document at `/docs/json` lists `POST /sessions` tagged `sessions` with the `cookieAuth` security requirement and a 201 response referencing the `SessionResponse` schema.

## Decisions

- **Body schema is JSON Schema (TypeBox-shaped), not Zod.** Three alternatives surveyed:
  - **Plain JSON Schema attached to `schema.body`** (chosen). Fastify validates the body against it at the `validatorCompiler` layer; failures land at the centralized error-handler's `validation-failed` branch unchanged. No new validator dependency; matches what `POST /auth/screen-name` does. Validation feedback for the client carries the full Ajv issue list under `error.issues`.
  - **Zod via `fastify-type-provider-zod`** (rejected for now). Would give us inferred TypeScript types from the schema, but introduces a workspace-level dependency on the type provider plus a setValidatorCompiler wiring step in `createServer`. The api_skeleton refinement deferred picking a type provider until "the first route that actually validates a request body" — `POST /auth/screen-name` already validates without a type provider, and so does this one. Whoever lands the first route that needs body-schema-typed handlers can revisit; for the present surface, plain JSON Schema is sufficient and consistent.
  - **Hand-rolled validation in the handler** (rejected). N copies of "is this a string? what about its length?" across N future session endpoints. The 400 envelope contract is owned by the error handler; the validator's job is to throw the right shape so the handler catches it.

- **Privacy default `'public'` applied server-side, not in the JSON Schema.** Three alternatives surveyed:
  - **Server-side default** (chosen). The handler reads `body.privacy ?? 'public'`. Keeps the schema reflective of the wire contract (the client sends what they send; the schema describes what the server accepts); the server's policy ("public by default") is expressed in handler code where the cross-cutting concern lives. Mirrors what the DB does (`DEFAULT 'public'` on the column).
  - **JSON Schema `default: 'public'`** (rejected). Ajv reads `default` keywords but Fastify's defaults configuration is opt-in (`useDefaults: true`) and changing that across the server is out-of-scope for this task; the surface remains explicit at the handler layer.
  - **Required field** (rejected). Forces every client to think about privacy on every session creation. The architecture is "public by default; the host may mark a session private" — that asymmetry is the platform's policy and should be expressed by allowing the field to be omitted.

- **Transactional row + event are atomic (BEGIN / INSERT sessions / INSERT session_events / COMMIT).** Three alternatives surveyed:
  - **Single transaction** (chosen). The two writes constitute one logical operation. A partial state — row without event, or vice versa — would corrupt every downstream consumer (replay starts from sequence=1 by assumption; project_from_log would crash on a missing first event; the audit log would show a session that never had a creation event). The transaction guarantees the invariant.
  - **Sequential inserts without a transaction** (rejected). Cheap in tooling cost, expensive in failure cost — any error between the two inserts leaves the system in an unrecoverable state.
  - **Event-first, row-derived** (rejected). The architecture sees the event log as the source of truth, and a future redesign might project sessions from the event log on every read. For v1 the projection caches `sessions` as a denormalized table; both must land together regardless of which one is the "writer."

- **`session-created` payload uses snake_case (matching shared-types).** Three alternatives surveyed:
  - **snake_case** (chosen). The cross-workspace `sessionCreatedPayloadSchema` defines the fields as `host_user_id`, `privacy`, `topic`, `created_at` — matching the SQL column names. The events.ts header documents this as a deliberate "field names mirror the projection columns so the event payload reads as the source of truth and the projection is a pure copy." We honor that here; the HTTP response (camelCase) is a separate concern owned by the API surface, not the event log.
  - **camelCase to match response** (rejected). Would require a separate Zod schema for the wire payload distinct from the shared-types schema, doubling the surface and inviting drift.
  - **Two payloads (one for log, one for wire)** (rejected). Same drift problem, made explicit.

- **`validateEvent` is called before INSERT, not after**. Three alternatives surveyed:
  - **Validate before INSERT** (chosen). The validator catches any drift between the handler's payload construction and the shared-types schema at the earliest moment; the INSERT either lands a valid row or doesn't run at all. Failures during the in-transaction validation roll back the BEGIN. This is the schema-on-write invariant ADR 0021 documents.
  - **Validate after INSERT** (rejected). The row is already in the log when the validator fires; rolling back is harder (the transaction has to be open across the validator, which is what we already do — so this alternative reduces to "validate twice").
  - **Skip validation, trust the handler** (rejected). Defeats the point of shared-types; a typo in the payload construction here would silently produce an invalid row that breaks `project_from_log` only at replay time.

- **`sequence = 1` is hard-coded for this endpoint.** A brand-new session has no prior events; no MAX-select is needed; no race against a concurrent writer is possible (the row didn't exist before the BEGIN). Future endpoints that append to existing sessions will do `MAX(sequence)+1` inside their own transactions per the methodology-engine pattern; this endpoint is special-cased by virtue of being the session's first event.

- **`actor = host_user_id` on the `session-created` event.** The user who creates the session is the actor of the creation event. Semantically clear; consistent with the audit-trail view that every event has a causal actor. (A future system-generated event might have `actor = NULL`, which the schema allows; this endpoint never produces such an event.)

- **Response shape is camelCase `{ id, hostUserId, privacy, topic, createdAt, endedAt }`.** Mirrors `/auth/me`'s `{ userId, screenName }` convention. The DB row's `host_user_id` becomes `hostUserId`; `created_at` becomes `createdAt`; `ended_at` becomes `endedAt`. Future session endpoints reuse the same `SessionResponse` schema by reference.

- **`SessionResponse` schema declared once in `routes.ts`, registered into Fastify's schema store via `app.addSchema`.** Three alternatives surveyed:
  - **Top-level schema with `$id: 'SessionResponse'`, registered once** (chosen). Future endpoints reference it via `{ $ref: 'SessionResponse#' }`. The `refResolver` in `openapi.ts` preserves `$id` as the `components.schemas` key, so the OpenAPI document carries a single `SessionResponse` entry that every session endpoint's documentation points at.
  - **Inline schema per route** (rejected). N copies of the same shape; drift waiting to happen.
  - **A separate schemas module** (rejected for now). Premature factoring for one shape; if the surface grows past three or four shared schemas we can extract a `sessions/schemas.ts` then.

- **DB pool injection contract mirrors `authRoutesPlugin`**. The plugin accepts `{ pool?: DbPool }` (and `{ now?: () => number }` if a deterministic clock is needed for the `created_at` payload — kept available for hermetic tests but production reads `Date.now()`). Production registers with `{}`; tests pass a memory shim (Vitest) or a pglite-backed adapter (Cucumber).

- **The plugin is `fastify-plugin`-wrapped.** Required because the plugin attaches the route to a scope whose `app.authenticate` decorator was registered in a sibling plugin (`authenticatePlugin`). Without `fp(...)`, the route would live in a nested scope where the decorator's visibility depends on registration order — `fp(...)` makes the registration explicit and scope-safe.

- **Validation-failure body code is `validation-failed` (already the error-handler's wiring).** The Fastify validator throws an error carrying `err.validation` (array); the centralized handler classifies and emits `{ error: { code: 'validation-failed', message, issues } }`. No new code path; this endpoint reuses the contract every body-validating endpoint shares.

## Open questions

- **Topic length cap**. 256 is the API-layer ceiling chosen here as a defensive bound. The `sessions.topic` column is TEXT with no DB-level cap. A future product-side review may settle on a smaller display-friendly ceiling (e.g. 140 for tweet-style brevity); raising it would be a backward-compatible relaxation, lowering it would be a breaking change. Tracking as a follow-up, not a blocker.

- **Per-session sequence allocator for future endpoints**. This endpoint hard-codes `sequence = 1` because it's the first event of a new session. Future endpoints (`POST /sessions/:id/end`, WebSocket propose/vote/commit) need `MAX(sequence)+1`-in-transaction allocation. That pattern will land with the methodology engine's event-append helper; this endpoint pre-empts none of that surface.

- **`x-request-id` propagation into the event log**. Today `session_events.created_at` is the only audit field beyond `actor`. A future audit task may add a `request_id` column (or stash it in the payload) so an event row can be correlated back to the HTTP request that produced it. Out of scope here; called out so the audit-log task knows where the bridge would land.

## Status

**Done** — 2026-05-10. Landed as:

- Routes plugin: [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — `sessionsRoutesPlugin` registers `POST /sessions` behind `preHandler: app.authenticate`. The handler opens a transaction (production `pg.Pool.connect()`-based; tests pglite-direct BEGIN/COMMIT via `withTransaction`), INSERTs the session row, builds the `session-created` envelope, runs `validateEvent` (the schema-on-write gate), INSERTs the event at sequence=1 with `actor=host_user_id`, and COMMITs. Returns 201 + camelCase response.
- `SessionResponse` schema declared at top-level of routes.ts as `sessionResponseSchema` with `$id: 'SessionResponse'`; the `refResolver` in `openapi.ts` preserves the id so the generated document carries `components.schemas.SessionResponse`. Future session endpoints `$ref` it via `sessionResponseRef`.
- Server bootstrap: [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) — `sessionsRoutesPlugin` registered after the auth middleware and OIDC routes.
- Vitest unit tests: [`apps/server/src/sessions/routes.test.ts`](../../../apps/server/src/sessions/routes.test.ts) — 9 cases across three describe blocks (success / auth gate / body validation), exercising the in-memory `pg.Pool`-style adapter with `connect()` so the production transaction code path runs in the unit layer.
- Cucumber+pglite scenarios: [`tests/behavior/backend/create-session.feature`](../../../tests/behavior/backend/create-session.feature) (3 scenarios) with step defs at [`tests/behavior/steps/backend-create-session.steps.ts`](../../../tests/behavior/steps/backend-create-session.steps.ts). Exercise the full transactional write against the migrated schema — assert response shape AND SELECT both `sessions` row + `session_events` row at sequence=1 with the canonical `session-created` payload.
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 744 → 753 (+9); Cucumber 133 → 136 (+3).
