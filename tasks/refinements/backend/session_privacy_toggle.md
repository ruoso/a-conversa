# `PATCH /sessions/:id/privacy` — host toggles a session's privacy

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.session_management.session_privacy_toggle`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `backend.api_skeleton` — settled (HTTP server, error handling, OpenAPI, request logging).
- `backend.auth` — settled (`app.authenticate` decorator + `request.authUser` shape).
- `backend.session_management.create_session_endpoint` — settled (`apps/server/src/sessions/routes.ts` plus `SessionResponse` schema, `sessionRowToResponse`, `withTransaction`).
- `backend.session_management.get_session_endpoint` — settled (the visibility WHERE clause this task lifts).
- `backend.session_management.end_session_endpoint` — settled (the `ended_at IS NOT NULL` lifecycle gate pattern).
- `data_and_methodology.schema.sessions_table` — settled (`privacy TEXT NOT NULL DEFAULT 'public'` with `CHECK (privacy IN ('public','private'))`).

## What this task is

Fifth sibling under `backend.session_management`. Lands `PATCH /sessions/:id/privacy` — the host issues a PATCH against a specific session id with a body of `{ privacy: 'public' | 'private' }`, and the server flips the row's `privacy` column. Returns 200 + the updated `SessionResponse`.

The artifact shape:

- `apps/server/src/sessions/routes.ts` — extend the existing plugin with `PATCH /sessions/:id/privacy`. Reuses `sessionResponseRef`, `sessionRowToResponse`, the visibility-gated SELECT pattern, `sessionIdParamsSchema`.
- `apps/server/src/sessions/routes.test.ts` — extend the existing Vitest unit suite.
- `tests/behavior/backend/session-privacy.feature` + `tests/behavior/steps/backend-session-privacy.steps.ts` — new files.

## Why it needs to be done

Three downstream consumers wait on this:

- **Moderator UI — "Make private" / "Make public" toggle.** The console's session-detail view needs a server contract for the privacy switch.
- **Cross-session reference permissions (`backend.cross_session_permissions`).** Privacy gates whether one session can reference another's nodes/edges; the toggle is how a host adjusts that gate.
- **Audience-page authentication.** Private sessions gate the audience-broadcast surface; the host needs a way to publish or unpublish a live session.

## Inputs / context

From [`apps/server/migrations/0002_sessions.sql`](../../../apps/server/migrations/0002_sessions.sql):

- `privacy TEXT NOT NULL DEFAULT 'public'` with `CHECK (privacy IN ('public','private'))` — the column we flip. The CHECK constraint is the DB-side guard against an invalid value reaching the row.

From [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts):

- `sessionResponseSchema` / `sessionResponseRef` / `SESSION_RESPONSE_SCHEMA_ID` — the canonical per-session shape this endpoint returns.
- `sessionRowToResponse(row)` — snake_case → camelCase mapper; reused unchanged.
- `sessionIdParamsSchema` — the `:id` UUID JSON Schema; reused for this route's `schema.params`.
- The visibility-gate SELECT from `GET /sessions/:id` / `POST /sessions/:id/end` — lifted (the existence-non-leak property carries through).

From [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts):

- The event-kind catalog has **no** `session-privacy-changed` (or equivalent). See "Decision: no event kind, Option B" below.

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts):

- `ApiError.notFound(...)` — 404 with `code: 'not-found'`. Used for both "id doesn't exist" and "exists but not visible to the caller" — the existence-non-leak rule.
- `ApiError(403, 'not-a-moderator', ...)` — the authority-failure 403; reused unchanged from the end-session endpoint.
- `ApiError(409, 'session-already-ended', ...)` — used here for the "can't toggle a finished session" lifecycle gate, mirroring the end-session endpoint's vocabulary.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest covers handler logic + `.inject()`; Cucumber+pglite covers the end-to-end UPDATE against the real migrated schema with the CHECK constraint.

## Constraints / requirements

- **Endpoint**: `PATCH /sessions/:id/privacy`.
- **Auth**: required (`preHandler: app.authenticate`). 401 `auth-required` from middleware.
- **Path param** (JSON Schema `schema.params`): UUID-shaped `id`; reuses `sessionIdParamsSchema`.
- **Body** (`schema.body`): `{ privacy: 'public' | 'private' }`. The `privacy` field is required; the value is enum-constrained at the JSON Schema layer. Malformed → 400 `validation-failed`.
- **Visibility-then-authority ordering**: visibility-gated SELECT FIRST (404 short-circuit on invisible) BEFORE authority check. Same existence-non-leak rule as get/end.
- **Authority**: host-only. Non-host on a visible session → 403 `not-a-moderator`.
- **Lifecycle gate**: `ended_at IS NOT NULL` → 409 `session-already-ended`. Privacy on an ended session is meaningless (the cross-session-reference window is closed; the audience-page surface no longer publishes).
- **Idempotency**: setting the same value the row already has → 200 with the unchanged `SessionResponse`. The UPDATE runs and is a no-op at the DB layer (`SET privacy = $1` writes the same value); no 409. The client's mental model is "set this to X"; we honor it whether X equals the current value or not. See Decisions for rationale.
- **No event written**. Option B — privacy changes are NOT recorded in `session_events`. The methodology-engine vocabulary contains no `session-privacy-changed` kind; the schema-on-write contract for the event log only accepts the existing 13 kinds. Privacy is session-row metadata, not a methodology-level fact about the debate (the engine never reads it; only the cross-session-reference + listing/audience permissions read it). See Decisions for the alternative weighed and rejected.
- **No transaction**. A single UPDATE statement with no companion event INSERT and no read-then-write dependency. There is no atomicity requirement to wrap. (`withTransaction` is reserved for endpoints that must couple multiple writes; this endpoint has one.)
- **Response shape** (200 + JSON): bare `SessionResponse` with the new `privacy` value. camelCase via `sessionRowToResponse`.
- **Status codes**:
  - 200 — successful toggle (including the no-op same-value case).
  - 400 — `:id` malformed or body invalid (`validation-failed`).
  - 401 — unauthenticated (`auth-required`).
  - 403 — visible but not host (`not-a-moderator`).
  - 404 — session does not exist OR is not visible to caller (`not-found`).
  - 409 — session already ended (`session-already-ended`).
  - 500 — DB error or unhandled exception.
- **Test layers per ADR 0022**:
  - **Vitest** — 8 cases: host toggles public→private; non-host → 403; private invisible → 404; ended session → 409; unknown id → 404; same-value no-op → 200; bad body (missing privacy / invalid enum) → 400; no auth → 401.
  - **Cucumber+pglite** — 3 scenarios: host toggles public→private; non-host → 403; ended session → 409.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; new cases bring the total from 775 to 783 (+8).
- `pnpm run test:behavior:smoke` (Cucumber) green; new feature adds 3 scenarios (147 → 150).
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- Generated OpenAPI document at `/docs/json` lists `PATCH /sessions/{id}/privacy` tagged `sessions` with `cookieAuth` security and a 200 response referencing `SessionResponse`.

## Decisions

- **Option B — no event written for privacy changes** (chosen). Two alternatives were surveyed:
  - **Option A — extend the event catalog with `session-privacy-changed`** (rejected). Would require: a new entry in `eventKinds` + an amendment to the SQL `CHECK` on `0010_session_events.sql` (forward-only migration to widen the constraint); a new Zod payload schema in `packages/shared-types/src/events.ts`; an amendment to the `session_events_table` refinement and to ADR 0021's worked catalog; the routes plugin would then mint envelopes through `validateEvent` and INSERT into `session_events` at the next sequence. The scope balloons (schema migration + amendments to two completed refinements + ADR text). This is justified ONLY if a downstream consumer needs to replay historical privacy state — and at v1 none does. The methodology engine never reads privacy; the projection layer doesn't carry historical privacy; replay reconstructs the visible graph + facet status, not the moderator's privacy-toggle history. The audit value of recording the toggle is small relative to the schema-amendment cost.
  - **Option B — UPDATE the row; no event** (chosen). Privacy is a session-row attribute (the `privacy` column), distinct from the per-event log of methodology-level state transitions. Reading the row tells the cross-session-reference check / listing endpoint / audience page the current value. Replay doesn't need historical privacy because no downstream consumer asks "what was the privacy 30 events ago?" — the cross-session-reference check is a CURRENT-state check, fired at the moment of an entity-inclusion or audience-page request. If a future product requirement adds "audit who flipped privacy when," that's a new task that introduces the event kind under the same amendment-pass rule — but it's not blocking v1.
- **HTTP verb: `PATCH`** (chosen). Three alternatives:
  - **`PATCH /sessions/:id/privacy`** (chosen). PATCH is the canonical HTTP shape for "modify a subset of a resource's fields." The URL names the resource AND the sub-resource being modified, leaving room for sibling field-toggle endpoints (e.g. `PATCH /sessions/:id/topic` if a future task allows topic edits) without forking the URL space.
  - **`POST /sessions/:id/privacy`** (rejected, but defensible). The end-session endpoint uses POST because "end" is an action-on-resource (a state-transition that emits an event). Privacy-toggle could mirror that pattern — but PATCH is a closer semantic fit (no event, no state machine, just a column write), and POST overloads as a catch-all is the failure mode HTTP semantics try to discourage.
  - **`PUT /sessions/:id`** with a full-resource body (rejected). PUT requires the client to send the whole resource representation; for a one-field change this is wasteful and risks a client overwriting fields it didn't mean to touch (topic, etc.). PATCH is the right shape for partial updates.
- **Idempotency — same-value → 200, NOT 409** (chosen). Two alternatives:
  - **200 with the unchanged row** (chosen). The endpoint's contract is "set privacy to X." If the row's privacy is already X, the post-condition the caller asked for is already met — returning 200 with the (unchanged) `SessionResponse` is honest and reduces client-side noise (the UI's "Make Private" button stays correct even if a race condition or a prior tab already toggled it). Idempotent semantics also mean retry-on-network-error is safe; clients don't have to detect "did my prior call already land?" The UPDATE statement runs unconditionally — `SET privacy = $1` writes the same value, the row's `created_at` etc. don't change.
  - **409 same-value-not-changed** (rejected). Would force clients to read-before-write and short-circuit on equality. Adds complexity for no information gain; the semantics of "you tried to set X to a value it already had" doesn't carry a usefully distinct response from "you set X to a new value." Unlike end-session's 409 (which IS a meaningful state distinction — re-ending would corrupt the methodology log), same-value privacy-toggle is genuinely a no-op.
- **Lifecycle gate — ended sessions can't toggle (409 `session-already-ended`)** (chosen). Three alternatives:
  - **409 `session-already-ended`** (chosen). Privacy is meaningful only on a live session — cross-session reference happens during active sessions; audience-page authentication gates a live broadcast. Once a session is ended, privacy is frozen: the row stays for replay/history but its privacy at the moment of ending is the final value. Letting privacy flip post-end would either lie ("this session was always private") or break invariants for downstream consumers that snapshot the row at end-time. Reusing the existing `session-already-ended` code keeps the rejection vocabulary stable across the session-management surface.
  - **Allow toggling on ended sessions** (rejected). Permits the host to retroactively hide a session from the public; the audience-page gate would change retroactively which is a semantic leak (cached audience views diverge from current truth). Privacy at end-time is also the value snapshot consumers (future analytics, snapshots) implicitly pin to.
  - **422 `lifecycle-violation` or similar** (rejected). The methodology vocabulary's 422s are for "well-formed but the methodology state forbids" (e.g. proposal-not-pending). Ended-session-privacy is more naturally a 409 (conflict with current resource state) — same shape as the end-session endpoint's own 409.
- **Visibility-then-authority — 404 before 403** (chosen). Same existence-non-leak rule as get/end. A non-participant probing a private session's privacy endpoint sees 404, identical to nonexistent-id. The toggle-endpoint must not become a side-channel for enumerating private sessions.
- **No transaction wrapper** (chosen). The endpoint issues a single UPDATE statement. `withTransaction` exists for endpoints that couple multiple writes (the create + event INSERT pair, the end-session UPDATE + event INSERT pair). A single statement has no atomicity boundary to manage; wrapping it in BEGIN/COMMIT would add cost (round trips, lock acquisition window) with no correctness benefit. The visibility/authority/lifecycle checks fold into the same SQL via `WHERE id = $1 AND <visibility> AND host_user_id = $2 AND ended_at IS NULL` — but the SELECT-first / UPDATE-second pattern is clearer for distinguishing the four failure modes (404 vs 403 vs 409 vs OK), so the handler does the SELECT, branches in JS, then issues the UPDATE.
- **Authority code: reuse `not-a-moderator`** (chosen). Same vocabulary as `POST /sessions/:id/end`. The host IS the moderator at v1; if the future participant_assignment task introduces explicit moderator role assignment the semantics widen naturally without changing this endpoint's response.
- **Bare body, not wrapped** (chosen). Same shape as get/end — the endpoint's resource IS the session. The response carries the same `SessionResponse` shape; the only field that changed is `privacy`.
- **`actor` not recorded anywhere** — corollary of "no event written." The only persistent record of the toggle is the new `privacy` value on the row. Future audit-log requirements (if any) would introduce a separate audit-log table or the event-kind extension under Option A.

## Open questions

- **Future audit need**: if a moderator UX/compliance requirement surfaces ("who made this private and when"), the path forward is Option A — add `session-privacy-changed` to the event-kind catalog with payload `{ from: 'public'|'private', to: 'public'|'private', changed_at: ISO8601 }`, amend the SQL CHECK and Zod schema, and amend the prior refinements per the project's amendment-pass rule. Not in scope here.
- **WebSocket broadcast on privacy change** — the moderator UI may want connected audience clients to react (a public session going private should disconnect non-participant audience subscribers). The WS broadcast layer is downstream (`ws_event_broadcast` and friends); the wiring lands when it does, and may pick up the privacy state from the row rather than from an event.
- **Cross-session reference revocation on `public → private` flip** — if session B has already referenced session A's nodes, does A going private revoke those references? Open product question; out of scope here. The `reference_permission_check` task in `backend.cross_session_permissions` will likely decide CURRENT-state gates only (i.e. "you cannot create a new reference," not "we delete existing ones") to keep the model simple; that's compatible with this endpoint.

## Status

**Done** — 2026-05-10. Landed as:

- Routes plugin extension: [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — `PATCH /sessions/:id/privacy` registered alongside the existing session-management routes. Path-param schema validates `id` as a UUID; body schema requires `privacy` enum-constrained to `'public' | 'private'`; visibility-gated SELECT mirrors `GET /sessions/:id`'s WHERE clause (existence-non-leak property); authority check (`host_user_id === caller` else 403 `not-a-moderator`); lifecycle check (`ended_at IS NULL` else 409 `session-already-ended`); single UPDATE flips `privacy` and RETURNs the full row (no transaction wrapper — single statement, no event INSERT). Same-value writes are a 200 no-op (idempotent). Bare camelCase `SessionResponse` body (no wrapper). **No `session-privacy-changed` event written** — Option B as documented in Decisions.
- Vitest unit tests: [`apps/server/src/sessions/routes.test.ts`](../../../apps/server/src/sessions/routes.test.ts) — extended with the `PATCH /sessions/:id/privacy` describe block (8 cases): host toggles public → private → 200 + new privacy in response; same-value → 200 no-op; non-host → 403 with row unchanged; non-participant on private → 404 (invisibility precedes authority); ended session → 409 with row unchanged; unknown id → 404; bad body (missing privacy / invalid enum) → 400; no auth → 401. Memory shim extended with a `UPDATE sessions SET privacy = $1` handler; the visibility-gated SELECT pattern already absorbs the new lookup query via the same predicate match.
- Cucumber+pglite scenarios: [`tests/behavior/backend/session-privacy.feature`](../../../tests/behavior/backend/session-privacy.feature) (3 scenarios) with step defs at [`tests/behavior/steps/backend-session-privacy.steps.ts`](../../../tests/behavior/steps/backend-session-privacy.steps.ts). Host toggles public → private → 200 + row's privacy column now `'private'` + the only session event in the log is the original `session-created` (no privacy-changed event); non-host → 403 with row unchanged; ended session → 409 with row unchanged. Exercises the visibility + authority + lifecycle gates AND the UPDATE against the real schema's `CHECK (privacy IN ('public','private'))` constraint end-to-end against the pglite-backed pool.
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 775 → 783 (+8); Cucumber 147 → 150 (+3).
