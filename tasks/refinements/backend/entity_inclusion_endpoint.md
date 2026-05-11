# `entity_inclusion_endpoint` — `POST /sessions/:id/include`: bring an existing global entity into a session

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.cross_session_permissions.entity_inclusion_endpoint`
**Effort estimate**: 1d
**Inherited dependencies**:

- `backend.cross_session_permissions.privacy_field_enforcement` — settled ([`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts)). Provides `visibilityWhereFragment(...)` and `canSeeSession(...)`. THIS endpoint uses the fragment for the destination-side visibility gate (the `SELECT ... FOR UPDATE` on the destination session).
- `backend.cross_session_permissions.reference_permission_check` — settled ([`apps/server/src/sessions/references.ts`](../../../apps/server/src/sessions/references.ts)). Provides `canReferenceNode / canReferenceEdge / canReferenceAnnotation`. THIS endpoint dispatches on `entityKind` and calls the matching predicate for the source-side reachability check.
- `backend.session_management.participant_assignment` — settled. The transactional shape (visibility-gated `SELECT ... FOR UPDATE` + state checks + write + `MAX(sequence)+1` + event INSERT + `validateEvent`) is the template; the `withTransaction` helper, the `visibilityWhereFragment`, and the schema-on-write gate land verbatim.
- `data_and_methodology.schema.session_nodes_join_table` / `session_edges_join_table` / `session_annotations_join_table` — settled ([0007](../../../apps/server/migrations/0007_session_nodes.sql) / [0008](../../../apps/server/migrations/0008_session_edges.sql) / [0009](../../../apps/server/migrations/0009_session_annotations.sql)). Composite-PK M-N join tables. THIS endpoint writes into the matching join table per `entityKind`.
- `data_and_methodology.event_types.entity_inclusion_events` — settled (`entityIncludedPayloadSchema` in [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts)). Payload shape: `{ entity_kind, entity_id, included_by, included_at }`.
- `data_and_methodology.event_types.event_validation` — settled (`validateEvent` server-side gate).

## What this task is

Third (and final) sibling under `backend.cross_session_permissions`. Lands the HTTP surface that composes the two predicates the previous two siblings produced — destination-side visibility (via `visibilityWhereFragment`) + source-side reachability (via `canReference<Kind>`) — into a single transactional write that brings an existing global entity (node, edge, or annotation) into a session as a fresh inclusion row + `entity-included` event.

The endpoint:

- `POST /sessions/:id/include` — body `{ entityKind: 'node' | 'edge' | 'annotation', entityId: UUID }`. Auth required.
- Destination session must be visible to the caller (404 if not — existence-non-leak).
- Caller must be an *active* participant of the destination session (403 `not-a-participant` if not).
- Destination session must not be ended (409 `session-already-ended` if so).
- Source entity must be referenceable by the caller — `canReference<Kind>` returns true (403 `entity-not-referenceable` if not).
- Entity must not already be in the destination session (409 `entity-already-included` if it is — checked via the composite-PK `ON CONFLICT DO NOTHING` collapse on the join-table INSERT).
- INSERT into `session_<kind>s` RETURNING the row.
- `MAX(sequence)+1` inside the transaction.
- Build the `entity-included` envelope, run `validateEvent`, INSERT into `session_events`.
- COMMIT.
- Return 200 + `{ entityKind, entityId, sessionId, includedBy, includedAt }`.

This endpoint is the last consumer the cross-session-permissions sub-stream produces; it closes the sub-stream. Future WS-include message handlers (planned, not yet refined) will share the same predicates but compose them differently — see "Boundary" in Decisions.

The artifact shape:

- `apps/server/src/sessions/routes.ts` — amended with the new `POST /sessions/:id/include` route registered alongside the existing session-management routes (see Decisions for the "extend routes.ts vs new module" call).
- `apps/server/src/sessions/routes.test.ts` — amended with a new `POST /sessions/:id/include` describe block (8 cases).
- `tests/behavior/backend/entity-inclusion.feature` + `tests/behavior/steps/backend-entity-inclusion.steps.ts` — NEW. 5 Cucumber+pglite scenarios.
- `apps/server/src/methodology/types.ts` — `RejectionReason` union extended additively with `entity-not-referenceable` and `entity-already-included`.
- `apps/server/src/errors.ts` — `statusCodeForRejection` mapping extended for the two new codes (403 / 409 respectively); `errors.test.ts` tightened.

## Why it needs to be done

Two downstream consumers wait on this:

- **Moderator / participant UI — "include an existing entity in this session" affordance** — when a debater wants to bring a node from a previous public session into the current debate (e.g. "remember the argument we accepted in session X — let's use it here"), this is the endpoint that lands the inclusion. Without it, every node/edge/annotation has to be re-created from scratch, defeating the architecture's first-class cross-session reference design.
- **Future WS-include message handler (planned)** — when the WebSocket protocol grows an "include this existing entity" message, it will route through the same predicates this endpoint composes (source-side `canReference<Kind>` + destination-side participant check). Today's HTTP endpoint pins the composition in code that's exercised under test; the WS handler will reuse the predicates.

The motivation is also closing the cross-session-permissions sub-stream: the privacy field enforces who-can-see-what (Sibling 1), the reference predicate enforces who-can-reference-what (Sibling 2), and THIS endpoint finally writes the inclusion event with full authority validation on both sides. The sub-stream isn't done until the write path exists.

## Inputs / context

From [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts) — `visibilityWhereFragment(userIdParamIndex)`. Used in the destination-side `SELECT ... FOR UPDATE` on `sessions` (the same predicate every session-management endpoint uses for visibility-then-authority-then-state ordering).

From [`apps/server/src/sessions/references.ts`](../../../apps/server/src/sessions/references.ts) — `canReferenceNode / canReferenceEdge / canReferenceAnnotation`. Each issues one parameterized `SELECT 1 ... LIMIT 1` against the matching join table joined to `sessions` with the visibility fragment. The endpoint dispatches on `entityKind` to the right predicate. The predicate runs INSIDE the transaction (using the same client) so the source-side check sees a consistent snapshot.

From [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts):

```ts
export const entityIncludedPayloadSchema = z.object({
  entity_kind: entityKindSchema, // 'node' | 'edge' | 'annotation'
  entity_id: z.string().uuid(),
  included_by: z.string().uuid(),
  included_at: z.string().datetime({ offset: true }),
});
```

The payload is identical-shape across all three entity kinds; `entity_kind` discriminates. The handler writes into the matching `session_<kind>s` table per the same discriminator (no schema-level difference in the event).

From [`apps/server/migrations/0007_session_nodes.sql`](../../../apps/server/migrations/0007_session_nodes.sql), [`0008_session_edges.sql`](../../../apps/server/migrations/0008_session_edges.sql), [`0009_session_annotations.sql`](../../../apps/server/migrations/0009_session_annotations.sql):

- Composite PK on `(session_id, <entity>_id)`.
- `included_by` UUID NOT NULL REFERENCES users (RESTRICT).
- `included_at` TIMESTAMPTZ NOT NULL DEFAULT NOW().
- No `removed_at` — the table is monotonic per R10 (an inclusion is forever).

The composite PK gives us free duplicate-prevention: a second INSERT for the same `(session_id, entity_id)` either rejects with `unique_violation` (raw) or no-ops under `ON CONFLICT DO NOTHING` (controlled). We use the latter and read `rowCount === 0` as the "already-included" signal.

From [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts):

- `withTransaction(pool, fn)` — reused unchanged. Two code paths (production pg.Pool with `connect()` / test pglite-shim with direct `pool.query`).
- `sessionIdParamsSchema` — reused for the `:id` UUID validation.
- `toIsoString(value)` — reused for the `included_at` payload field.
- The visibility-gated `SELECT ... FOR UPDATE` + state checks + write + `MAX(sequence)+1` + INSERT chain — lifted verbatim from `POST /sessions/:id/participants` (the closest structural sibling).

From [ADR 0020](../../../docs/adr/0020-postgres-write-path-locking-and-event-ordering.md) — application-managed monotonic sequence per session; MAX-then-INSERT inside the transaction; the `UNIQUE (session_id, sequence)` constraint is the safety net against concurrent appenders. The `FOR UPDATE` on the destination session row is the primary serialisation mechanism — concurrent inclusion attempts on the same destination session will block.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest covers pure handler logic against the memory shim; Cucumber+pglite covers the end-to-end write against the migrated schema.

## Constraints / requirements

- **Endpoint**: `POST /sessions/:id/include`.

- **Auth**: `preHandler: app.authenticate`; 401 `auth-required` on any failure mode.

- **Path params**: `:id` UUID-shaped. Fastify validator rejects malformed with 400 `validation-failed`.

- **Body schema** (JSON Schema, `additionalProperties: false`):

  ```jsonc
  {
    "type": "object",
    "required": ["entityKind", "entityId"],
    "additionalProperties": false,
    "properties": {
      "entityKind": { "type": "string", "enum": ["node", "edge", "annotation"] },
      "entityId": { "type": "string", "format": "uuid" }
    }
  }
  ```

  `entityKind` enum mirrors the SQL CHECK on `session_events.kind` (via the shared-types `entityKindSchema`); `entityId` UUID format is the same surface every UUID-typed body field uses across the session-management endpoints.

- **Authority stack (visibility → participant → lifecycle → reference → uniqueness)**:

  1. **Destination visibility**: visibility-gated `SELECT ... FOR UPDATE` on `sessions` (same predicate the sibling endpoints use). Zero rows → 404 `not-found` (existence-non-leak). Pulls `host_user_id` and `ended_at` for the next two checks.
  2. **Destination participation**: caller must be an *active* participant of the destination session. The SELECT against `session_participants WHERE session_id = $1 AND user_id = $2 AND left_at IS NULL LIMIT 1`. Zero rows → 403 `not-a-participant`. (The host is auto-joined as `moderator` at session-create per the participant-assignment Option-A amendment, so the host always satisfies this.)
  3. **Destination lifecycle**: `ended_at IS NOT NULL` → 409 `session-already-ended`. Reuses the vocabulary from the other session-management endpoints.
  4. **Source reachability**: call `canReference<Kind>(client, entityId, callerUserId)` per `entityKind`. False → 403 `entity-not-referenceable` (NEW reason; see Decisions for the 403-vs-404 call).
  5. **Uniqueness via ON CONFLICT collapse**: `INSERT INTO session_<kind>s ... ON CONFLICT DO NOTHING RETURNING id, session_id, <entity>_id, included_by, included_at`. `rowCount === 0` → 409 `entity-already-included` (NEW reason; see Decisions for 409-vs-200 idempotent).

  Each step short-circuits to the canonical error on failure; all checks run inside the same transaction so the destination session's state is consistent under the FOR UPDATE row lock.

- **Source predicate inside the transaction**: `canReference<Kind>` is called WITH the transaction client (the same `client` the FOR UPDATE acquired). This makes the source-side snapshot consistent with the destination-side snapshot — a row that was visible-via-public-origin at SELECT time stays referenceable through the INSERT step. The predicates accept any `VisibilityExecutor` so the production pg.PoolClient and the test pglite shim both satisfy it.

- **Join-table INSERT with `ON CONFLICT DO NOTHING RETURNING ...`**: the composite PK collapses the race condition between two concurrent inclusion attempts on the same `(session_id, entity_id)` pair into a single "second attempt sees zero rows" outcome. The handler reads `result.rows.length === 0` as "already included" and throws 409 `entity-already-included`. Compared to a separate pre-check SELECT, the `ON CONFLICT DO NOTHING` is both cheaper (one round trip vs two) and atomic (no race window between the pre-check and the INSERT). The pre-check would still leave the partial-unique check as the actual guard; we lean on the guard directly.

- **MAX(sequence)+1 inside the transaction**: lifted verbatim from `POST /sessions/:id/participants`. The FOR UPDATE row lock on the destination session row serialises concurrent inclusion attempts; the `UNIQUE (session_id, sequence)` constraint is the second-line guard for any non-FOR-UPDATE-locked concurrent writer (e.g. a future WS-message handler that bypasses the HTTP path).

- **Event envelope**: `kind: 'entity-included'`, `actor: callerUserId`, `payload: { entity_kind, entity_id, included_by: callerUserId, included_at: <iso from RETURNING> }`. The handler passes the envelope through `validateEvent` BEFORE the INSERT (schema-on-write invariant per ADR 0021).

- **`RejectionReason` extensions** — additive, two new values:

  - `entity-not-referenceable` → 403 (authority — caller cannot reach the entity through any visible origin session).
  - `entity-already-included` → 409 (conflict — the entity is already in this destination session; further inclusion attempts are a no-op-shaped conflict).

  Adding these to the union forces `statusCodeForRejection` to extend; the exhaustiveness check catches any future drift. `errors.test.ts`'s parameterized mapping table extends with two rows; the `allReasons` exhaustiveness-guard record extends with two keys.

- **Response shape** (200 only):

  ```ts
  {
    entityKind: 'node' | 'edge' | 'annotation',
    entityId: UUID,
    sessionId: UUID,
    includedBy: UUID,
    includedAt: ISO8601,
  }
  ```

  Declared as a new `EntityInclusionResponse` schema with `$id: 'EntityInclusionResponse'` so OpenAPI carries a single `components.schemas` entry. Mirrors the camelCase + ISO-8601 convention of `SessionResponse` and `SessionParticipantResponse`.

- **Status codes**:

  - 200 — successful inclusion (row + event written).
  - 400 — body or path-param validation failure (`validation-failed`).
  - 401 — unauthenticated (`auth-required`).
  - 403 — caller is not a participant of the destination session (`not-a-participant`) OR the entity is not referenceable by the caller (`entity-not-referenceable`).
  - 404 — destination session not found / not visible (`not-found`).
  - 409 — destination session is ended (`session-already-ended`) OR entity is already included in this session (`entity-already-included`).
  - 500 — DB error or unhandled exception.

- **Parameterized SQL only**. Every value flows through positional `$N` placeholders. The join-table name and entity-id column name are picked from a hard-coded `{ joinTable, entityIdColumn }` mapping keyed on the validated `entityKind` enum — no string interpolation of user input.

- **Test layers per ADR 0022**:

  - **Vitest** — new `POST /sessions/:id/include` describe block in `apps/server/src/sessions/routes.test.ts` (8 cases): success per entity kind (node / edge / annotation), 404 destination-invisible, 403 not-a-participant, 409 session-already-ended, 403 entity-not-referenceable, 409 entity-already-included, 400 bad body / bad UUID, 401 no-auth.
  - **Cucumber+pglite** — `tests/behavior/backend/entity-inclusion.feature` (5 scenarios): successful node inclusion cross-session; reject when caller is not a destination participant; reject when source is a private session caller can't see; reject when already included; reject when destination is ended.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; new cases bring the total upward (Status documents the exact delta).
- `pnpm run test:behavior:smoke` (Cucumber) green; new feature adds 5 scenarios.
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- No regression in `visibility.ts` / `references.ts` cases or any existing suite.

## Decisions

- **File layout: extend `routes.ts`, do NOT create a new `inclusion.ts` module (chosen).** Two alternatives surveyed:

  - **Extend `routes.ts`** (chosen). The session-management plugin already owns every other session-scoped endpoint (`POST /sessions`, GET list, GET by id, end, privacy toggle, both participant routes). The inclusion endpoint reuses three private helpers (`withTransaction`, `toIsoString`, `DbTxClient`), the `visibilityWhereFragment` import, the `sessionIdParamsSchema`, and the `errorEnvelopeRef`. Pulling the endpoint into a new module would require either exporting the private helpers (widening the API of `routes.ts`) or duplicating them (drift hazard). The file is long but the structure is consistent — each endpoint is a self-contained `app.post(...)` block with its own JSDoc commentary. Adding one more endpoint keeps that pattern intact.
  - **New `inclusion.ts` module** (rejected). Would let the inclusion endpoint live next to a hypothetical future WS-include message handler. But the WS surface lives under `backend.websocket_protocol`, not under `sessions/`, and the planned WS handler will reuse the predicates (`canReference<Kind>`) directly rather than the HTTP endpoint. The two consumers don't share code — they share predicates that are already in their own module. Splitting routes.ts for symmetry that doesn't exist would be premature.

  If `routes.ts` grows past ~3500 lines, a future refactor can split per-feature (e.g. `routes/inclusion.ts`, `routes/participants.ts`, `routes/lifecycle.ts`) at once. Premature splitting of one endpoint isn't the right intervention today.

- **Authority stack order: visibility → participation → lifecycle → reference → uniqueness (chosen).** The order matters for existence-non-leak: a private session the caller can't see returns 404 BEFORE any participation / lifecycle / reference signal leaks. Three alternatives surveyed:

  - **Visibility → participation → lifecycle → reference → uniqueness** (chosen). Mirrors the existing session-management endpoints (visibility-first). Participation is its own check separate from visibility — a user could be a *past* participant (still satisfies visibility) but no longer *active* (fails participation). Lifecycle gates further. Reference is the source-side check; uniqueness is the dedup guard.
  - **Visibility → reference → participation → lifecycle → uniqueness** (rejected). Would do the source-side check before establishing the destination-side authority. Leaks information about source-entity reachability to non-participants of the destination, which is a privacy regression.
  - **Reference → visibility → participation → lifecycle → uniqueness** (rejected). Same leak as above, worse.

- **Participation check (active participants only) is its own step, not folded into the visibility predicate.** Two alternatives surveyed:

  - **Separate "active participation" check** (chosen). `visibilityWhereFragment` permits past participants (the EXISTS subquery doesn't filter on `left_at IS NULL`). That's correct for read access — once you've seen a session you've seen it. But write authority (INSERT into the destination's join table) requires *current* participation. The two predicates have different semantics; we keep them separate.
  - **Tighten `visibilityWhereFragment` to active-only** (rejected). Would break the read endpoints (`GET /sessions`, `GET /sessions/:id`) — a past participant would suddenly stop seeing the session they left. Not the intended semantics.

- **`canReference<Kind>` is called inside the transaction with the transaction client (chosen over outside-the-transaction).** Two alternatives surveyed:

  - **Inside-the-transaction with the same client** (chosen). The predicate sees the same snapshot the destination FOR UPDATE acquired. There's no race window where a session A goes private between the reference check and the INSERT — both happen atomically. The predicates already accept any `VisibilityExecutor` so the production pg.PoolClient and the test pglite-shim both satisfy.
  - **Outside-the-transaction against the pool** (rejected). Cheaper (one fewer client-level coordination) but exposes a TOCTOU race: between the pool-level reachability check and the transactional INSERT, an origin session could be made private and the inclusion would land "after" the entity stopped being referenceable. The destination's FOR UPDATE doesn't lock the source side; only running the source check under the same client (which inherits the same transaction snapshot) closes the window.

- **`ON CONFLICT DO NOTHING RETURNING ...` for the join-table INSERT, with `rowCount === 0` → 409 `entity-already-included` (chosen over a pre-check SELECT or a 200 idempotent no-op).** Three alternatives surveyed:

  - **`ON CONFLICT DO NOTHING` + 409** (chosen). Single round trip, atomic. The composite-PK conflict collapses the race between two concurrent inclusion attempts into a deterministic outcome. The handler reads `rowCount === 0` as the "already included" signal and throws the typed 409. Consistent with the "no silent no-ops" pattern the other session-management endpoints follow (end-session 409 on re-end, privacy 200 on same-value, participant-assignment 409 on already-filled).
  - **Pre-check SELECT then INSERT** (rejected). Two round trips; TOCTOU race between the SELECT and the INSERT that the composite PK would catch as `unique_violation` — same outcome, more code.
  - **200 idempotent (silent no-op on already-included)** (rejected). The recommendation in the task spec is 409 for consistency with the rest of the session-management surface. The "did anything happen?" question the client implicitly asks via the status code stays answerable: 200 means "I included it now"; 409 means "it was already there, no event landed."

- **`entity-not-referenceable` is 403, not 404 (chosen).** Two alternatives surveyed:

  - **403** (chosen). The caller IS authenticated and has reached an endpoint that takes their authority into account. The entity may exist (it's in some private session the caller can't see) — they're not allowed to *reference* it, but the failure isn't a non-existence failure, it's an authority failure. 403 lines up with `not-a-participant` / `not-a-moderator` in this codebase.
  - **404** (rejected). Would conflate "the entity doesn't exist" with "the entity exists but isn't reachable by you" — a different existence-non-leak surface than the session one. For sessions we collapse to 404 because the session list is the obvious leak target; for entities, the entity id was supplied by the caller (they already know it exists from their perspective). 403 is more honest about the authority semantics.

- **`entity-already-included` is 409, not 200 idempotent (chosen).** See the ON CONFLICT decision above. Consistency with the "no silent no-ops" pattern. The client gets a typed code to branch on; the moderator UI can phrase "already in this session" specifically without parsing a body.

- **Path of the `:id` param is the DESTINATION session (chosen over body-supplied destination).** The path param identifies the resource being mutated (the destination session's inclusion list). Mirrors `POST /sessions/:id/end`, `POST /sessions/:id/participants`, `PATCH /sessions/:id/privacy`. Putting the destination in the body would diverge from the pattern for no benefit.

- **Response carries the inclusion's `includedAt` from the join-table RETURNING (chosen over the event's `created_at`).** The two timestamps differ by microseconds in production (one is the join-table row insert, the other is the event row insert). The handler returns the join-table value because that's the canonical "when this entity joined this session" — the event's `created_at` is "when the row recording the join was written," which is a server-side audit trail timestamp. The join-table timestamp is what UIs and projections care about.

- **Boundary: this endpoint owns ONLY the HTTP/REST surface.** The WS-include message handler (future) will reuse the same predicates (`canReference<Kind>` + active-participation SELECT) but compose them against the WS connection's subscribed session rather than a path-param session. Keeping the predicates destination-agnostic (which sibling 2 already does) preserves their reusability.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-10. Landed as:

- Routes plugin extension: [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — `POST /sessions/:id/include` registered alongside the existing session-management routes (the new-module alternative was weighed and rejected in Decisions; extending `routes.ts` keeps the private helpers `withTransaction` / `toIsoString` / `DbTxClient` private and re-uses every other already-imported piece — `visibilityWhereFragment`, `sessionIdParamsSchema`, `errorEnvelopeRef`). The handler dispatches on the validated `entityKind` enum (`node` / `edge` / `annotation`) through a `{ joinTable, entityIdColumn, canReference }` table whose values are hard-coded literals; user input flows only through positional `$N` parameters. The transactional shape mirrors `POST /sessions/:id/participants`: visibility-gated `SELECT ... FOR UPDATE` → active-participant SELECT → lifecycle gate → source-side `canReference<Kind>` (called with the transaction client for snapshot consistency) → `INSERT ... ON CONFLICT DO NOTHING RETURNING ...` (composite-PK conflict collapses to typed 409) → `MAX(sequence)+1` → `validateEvent` + `INSERT INTO session_events`. New `EntityInclusionResponse` schema declared with `$id: 'EntityInclusionResponse'`.
- `RejectionReason` extensions: [`apps/server/src/methodology/types.ts`](../../../apps/server/src/methodology/types.ts) adds `entity-not-referenceable` and `entity-already-included` to the union. [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts) extends `statusCodeForRejection` to map them to 403 / 409 respectively. [`apps/server/src/errors.test.ts`](../../../apps/server/src/errors.test.ts) tightened (+2 rows in the parameterized mapping table and +2 keys in the exhaustiveness-guard `allReasons` record).
- Vitest unit tests: [`apps/server/src/sessions/routes.test.ts`](../../../apps/server/src/sessions/routes.test.ts) — new `POST /sessions/:id/include` describe block with 10 cases (success per entity kind for node / edge / annotation, 404 destination-invisible, 403 not-a-participant, 409 session-already-ended, 403 entity-not-referenceable, 409 entity-already-included, 400 malformed body / bad UUID, 401 no-auth). Memory shim extended with `sessionNodes` / `sessionEdges` / `sessionAnnotations` arrays and recognisers for `INSERT INTO session_<kind>s ... ON CONFLICT DO NOTHING RETURNING ...` (mirroring the composite-PK uniqueness in JS) and the source-side `canReference<Kind>` SELECT (mirroring the any-visible-origin rule).
- Cucumber+pglite scenarios: [`tests/behavior/backend/entity-inclusion.feature`](../../../tests/behavior/backend/entity-inclusion.feature) with 5 scenarios (successful cross-session node inclusion, non-participant rejection, source-not-visible rejection, already-included rejection, ended-destination rejection), step defs at [`tests/behavior/steps/backend-entity-inclusion.steps.ts`](../../../tests/behavior/steps/backend-entity-inclusion.steps.ts). New step phrases use the "inclusion source" / "inclusion destination" / "that node" idiom so they don't collide with sibling-feature steps.
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 843 → 855 (+12 — 10 new inclusion-endpoint cases + 2 new RejectionReason mapping rows in `errors.test.ts`); Cucumber 171 → 176 (+5 — five new entity-inclusion scenarios).
- **Sub-stream closure**: `backend.cross_session_permissions` is now complete (`privacy_field_enforcement` + `reference_permission_check` + `entity_inclusion_endpoint` all at `complete 100`). Future WS-include message handlers will reuse the `canReference<Kind>` predicates directly rather than this HTTP endpoint; the predicates landed as destination-agnostic, so they're ready.
