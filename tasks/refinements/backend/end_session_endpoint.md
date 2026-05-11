# `POST /sessions/:id/end` — moderator ends the debate session

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.session_management.end_session_endpoint`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `backend.api_skeleton` — settled (HTTP server, error handling, OpenAPI, request logging).
- `backend.auth` — settled (`app.authenticate` decorator + `request.authUser` shape).
- `backend.session_management.create_session_endpoint` — settled (`apps/server/src/sessions/routes.ts` plus `SessionResponse` schema, `sessionRowToResponse`, the `withTransaction` helper).
- `backend.session_management.get_session_endpoint` — settled (the visibility WHERE clause this task lifts).
- `data_and_methodology.schema.sessions_table` — settled (`ended_at TIMESTAMPTZ NULL`).
- `data_and_methodology.schema.session_events_table` — settled (event log; `UNIQUE (session_id, sequence)` constraint).
- `data_and_methodology.event_types.session_lifecycle_events` — settled (`sessionEndedPayloadSchema = { ended_at: ISO8601 }`).
- `data_and_methodology.event_types.event_validation` — settled (`validateEvent` server-side wrapper).

## What this task is

Fourth sibling under `backend.session_management`. Lands `POST /sessions/:id/end` — the moderator (the host at v1) issues a POST to a specific session id, and the server flips the row's `ended_at` from NULL to NOW() AND emits a `session-ended` event into the per-session event log at the next sequence — atomically, in a single transaction. Returns 200 + the updated `SessionResponse` (with `endedAt` populated).

The artifact shape:

- `apps/server/src/sessions/routes.ts` — extend the existing plugin with `POST /sessions/:id/end`. Reuses `sessionResponseRef`, `sessionRowToResponse`, `withTransaction`, the visibility-gated SELECT, and the `validateEvent`-before-INSERT pattern.
- `apps/server/src/sessions/routes.test.ts` — extend the existing Vitest unit suite with the new endpoint's cases.
- `tests/behavior/backend/end-session.feature` + `tests/behavior/steps/backend-end-session.steps.ts` — new files.

## Why it needs to be done

Three downstream consumers wait on this:

- **Replay and history endpoints (`backend.replay_endpoints`).** The `session-ended` event is the deliberate end-of-show marker the projection and replay primitives use to recognise a session has reached its terminal state. Without this endpoint there's no way to land a `session-ended` event into a real session's log, so replay can't observe the lifecycle transition.
- **Moderator UI — "End session" button.** The console's session-detail view needs an action that ends the show; this is its server contract.
- **`session_listing_filters` (`?status=ended`).** Already implemented as a query-param filter on `GET /sessions`, but until this endpoint lands no session can transition into the `ended` half of the filter through API surface.

## Inputs / context

From [`apps/server/migrations/0002_sessions.sql`](../../../apps/server/migrations/0002_sessions.sql):

- `ended_at TIMESTAMPTZ NULL` — null while the session is active; set to `NOW()` when this endpoint runs. Once set, the row's other columns are immutable from this endpoint's perspective.

From [`apps/server/migrations/0010_session_events.sql`](../../../apps/server/migrations/0010_session_events.sql):

- `UNIQUE (session_id, sequence)` constraint — enforces per-session monotonicity at the DB layer. The MAX+1 allocator inside the transaction relies on this for safety.
- `kind = 'session-ended'` — already in the CHECK list.

From [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — the canonical `session-ended` payload schema:

```ts
export const sessionEndedPayloadSchema = z.object({
  ended_at: z.string().datetime({ offset: true }),
});
```

So the envelope's `payload` is `{ ended_at: <iso-8601> }` — the ISO-8601 string of the moment the session ended. Single field, mirroring the `sessions.ended_at` column.

From [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts):

- `sessionResponseSchema` / `sessionResponseRef` / `SESSION_RESPONSE_SCHEMA_ID` — the canonical per-session shape this endpoint returns (with `endedAt` populated post-mutation).
- `sessionRowToResponse(row)` — snake_case → camelCase mapper; reused unchanged.
- `withTransaction(pool, fn)` — the BEGIN/COMMIT/ROLLBACK helper. Two code paths (production `pg.Pool` with `connect()`; test pglite adapter via direct `pool.query`); reused unchanged.
- `sessionIdParamsSchema` — the `:id` UUID JSON Schema; reused for this route's `schema.params`.
- The visibility-gate SELECT from `GET /sessions/:id` — lifted verbatim (inside the transaction) for the existence-non-leak property.

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts):

- `ApiError.notFound(...)` — 404 with `code: 'not-found'`. Used for both "id doesn't exist" and "exists but not visible to the caller" — the existence-non-leak rule (mirrored from `get_session_endpoint`).
- `ApiError(403, 'not-a-moderator', ...)` — chosen for the authority-failure 403 (see Decisions below). `not-a-moderator` already exists in the `RejectionReason` union and maps to 403 via `statusCodeForRejection`.
- `ApiError.conflict(...)` — 409 — but THIS endpoint uses a more discriminating `code: 'session-already-ended'` to differentiate idempotency from a generic conflict. The handler constructs `new ApiError(409, 'session-already-ended', ...)` directly (the factory helper is convenience, not a constraint).

From [`apps/server/src/events/validate.ts`](../../../apps/server/src/events/validate.ts) — `validateEvent(envelope)` runs the two-stage envelope + payload parse and throws a typed `EventValidationError` on failure. We pass the freshly-constructed envelope through it before INSERT so the schema-on-write invariant holds.

From [ADR 0020](../../../docs/adr/0020-postgres-write-path-locking-and-event-ordering.md) — "application-managed monotonic sequence per session": the appender reads `MAX(sequence)` for the session and INSERTs at `MAX+1`. The MAX-then-INSERT pair MUST happen inside a single transaction so the `UNIQUE (session_id, sequence)` constraint catches concurrent writers; a racing writer that committed first would surface as a unique-violation error here and the loser's transaction rolls back. For v1 this endpoint is the only writer to a given session's `session-ended` slot, but the methodology engine's future event-append helper will share this pattern — get it right here so the pattern is settled.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest covers pure handler logic + Fastify `.inject()` cases; Cucumber+pglite covers the end-to-end transactional write against the migrated schema.

## Constraints / requirements

- **Endpoint**: `POST /sessions/:id/end`.
- **Auth**: required. `preHandler: app.authenticate`; 401 `auth-required` on any failure mode (middleware-owned).
- **Path param** (JSON Schema `schema.params`): UUID-shaped `id` — Fastify validator rejects non-UUID with 400 `validation-failed`. Reuses the same `sessionIdParamsSchema` constant declared for `GET /sessions/:id`.
- **No request body.** The endpoint is action-on-resource; the only input is the path-param id and the caller's identity from the auth cookie. `schema.body` is omitted.
- **Visibility-then-authority ordering** — the handler MUST run the visibility-gated SELECT first (404 short-circuit on invisible) BEFORE checking authority (403 on non-host). The existence-non-leak rule is load-bearing: a 403 on an invisible private session would leak the session's existence to a caller who isn't entitled to know it exists.
- **Idempotency**: re-ending an already-ended session returns **409**, NOT 200. The response carries `code: 'session-already-ended'`. Rationale below in Decisions.
- **Transactional row + event are atomic.** A single transaction:

  ```text
  BEGIN
    -- Visibility-gated SELECT for the existence-non-leak property AND
    -- to capture the host_user_id for the authority check (avoids a
    -- second round trip). FOR UPDATE locks the row against concurrent
    -- end-session attempts on the same session.
    SELECT id, host_user_id, ended_at FROM sessions
      WHERE id = $1
        AND (privacy = 'public' OR host_user_id = $2
             OR EXISTS (SELECT 1 FROM session_participants sp
                        WHERE sp.session_id = sessions.id AND sp.user_id = $2))
      FOR UPDATE;
    -- Zero rows → ROLLBACK + throw 404. Row found but host_user_id != caller → ROLLBACK + throw 403.
    -- Row found, host matches, but ended_at IS NOT NULL → ROLLBACK + throw 409 session-already-ended.

    UPDATE sessions SET ended_at = NOW() WHERE id = $1
      RETURNING id, host_user_id, privacy, topic, created_at, ended_at;

    -- Application-managed monotonic sequence. The MAX-then-INSERT pair
    -- is inside the transaction so the UNIQUE (session_id, sequence)
    -- constraint catches concurrent writers; a racing transaction that
    -- committed at MAX+1 first would force this transaction to fail
    -- the unique check and ROLLBACK.
    SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM session_events WHERE session_id = $1;
    -- nextSeq = max_seq + 1

    -- Build envelope { id, sessionId, sequence: nextSeq, kind: 'session-ended',
    --                 actor: hostUserId, payload: { ended_at: <iso-from-RETURNING> },
    --                 createdAt: <iso-clock> }.
    -- validateEvent(envelope) — throws EventValidationError if any drift.

    INSERT INTO session_events (id, session_id, sequence, kind, actor, payload)
      VALUES (..., $1, nextSeq, 'session-ended', $host, $payload::jsonb);
  COMMIT
  ```

  On any error after BEGIN: ROLLBACK and re-throw. The error handler renders the canonical envelope.

- **`FOR UPDATE` row lock** — the visibility-gated SELECT acquires a row lock on the `sessions` row so concurrent end-session attempts serialize. Without the lock, two transactions both seeing `ended_at IS NULL` could both proceed to UPDATE; the UPDATE itself is idempotent (NOW() overwrites NOW()) but the per-session event log would get two `session-ended` events at adjacent sequences — wrong by methodology. With the lock the second transaction waits, then re-reads `ended_at IS NOT NULL` after the first commits, and short-circuits to 409 cleanly. The lock is released on COMMIT/ROLLBACK.

- **`session-ended` event payload validation runs before INSERT.** Construct the full envelope, call `validateEvent(envelope)` from `apps/server/src/events/validate.ts`, then INSERT. Same schema-on-write contract as `session-created` (per the create-endpoint refinement) — every row in `session_events` is structurally valid by construction.

- **Response shape** (returned 200 + JSON body): a single `SessionResponse` object with the now-populated `endedAt`. Bare (NOT wrapped) — the endpoint's resource IS the session. camelCase via `sessionRowToResponse`.

- **Status codes**:
  - 200 — successful end. `endedAt` is the ISO-8601 string of `NOW()` at UPDATE time.
  - 400 — `:id` is not a UUID (`validation-failed` envelope).
  - 401 — unauthenticated (`auth-required` envelope, emitted by the auth middleware).
  - 403 — authenticated, visible, but the caller is not the host (`not-a-moderator` envelope).
  - 404 — session does not exist OR exists but is not visible to the caller (`not-found` envelope, single phrasing for both branches).
  - 409 — session already ended (`session-already-ended` envelope) — NOT idempotent.
  - 500 — DB error or unhandled exception.

- **Test layers per ADR 0022**:
  - **Vitest** — 8 cases: host ends session → 200 + endedAt populated (response shape); host ends session → BOTH the UPDATE and the event INSERT recorded via the memory shim (transactional shape); non-host → 403; non-participant on private session → 404 (invisibility); already-ended → 409; unknown id → 404; bad UUID → 400; no auth → 401. The success case is split into two assertions (response shape vs. transactional shape) mirroring the pattern the create-session test suite established — each case pins one observable property cleanly.
  - **Cucumber+pglite** — 4 scenarios: host ends session → 200 + assert `ended_at IS NOT NULL` in `sessions` AND the `session-ended` event lands at sequence=2 (the second event after `session-created` from the create-session step); non-host → 403; already-ended → 409; unknown id → 404.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; new cases bring the total from 767 to 775 (+8).
- `pnpm run test:behavior:smoke` (Cucumber) green; new feature adds 4 scenarios (143 → 147).
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- Generated OpenAPI document at `/docs/json` lists `POST /sessions/{id}/end` tagged `sessions` with the `cookieAuth` security requirement and a 200 response referencing `SessionResponse`.

## Decisions

- **Host-only authority; reuse `not-a-moderator` as the 403 code.** Two alternatives surveyed:
  - **`not-a-moderator`** (chosen). The `RejectionReason` union already includes `not-a-moderator` (mapped to 403 by `statusCodeForRejection`). At v1 the host IS the moderator — the architecture's "moderator" role is held by the session's host. Reusing the existing code keeps the rejection vocabulary stable across the methodology engine (which uses `not-a-moderator` for commit-authority failures) and the session-management surface (which uses it here for end-authority). When the future participant_assignment task introduces explicit moderator role assignment, the semantics of `not-a-moderator` widen naturally — any non-moderator participant fails this check; the response shape doesn't change.
  - **New `not-the-host`** (rejected). Would add a discriminator the client can branch on for "you are not the host of THIS session specifically" vs. the engine's "you do not hold the moderator role." But at v1 the two are the same person, so the discriminator carries no information; introducing it pre-emptively forks the vocabulary for a distinction that doesn't yet exist. If a future task splits host from moderator (e.g. "the host can transfer moderation to another participant"), revisit at that point.

- **Visibility-then-authority ordering — 404 before 403.** The same existence-non-leak rule the get-endpoint refinement settles. Two alternatives surveyed:
  - **Run the visibility-gated SELECT first; 404 on zero rows; only then check `host_user_id === caller`** (chosen). Mirrors `get_session_endpoint`. A non-participant probing a private session id sees 404 — same response as for a nonexistent id; the session's existence isn't leaked.
  - **Check authority first; 403 on non-host regardless of visibility** (rejected). Would tell an unauthorized caller "you are not the host" for a session whose existence is private to them. Same information-leak failure mode `get_session_endpoint` rejected.

- **Already-ended → 409 (`session-already-ended`), NOT idempotent 200.** Two alternatives surveyed:
  - **409 with discriminating code** (chosen). Ending a session is a real state transition that emits an event into the log. Re-ending would either (a) silently no-op the UPDATE and skip the event (the response would lie — the body says "I ended this" but no log entry corresponds), or (b) write a second `session-ended` event at the next sequence (corrupting the methodology — the projection sees two end-of-show events, the second one referring to a session that has already ended). Neither alternative is correct. The 409 forces the client to recognise the prior state and react (refresh, show a "this session already ended" notice) rather than silently desync. The discriminating code `session-already-ended` is more useful than the generic `conflict` — clients can branch on the specific failure without parsing the message string.
  - **Idempotent 200 + skip the event write** (rejected). The session row's `endedAt` would match the original end timestamp, not the re-end attempt's wall clock — a polling client might see this as "the session ended just now" when in fact it ended hours ago. The lie is small per call, but the methodology principle (event log is the source of truth; every state transition emits one event) is what makes the system replayable; preserving idempotency here would break replay semantics.

- **Inside-transaction MAX+1 sequence allocation pattern.** Three alternatives surveyed:
  - **`SELECT COALESCE(MAX(sequence), 0) FROM session_events WHERE session_id = $1` then INSERT at MAX+1; both inside the same transaction; rely on the `UNIQUE (session_id, sequence)` constraint** (chosen). This is exactly ADR 0020's "application-managed monotonic sequence per session" rule. The MAX-read sees the highest committed sequence (the visibility-gated SELECT...FOR UPDATE earlier in the transaction acquired a row lock that prevents concurrent end-session attempts, but the unique constraint is the ultimate guard — a racing transaction that committed at MAX+1 first would force this transaction's INSERT to fail and ROLLBACK, surfaced to the operator as a 5xx). For v1 this endpoint is the only writer of `session-ended` to a given session, but the pattern is settled here for the methodology engine's future event-append helper.
  - **Postgres SEQUENCE per session** (rejected). Sequences are global to a session, not per-session-id; we'd need one `CREATE SEQUENCE` per session (unbounded sequence churn) or one global sequence (violates the per-session monotonicity property). Architecturally wrong fit.
  - **Application-side counter cached in memory** (rejected). The server is a horizontally scalable surface; an in-memory counter would diverge across replicas. A future memcached/redis allocator would centralise it but adds an external dependency for a property the DB already provides.

- **`FOR UPDATE` on the visibility-gated SELECT.** Without the row lock, two concurrent end-session attempts could both pass the visibility + authority checks (both saw `ended_at IS NULL`) and both proceed to UPDATE + INSERT. The UNIQUE constraint would still catch the duplicate sequence INSERT on the loser, but only AFTER the loser's UPDATE already overwrote the winner's `NOW()`. The `FOR UPDATE` serialises the two transactions cleanly — the second waits, sees the post-commit `ended_at IS NOT NULL`, and short-circuits to 409. Small correctness improvement; large semantic clarity.

- **Reuse `SessionResponse` schema; bare (not wrapped) body.** Same decision as `get_session_endpoint` — the endpoint's resource IS the session. The post-mutation body carries the same shape as the get endpoint; the only difference is `endedAt` is now a string instead of null.

- **No body schema; action-on-resource POST.** The endpoint takes no request payload. `schema.body` is omitted (Fastify treats this as "any body, including none"). A client that sends a JSON body has it silently ignored — the right behavior; the action is the URL + method + the auth cookie.

- **`actor = host_user_id` on the `session-ended` event.** Consistent with `session-created`. The host is the causal actor of both lifecycle events at v1.

- **`payload.ended_at` is the `RETURNING ended_at`'s ISO-8601 string (the DB's wall-clock NOW()), NOT the handler's `Date.now()`.** The UPDATE's RETURNING surfaces the same NOW() the DB wrote into the row; the event payload mirrors it so the projection layer's "session.endedAt == event.payload.ended_at" invariant holds. The handler's `nowFn()` is reserved for the envelope's `createdAt` (which is server-clock at handler-entry; cosmetically close to but not necessarily identical to the DB's NOW(), and the projection layer reads `created_at` from the column not the payload — so a slight skew is harmless).

## Open questions

- **Re-open / un-end an ended session** — out of scope for v1. The architecture document doesn't describe a path back from `ended_at IS NOT NULL` to `IS NULL`. If a future product decision adds an "I ended this by mistake" affordance, the endpoint shape would be `POST /sessions/:id/reopen` with its own event kind (`session-reopened` — new entry in the kind enum) and its own authority check. Not blocked by this task.
- **Notify connected WebSocket subscribers** — the methodology engine's broadcast layer (`ws_event_broadcast`) will pick up the `session-ended` event and push it to subscribers, but THAT task is downstream; this endpoint only writes the event. The wiring lands when both endpoints exist.
- **End-of-show diagnostics emission** — the methodology engine's `methodology_not_exhausted` diagnostic may want to fire on end if there are unresolved proposals. Out of scope here; the diagnostic engine consumes the projection, not this endpoint's transaction.

## Status

**Done** — 2026-05-10. Landed as:

- Routes plugin extension: [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — `POST /sessions/:id/end` registered alongside the existing session-management routes. Path-param schema validates `id` as a UUID; visibility-gated `SELECT ... FOR UPDATE` mirrors `GET /sessions/:id`'s WHERE clause and acquires the row lock that serialises concurrent end attempts; authority check (`host_user_id === caller` else 403 `not-a-moderator`); idempotency check (`ended_at IS NOT NULL` else 409 `session-already-ended`); UPDATE flips `ended_at` to NOW() and RETURNs the full row; MAX-then-INSERT allocator computes `nextSeq = MAX(sequence) + 1` inside the transaction; envelope passes `validateEvent`; `session-ended` event INSERTs at `nextSeq`; transaction commits and the camelCase `SessionResponse` returns. Bare body (no wrapper).
- Vitest unit tests: [`apps/server/src/sessions/routes.test.ts`](../../../apps/server/src/sessions/routes.test.ts) — extended with the `POST /sessions/:id/end` describe block (8 cases): host ends → 200 + endedAt populated (response shape); host ends → BOTH UPDATE and event INSERT recorded via memory shim + trace shows BEGIN…COMMIT (transactional shape); non-host → 403 + ROLLBACK; non-participant on private → 404 (invisibility precedes authority); already-ended → 409 + ROLLBACK; unknown id → 404; bad UUID → 400; no auth → 401. Memory shim extended to handle `UPDATE sessions ... SET ended_at = NOW() RETURNING ...` and `SELECT COALESCE(MAX(sequence), 0)` queries; the existing visibility-gated SELECT pattern absorbs the new `FOR UPDATE` clause via the same predicate-match.
- Cucumber+pglite scenarios: [`tests/behavior/backend/end-session.feature`](../../../tests/behavior/backend/end-session.feature) (4 scenarios) with step defs at [`tests/behavior/steps/backend-end-session.steps.ts`](../../../tests/behavior/steps/backend-end-session.steps.ts). Host ends → 200 + `ended_at` non-null in `sessions` AND session-ended event lands at sequence=2 (since the create-session step seeded sequence=1's session-created); non-host → 403 with `ended_at` unchanged; already-ended → second-call 409; unknown id → 404. Exercises the visibility + authority gates AND the transactional UPDATE + INSERT chain end-to-end against the real migrated schema.
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 767 → 775 (+8); Cucumber 143 → 147 (+4).
