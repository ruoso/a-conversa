# `POST /sessions/:id/participants` + `DELETE /sessions/:id/participants/:userId` — assign and remove session participants

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.session_management.participant_assignment`
**Effort estimate**: 1d
**Inherited dependencies**:

- `backend.api_skeleton` — settled (HTTP server, error handling, OpenAPI, request logging).
- `backend.auth` — settled (`app.authenticate` decorator + `request.authUser` shape).
- `backend.session_management.create_session_endpoint` — settled (`apps/server/src/sessions/routes.ts` plus `SessionResponse` schema, `sessionRowToResponse`, the `withTransaction` helper). **Amended by this task** (the host is now joined into the session as the implicit moderator at creation time — see Decisions).
- `backend.session_management.get_session_endpoint` — settled (the visibility-gated SELECT this task lifts).
- `backend.session_management.end_session_endpoint` — settled (the FOR UPDATE + MAX(sequence)+1 pattern this task reuses).
- `data_and_methodology.schema.session_participants_table` — settled ([0003_session_participants.sql](../../../apps/server/migrations/0003_session_participants.sql)).
- `data_and_methodology.schema.session_events_table` — settled (`UNIQUE (session_id, sequence)`).
- `data_and_methodology.event_types.session_lifecycle_events` — settled (`participantJoinedPayloadSchema`, `participantLeftPayloadSchema`).
- `data_and_methodology.event_types.event_validation` — settled (`validateEvent` server-side wrapper).

## What this task is

Sixth sibling under `backend.session_management`. Lands the two endpoints that assign and remove participants within a session:

- `POST /sessions/:id/participants` — host-only invite. Body: `{ userId: UUID, role: 'debater-A' | 'debater-B' }`. INSERTs a `session_participants` row and emits a `participant-joined` event at `MAX(sequence)+1`, atomically.
- `DELETE /sessions/:id/participants/:userId` — host OR self removal. UPDATEs the active `session_participants` row's `left_at = NOW()` and emits a `participant-left` event at `MAX(sequence)+1`, atomically. The moderator (the host at v1) cannot be removed by this endpoint.

This task **also amends `create_session_endpoint`'s transactional body** to insert the host as a `session_participants` row with `role = 'moderator'` AND emit a `participant-joined` event at sequence=2 alongside the existing `session-created` event at sequence=1. The amendment closes a methodology gap: the engine's `commit_logic` walks `currentParticipants(projection)` (populated from `participant-joined` events) and would observe an empty set on a freshly-created session until someone explicitly joined the host. Implicit join eliminates that no-participants state.

The artifact shape:

- `apps/server/src/sessions/routes.ts` — amended `POST /sessions` handler (host joined as moderator) + new `POST /sessions/:id/participants` and `DELETE /sessions/:id/participants/:userId` routes registered alongside the existing session-management routes.
- `apps/server/src/sessions/routes.test.ts` — updated create-session test (asserts +1 participant-joined event AND +1 session_participants row); new participant-assignment describe block (12 cases).
- `tests/behavior/backend/participant-assignment.feature` + `tests/behavior/steps/backend-participant-assignment.steps.ts` — new files (5 scenarios).
- `apps/server/src/methodology/types.ts` — `RejectionReason` union extended with `role-already-filled`, `user-already-joined`, `user-not-found`, `cannot-remove-moderator`.
- `apps/server/src/errors.ts` — `statusCodeForRejection` mapping extended for the four new codes.

## Why it needs to be done

Three downstream consumers wait on this:

- **Methodology engine — `commit_logic`** walks `currentParticipants(projection)` for the unanimous-agree check. Without a way to populate the participants set, no commit ever succeeds (the unanimous check over an empty set is methodologically meaningful but vacuously true — a state we want to disallow by structurally requiring at least the host-as-moderator).
- **WebSocket subscription — `ws_auth_on_connect`** resolves "is this user a participant?" against the `session_participants` table. Without an assignment surface, only the host can ever be a participant — debaters have no path in.
- **Moderator UI — "Invite a debater" affordance** needs a server contract; this is it.

## Inputs / context

From [`apps/server/migrations/0003_session_participants.sql`](../../../apps/server/migrations/0003_session_participants.sql):

- `role TEXT NOT NULL CHECK (role IN ('moderator', 'debater-A', 'debater-B'))`.
- Partial unique index `session_participants_active_role_idx` on `(session_id, role) WHERE left_at IS NULL` — at most one active occupant per role per session.
- Partial unique index `session_participants_active_user_idx` on `(session_id, user_id) WHERE left_at IS NULL` — a user can hold at most one active role in a session at a time.
- Leave-and-rejoin = new row (F5). Setting `left_at` on the old row releases both partial unique indexes; a fresh INSERT can take the same `(session_id, user_id)` or `(session_id, role)` slot.

From [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts):

```ts
export const participantJoinedPayloadSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['moderator', 'debater-A', 'debater-B']),
  screen_name: z.string(),
  joined_at: z.string().datetime({ offset: true }),
});

export const participantLeftPayloadSchema = z.object({
  user_id: z.string().uuid(),
  left_at: z.string().datetime({ offset: true }),
});
```

The join payload carries the screen name (denormalized into the event for replay-without-user-join queries); the leave payload omits it (the join event already records it).

From [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts):

- `withTransaction(pool, fn)` — reused unchanged.
- `sessionIdParamsSchema` — reused for the participant routes' `:id` param.
- The visibility-gated `SELECT ... FOR UPDATE` pattern from `POST /sessions/:id/end` — lifted verbatim.
- `MAX(sequence)+1` allocator inside the transaction — lifted verbatim.

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts) — the `statusCodeForRejection` switch is exhaustive over `RejectionReason`; the four additive reasons land here too.

From [ADR 0020](../../../docs/adr/0020-postgres-write-path-locking-and-event-ordering.md) — application-managed monotonic sequence per session; MAX-then-INSERT MUST be inside the same transaction so the `UNIQUE (session_id, sequence)` constraint catches concurrent writers.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest covers pure handler logic; Cucumber+pglite covers the end-to-end write against the migrated schema.

## Constraints / requirements

- **Endpoints**:
  - `POST /sessions/:id/participants` — body `{ userId: UUID, role: 'debater-A' | 'debater-B' }`. **Does not accept `'moderator'`** — reserved for the host and assigned implicitly at session creation.
  - `DELETE /sessions/:id/participants/:userId` — no body. Host or self only.

- **Auth**: required on both. `preHandler: app.authenticate`; 401 `auth-required` on any failure mode.

- **Path params**: UUID-shaped `:id` and (on DELETE) UUID-shaped `:userId`. Fastify validator rejects non-UUID with 400 `validation-failed`.

- **Body schema for POST** (JSON Schema, `additionalProperties: false`):

  ```jsonc
  {
    "type": "object",
    "required": ["userId", "role"],
    "additionalProperties": false,
    "properties": {
      "userId": { "type": "string", "format": "uuid" },
      "role": { "type": "string", "enum": ["debater-A", "debater-B"] }
    }
  }
  ```

  The enum **deliberately excludes `'moderator'`** — the moderator role is bound to the host at session creation and cannot be re-assigned via this endpoint. Sending `'moderator'` fails Fastify's enum validation with 400 `validation-failed`. (A future task that introduces moderator reassignment can widen the enum; for v1 the host IS the moderator for the session's lifetime.)

- **Visibility-then-authority-then-state ordering** — mirrors the end-session endpoint:
  1. Visibility-gated SELECT ... FOR UPDATE on the session (public OR host OR participant). Zero rows → 404 `not-found` (existence-non-leak).
  2. Authority check: POST requires `host_user_id === caller` else 403 `not-a-moderator`. DELETE requires `host_user_id === caller` OR `params.userId === caller` else 403 `not-a-moderator`.
  3. Lifecycle check: `ended_at IS NOT NULL` → 409 `session-already-ended`.
  4. Body/state-specific checks (see below).

- **POST endpoint specifics**:
  - Validate `userId` exists in `users` AND `deleted_at IS NULL`. Zero rows → 404 `not-found` (`user-not-found` code; see Decisions for code choice).
  - Validate the role isn't already filled (no row with `(session_id, role) WHERE left_at IS NULL`). Filled → 409 `role-already-filled`.
  - Validate the user isn't already an active participant (no row with `(session_id, user_id) WHERE left_at IS NULL`). Filled → 409 `user-already-joined`.
  - INSERT the new `session_participants` row.
  - Compute `nextSeq = MAX(sequence) + 1` for the session.
  - Build the `participant-joined` envelope (payload includes the joined user's `screen_name`, looked up alongside the existence check).
  - `validateEvent(envelope)` → INSERT the event row.
  - Return 200 + camelCase `{ id, sessionId, userId, role, joinedAt, leftAt }`.

- **DELETE endpoint specifics**:
  - Find the active row (`session_id = $1 AND user_id = $2 AND left_at IS NULL`). Zero rows → 404 `not-found` (the user is not currently in the session; identical-shape response to the unknown-session case).
  - Block removing the moderator: if the active row's `role = 'moderator'`, return 403 `cannot-remove-moderator`. The host/moderator is bound to the session for its lifetime; departures are not part of v1.
  - UPDATE the row's `left_at = NOW()` RETURNING `left_at`.
  - Compute `nextSeq = MAX(sequence) + 1`.
  - Build the `participant-left` envelope.
  - `validateEvent(envelope)` → INSERT the event row.
  - Return 200 + camelCase `{ id, sessionId, userId, role, joinedAt, leftAt }` (the updated row, with `leftAt` now an ISO string).

- **Transactional shape (load-bearing)**. Both endpoints wrap the SELECT ... FOR UPDATE + state checks + write(s) + MAX + INSERT inside a single transaction via `withTransaction`. On any error after BEGIN: ROLLBACK and re-throw. The error handler renders the canonical envelope.

- **`create_session_endpoint` amendment**:
  - Inside the existing transaction, AFTER the `session-created` event INSERT at sequence=1:
    1. INSERT a `session_participants` row: `(session_id = new id, user_id = host_user_id, role = 'moderator')`. The DB fills `joined_at = NOW()` and `id`.
    2. SELECT the host's `screen_name` from `users` (or pass it through `request.authUser.screenName`, which the middleware already populated — cheaper).
    3. Build the `participant-joined` envelope at sequence=2 with payload `{ user_id, role: 'moderator', screen_name, joined_at }`.
    4. `validateEvent` → INSERT the event row.
  - The handler still returns 201 + the camelCase `SessionResponse` — no shape change on the response. Only the internal write set grows.

- **`RejectionReason` extensions** — additive, four new values:
  - `role-already-filled` → 409 (conflict — the role slot is occupied by an active participant).
  - `user-already-joined` → 409 (conflict — the user already holds an active role).
  - `user-not-found` → 404 (the `userId` in the body doesn't resolve to a non-deleted user; mirrors the existence-non-leak surface for users).
  - `cannot-remove-moderator` → 403 (authority — removing the moderator is not permitted; the host owns the session for its lifetime).

  Adding these to the union forces `statusCodeForRejection` to extend; the exhaustiveness check catches any future drift.

- **Response shape (POST and DELETE)** — a new `SessionParticipantResponse` schema:

  ```ts
  {
    id: UUID,
    sessionId: UUID,
    userId: UUID,
    role: 'moderator' | 'debater-A' | 'debater-B',
    joinedAt: ISO8601,
    leftAt: ISO8601 | null,
  }
  ```

  Declared once in routes.ts with `$id: 'SessionParticipantResponse'` so OpenAPI carries a single `components.schemas` entry both endpoints reference.

- **Status codes**:
  - 200 — successful assignment or removal.
  - 400 — body or path-param validation failure (`validation-failed`); includes the case of `role: 'moderator'` in the body.
  - 401 — unauthenticated.
  - 403 — POST: caller is not the host. DELETE: caller is neither host nor self; or attempt to remove the moderator (`cannot-remove-moderator`).
  - 404 — session not found / not visible; user not found; participant not currently in session.
  - 409 — `role-already-filled` / `user-already-joined` / `session-already-ended`.
  - 500 — DB error or unhandled exception.

- **Test layers per ADR 0022**:
  - **Vitest** — extends `apps/server/src/sessions/routes.test.ts` with a participant-assignment describe block (12 cases) AND updates the create-session "writes BOTH" assertion to also expect the participant-joined event at sequence=2 + a session_participants row for the host.
  - **Cucumber+pglite** — `tests/behavior/backend/participant-assignment.feature` (5 scenarios) exercising the full transactional shape against the migrated schema.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; new cases bring the total from 783 to 795 (+12). The create-session existing tests are tightened (no count change) to assert the +1 event and +1 participant row.
- `pnpm run test:behavior:smoke` (Cucumber) green; new feature adds 5 scenarios (150 → 155). The existing create-session scenario's sequence-1 event assertion still passes (the participant-joined event lands at sequence=2 — no impact). The existing end-session scenario's "sequence 2 with kind session-ended" assertion becomes "sequence 3 with kind session-ended" (the participant-joined now sits at sequence=2); update its expectation accordingly.
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

## Decisions

- **Option A — implicit moderator at session creation (chosen).** Two alternatives surveyed:
  - **Implicit moderator** (chosen). The create-session transaction also inserts a `session_participants` row with role='moderator' for the host AND emits a `participant-joined` event at sequence=2. Pro: matches the architecture's "session has exactly one moderator" invariant; ergonomic (no extra round-trip before the host can act); the methodology engine's `currentParticipants(projection)` always returns a non-empty set on an active session. Con: the create-endpoint transaction grows from two writes (sessions + session-created) to four (sessions + session-created + session_participants + participant-joined) — but they're all consequences of the same logical operation (creating the session), so atomicity preserves the invariant rather than violating it.
  - **Explicit join** (rejected). The host would have to POST to the participant-assignment endpoint to assign themselves as moderator. Forks the methodology engine's state space — between session-create and explicit-join, a session exists with zero participants, which the engine treats as a no-op-able state. The complexity per call is small; the complexity per replay (reconstructing a sensible "current participants" set at arbitrary log positions) is larger.

- **Role enum on the POST body excludes `'moderator'`.** Two alternatives surveyed:
  - **Exclude `'moderator'` at the schema layer; reject with 400 `validation-failed`** (chosen). The role is bound to the host for the session's lifetime; the schema enforces this structurally. A client that sends `role: 'moderator'` gets a clean 400 with the Ajv issue identifying the enum mismatch.
  - **Accept `'moderator'` at the schema layer; reject with a typed 409 / 422 in the handler** (rejected). Pushes the invariant from the schema into application code; harder to discover from the OpenAPI document; the typed code wouldn't carry more information than the schema rejection.

- **`role-already-filled` and `user-already-joined` are two distinct 409 codes.** Two alternatives surveyed:
  - **Two distinct codes** (chosen). The two failure modes have different remediation: `role-already-filled` means "this role slot is occupied — remove or re-assign the current occupant first"; `user-already-joined` means "this user is already a participant in some role — they can't hold two roles." A client surfacing them to the moderator UI would phrase them differently. Keeping the codes typed lets the client branch without parsing the message.
  - **Single `conflict` code with a discriminator in the body** (rejected). Forces the client to parse the body's `details` to discover which constraint fired; harder to type at the client; loses the affordance of the typed `RejectionReason` enum.

- **`user-not-found` is 404, not 400.** Two alternatives surveyed:
  - **404** (chosen). Mirrors the get-session existence-non-leak pattern: an unknown user id collapses to "not found" rather than a body-validation failure. The UUID itself is well-formed (Fastify's schema validator already passed it); the failure is at the entity-existence layer, which 404 owns.
  - **400 `validation-failed`** (rejected). Fastify's validator only checks shape (UUID format); existence is an application-level check, not a body-validation failure. Conflating the two would hide the actual failure under a generic 400.

- **`cannot-remove-moderator` is 403, not 422.** Two alternatives surveyed:
  - **403** (chosen). The moderator-binding is an authority rule ("the host owns this seat for the session's lifetime"). Authority failures live at 403 in this codebase (`not-a-moderator`, `not-a-participant`, etc.). Keeps the vocabulary consistent.
  - **422 `unprocessable-entity`** (rejected). 422 is "the request shape is fine, the methodology forbids this state transition" — accurate but overlapping with 403's authority semantics; choosing 403 keeps the rejection-reason → status mapping flatter.

- **DELETE accepts host OR self.** Two alternatives surveyed:
  - **Host OR self** (chosen). A participant who wants to leave should be able to leave without asking the moderator's permission; a moderator should be able to remove a participant (e.g. to swap a debater). Mirrors typical chat / call-room semantics.
  - **Host only** (rejected). Forces a participant who wants to leave to ask the host; over-restrictive for v1.

- **Leave-and-rejoin is "new row" (F5), not "clear left_at on the old row".** Already settled by the session_participants_table refinement. The DELETE here sets `left_at`; a future POST to assign the same user (or someone else) to the same role INSERTs a fresh row.

- **`participant-joined` payload carries `screen_name` (denormalized).** Two alternatives surveyed:
  - **Carry `screen_name` in the payload** (chosen). The shared-types schema requires it; replaying the log to "what was the participant's display name at the moment they joined" without joining `users` is what the field is for. The handler looks up the screen name as part of the user-existence check (same query) so no extra round-trip.
  - **Reference-only payload `{ user_id, role, joined_at }`** (rejected). Drift from the shared-types schema; would fail `validateEvent` on the way to INSERT.

- **`participant-left` payload is `{ user_id, left_at }` only.** Already settled by the shared-types schema. No role in the payload — the role-at-leave-time is reconstructible from the matching `participant-joined` event in the log.

- **DELETE returns 200 + the updated participant row, not 204 No Content.** Two alternatives surveyed:
  - **200 + updated row** (chosen). The body lets the client confirm the `leftAt` timestamp without re-fetching. Mirrors the end-session endpoint's "200 + session row with endedAt populated."
  - **204 No Content** (rejected). Cheaper in bytes; loses the affordance of carrying the canonical `leftAt`. The size argument is rounding error for a UUID-and-timestamp payload.

- **`SessionParticipantResponse` schema is declared once and shared by both endpoints.** Same factoring as `SessionResponse` — single OpenAPI entry, single source of truth for the response shape.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-10. Landed as:

- Routes plugin extension: [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — `POST /sessions/:id/participants` (host-only debater assignment) and `DELETE /sessions/:id/participants/:userId` (host or self removal) registered alongside the existing session-management routes. Both endpoints use `withTransaction` with the visibility-gated `SELECT ... FOR UPDATE` + state checks + writes + MAX(sequence)+1 + INSERT chain; both pass envelopes through `validateEvent` before insert. New `SessionParticipantResponse` schema declared with `$id: 'SessionParticipantResponse'` and referenced by both endpoints; new `participantRowToResponse` mapper handles snake_case → camelCase translation. The body schema for POST excludes `'moderator'` from the role enum (structural-rejection at the validator layer).
- **`POST /sessions` amendment** — the create-session transaction now writes four rows in a single BEGIN/COMMIT: the sessions row, the session-created event at sequence=1, the `session_participants` row with role='moderator' for the host, AND the `participant-joined` event at sequence=2 (per Option A). The handler uses `request.authUser.screenName` to populate the participant-joined payload's `screen_name` field (no extra round-trip).
- `RejectionReason` extensions: [`apps/server/src/methodology/types.ts`](../../../apps/server/src/methodology/types.ts) adds `role-already-filled`, `user-already-joined`, `user-not-found`, `cannot-remove-moderator`. [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts) extends `statusCodeForRejection` to map the four new codes (409 / 409 / 404 / 403 respectively). [`apps/server/src/errors.test.ts`](../../../apps/server/src/errors.test.ts) tightened to cover the additions (+4 rows in the parameterized mapping table and the exhaustiveness-guard `allReasons` record).
- Vitest unit tests: [`apps/server/src/sessions/routes.test.ts`](../../../apps/server/src/sessions/routes.test.ts) — existing "writes BOTH" assertion tightened to expect the new participant-joined event at sequence=2 + the moderator participant row (no count change, behavior change only); new participant-assignment describe blocks add 12 cases (7 POST + 5 DELETE) exercising the full success and rejection matrix against the memory shim. Memory shim extended with matchers for `INSERT INTO session_participants`, the role / user availability pre-checks, and the `UPDATE ... SET left_at = NOW()` UPDATE.
- Cucumber+pglite scenarios: [`tests/behavior/backend/participant-assignment.feature`](../../../tests/behavior/backend/participant-assignment.feature) (5 scenarios) with step defs at [`tests/behavior/steps/backend-participant-assignment.steps.ts`](../../../tests/behavior/steps/backend-participant-assignment.steps.ts). Exercises the auto-landed moderator row + participant-joined event, the dual debater assignment at consecutive sequences, the non-host authority rejection, the already-filled-role rejection, and the participant-removal write chain.
- Adjacent feature touch-ups for the create-session amendment ripple: [`tests/behavior/backend/end-session.feature`](../../../tests/behavior/backend/end-session.feature)'s "session-ended at sequence 2" assertion bumped to "sequence 3" (participant-joined now occupies sequence=2); [`tests/behavior/backend/session-privacy.feature`](../../../tests/behavior/backend/session-privacy.feature)'s "session_events table has 1 rows" assertion bumped to 2 (the extra participant-joined event).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 783 → 799 (+16 — 12 new participant-assignment cases + 4 new RejectionReason mapping cases in `errors.test.ts`); Cucumber 150 → 155 (+5 — five new participant-assignment scenarios).
