# `POST /sessions/:id/invite/claim` — debater self-claims a role slot via an invite URL

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.session_management.session_invite_self_claim_endpoint`
**Effort estimate**: 1d
**Inherited dependencies**:

- `backend.api_skeleton` — settled (HTTP server, error handling, OpenAPI, request logging, `/api/*` prefix per `serve_static_frontends_path_collision_fix`).
- `backend.auth` — settled (`app.authenticate` decorator + `request.authUser` shape with `{ id, screenName }`).
- `backend.session_management.create_session_endpoint` — settled (the host is implicitly joined as `role='moderator'` at create time per `participant_assignment`'s amendment; that row is what causes a self-claiming debater to be a non-host when they arrive).
- `backend.session_management.get_session_endpoint` — settled. Source of the 404-not-403 existence-non-leak rule this endpoint inherits unchanged.
- `backend.session_management.participant_assignment` — settled. **Direct predecessor** named in the `.tji` `depends` clause. Lands the `SessionParticipantResponse` schema (`$id` declared at [`apps/server/src/sessions/routes.ts:441-507`](../../../apps/server/src/sessions/routes.ts)), the `participantRowToResponse` mapper (lines 1077-1095), the four new `RejectionReason` codes (`role-already-filled`, `user-already-joined`, `user-not-found`, `cannot-remove-moderator`), and — load-bearing for this task — the entire transactional shape: visibility-gated `SELECT … FOR UPDATE` → authority check → lifecycle check → role-availability pre-check → `INSERT session_participants RETURNING …` → `MAX(sequence)+1` → `validateEvent` → `appendSessionEvent` → COMMIT → post-COMMIT `wsBroadcast.emit`. This endpoint lifts that scaffold near-verbatim, mutating only the authority check and the source of `userId` (the caller's, not the body's).
- `backend.session_management.list_session_participants_endpoint` — settled. **Second dependency** named in the `.tji` `depends` clause. Pins the existing-leaf precedent for "REST seam on the participants surface" plus the documentation pattern the new handler's JSDoc mirrors.
- `backend.cross_session_permissions.privacy_field_enforcement` — settled. Lifted `visibilityWhereFragment` / `canSeeSession` into [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts); the visibility module's lead doc named future participant-join handlers as a canonical consumer of the SQL fragment.
- `data_and_methodology.schema.session_participants_table` — settled ([`apps/server/migrations/0003_session_participants.sql`](../../../apps/server/migrations/0003_session_participants.sql)). Partial unique index `session_participants_active_role_idx` on `(session_id, role) WHERE left_at IS NULL` is the safety net; partial unique index `session_participants_active_user_idx` on `(session_id, user_id) WHERE left_at IS NULL` blocks the same caller from claiming a second slot.
- `data_and_methodology.event_types.session_lifecycle_events` — settled. `participantJoinedPayloadSchema` (`{ user_id, role, screen_name, joined_at }`) is the envelope this endpoint emits.
- `data_and_methodology.event_types.event_validation` — settled (`validateEvent` server-side wrapper).

## What this task is

The tenth leaf under `backend.session_management`. Lands `POST /api/sessions/:id/invite/claim` — an authenticated debater who arrived at the session via the moderator's invite URL (`<origin>/sessions/<id>/invite?role=<role>`) posts the role they want to claim; the server transactionally INSERTs a `session_participants` row for `(sessionId, callerUserId, role)` and emits a `participant-joined` event, returning the freshly inserted row as a `SessionParticipantResponse`.

The endpoint completes the **invite → claim loop** the moderator's invite view (shipped 2026-05-16 in `mod_invite_participants`) opens: today the moderator can generate and share an invite URL, but the debater who follows the link, logs in, and lands on the SPA's claim view has no backend surface to consume. After this task ships, the debater-side participant-UI claim route (`participant_ui.part_session_join.part_invite_acceptance` — already an open WBS leaf at [`tasks/40-participant-ui.tji:238`](../../40-participant-ui.tji)) has a real endpoint to POST against.

The artifact shape:

- `apps/server/src/sessions/routes.ts` — extend the existing `sessionsRoutesPlugin` with `POST /api/sessions/:id/invite/claim` registered alongside the existing `POST /api/sessions/:id/participants` (host-only) and `DELETE /api/sessions/:id/participants/:userId` (host or self) handlers. Reuses `sessionIdParamsSchema`, `sessionParticipantResponseRef`, `participantRowToResponse`, the `visibilityWhereFragment(...)` helper, `withTransaction`, `appendSessionEvent`, `validateEvent`, and the `wsBroadcast` post-COMMIT emit path verbatim. Adds one new body schema `selfClaimParticipantBodySchema` (`{ role: 'debater-A' | 'debater-B' }`) registered the same way `assignParticipantBodySchema` is.
- `apps/server/src/sessions/routes.test.ts` — extend the existing Vitest suite with a `POST /api/sessions/:id/invite/claim` describe block.
- `tests/behavior/backend/session-invite-self-claim.feature` + `tests/behavior/steps/backend-session-invite-self-claim.steps.ts` — new files exercising the full transactional shape against the migrated schema.

No new `RejectionReason` codes; no edits to `apps/server/src/errors.ts`; no edits to `apps/server/src/methodology/types.ts` (every failure mode reuses an existing code — see Decisions).

## Why it needs to be done

The driver is the **`m_manual_lobby_smoke`** milestone — a human moderator generates an invite URL, shares it (any out-of-band channel: DM, voice call, in-person handoff), the debater opens it, authenticates via OAuth (or via the new-user flow now that `auth_callback_new_user_browser_redirect` lands the browser on `/screen-name` cleanly), and arrives at a slot-claim view that posts to THIS endpoint and lands them in the session as `debater-A` or `debater-B`. The moderator then sees them in the lobby (via the WS `participant-joined` broadcast this endpoint emits) and the methodology engine sees them as a participant (via the `session_participants` row this endpoint INSERTs) so a future commit-logic invocation is well-formed.

Without this endpoint, the M3-lobby goal stalls: the moderator's invite URL is a dead-end. The existing `POST /api/sessions/:id/participants` is host-only and takes a `userId` in the body — the debater holds neither the host's role nor any way to address themselves by another user's id, so the host-only endpoint cannot serve the debater. A separate debater-callable endpoint is the architecturally clean answer (the alternative — widen the host-only endpoint to accept an optional "claim self" mode — overloads two unrelated authority models on one route and complicates both).

The downstream consumers that will adopt the endpoint:

- **`participant_ui.part_session_join.part_invite_acceptance`** (already-open WBS leaf, [`tasks/40-participant-ui.tji:238`](../../40-participant-ui.tji), 1d effort). The participant-UI route the debater lands on; its claim button POSTs to `/api/sessions/:id/invite/claim` with the `?role=` query-string value as the body's `role`. **No new follow-up needs registration** — the consumer leaf already exists.
- **`mod_invite_participants` real-time slot fill** (already-shipped — [`apps/moderator/src/routes/InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx)). The moderator's slot-occupancy reducer already collapses `participant-joined` / `participant-left` events from the WS catch-up stream, so when this endpoint emits its `participant-joined` event the moderator's invite view's slot updates in real time without any moderator-side code changes.

## Inputs / context

From [`apps/server/src/sessions/routes.ts:2058-2326`](../../../apps/server/src/sessions/routes.ts) — the existing `POST /api/sessions/:id/participants` handler (host-only debater assignment). This is the canonical scaffold the new handler lifts: visibility-gated `SELECT … FOR UPDATE` (lines 2153-2173), authority check (2179-2185), lifecycle check (2190-2196), target-user lookup (2203-2216), role-availability pre-check (2224-2237), user-availability pre-check (2243-2256), `INSERT session_participants RETURNING …` (2263-2273), `MAX(sequence)+1` allocator (2280-2288), envelope build + `validateEvent` + `appendSessionEvent` (2294-2313), post-COMMIT `wsBroadcast.emit` (2320-2322). The new handler mutates four lines of this scaffold (the authority check, the source of `userId`, the role enum's exclusion of `'moderator'` which is **kept** but the body schema is new, and the comment header) and lifts everything else.

From [`apps/server/src/sessions/routes.ts:441-507`](../../../apps/server/src/sessions/routes.ts) — `SESSION_PARTICIPANT_RESPONSE_SCHEMA_ID`, `sessionParticipantResponseSchema`, `sessionParticipantResponseRef`. The 200-response shape is identical to the host-only POST's — `{ id, sessionId, userId, role, joinedAt, leftAt }`. No new schema needed for the response.

From [`apps/server/src/sessions/routes.ts:746-777`](../../../apps/server/src/sessions/routes.ts) — `assignParticipantBodySchema`, the host-only body shape `{ userId: UUID, role: 'debater-A' | 'debater-B' }`. This task introduces `selfClaimParticipantBodySchema` as a sibling: identical role enum, but the `userId` field is OMITTED (the caller's id comes from `request.authUser.id`). A self-claim body that includes `userId` should fail Fastify's `additionalProperties: false` with 400 `validation-failed`.

From [`apps/server/src/sessions/routes.ts:1077-1095`](../../../apps/server/src/sessions/routes.ts) — `participantRowToResponse(row)`. The snake_case → camelCase mapper. Reused verbatim.

From [`apps/server/src/sessions/visibility.ts:115-132`](../../../apps/server/src/sessions/visibility.ts) — `visibilityWhereFragment(userIdParamIndex)`. The session-management endpoints use slot `$2` (because `$1` carries the session id); the new handler uses the same slot indexing. Note: this endpoint does NOT use the boolean `canSeeSession` helper because it needs the `SELECT … FOR UPDATE` lock against the `sessions` row for the same reason `POST /sessions/:id/participants` does — a concurrent claim of the same role slot by two debaters must serialize, and the FOR UPDATE on the session row is the canonical serialization mechanism. The boolean helper does NOT lock.

From [`apps/server/src/auth/middleware.ts`](../../../apps/server/src/auth/middleware.ts) — `request.authUser` carries `{ id: UUID, screenName: string }`. The screen name is what populates the `participant-joined` event's `screen_name` payload field; the user id is what fills the `session_participants` row's `user_id`. Both come from the auth middleware — no DB round-trip needed to look the caller up (the middleware already did, at cookie verification).

From [`apps/server/migrations/0003_session_participants.sql`](../../../apps/server/migrations/0003_session_participants.sql):

- Columns: `id UUID PK`, `session_id UUID NOT NULL REFERENCES sessions(id)`, `user_id UUID NOT NULL REFERENCES users(id)`, `role TEXT CHECK (role IN ('moderator', 'debater-A', 'debater-B'))`, `joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `left_at TIMESTAMPTZ NULL`.
- Partial unique index `session_participants_active_role_idx` on `(session_id, role) WHERE left_at IS NULL` — only one active occupant per role per session. The pre-check inside the transaction is the typed-409 path; the index is the safety net for a true race.
- Partial unique index `session_participants_active_user_idx` on `(session_id, user_id) WHERE left_at IS NULL` — a user can hold at most one active role in a session. If a self-claiming caller is ALREADY a participant (e.g. as `debater-A`) and tries to claim `debater-B`, the user-availability pre-check fires with 409 `user-already-joined`.

From [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — `participantJoinedPayloadSchema` is `{ user_id, role, screen_name, joined_at }`. The screen name is denormalized into the event payload so replay queries don't need a `users` join.

From [`tasks/refinements/backend/participant_assignment.md`](./participant_assignment.md) — Decisions §"Leave-and-rejoin is 'new row' (F5)": setting `left_at` on an old row releases both partial unique indexes; a self-claim later can take the same slot via a fresh INSERT. Also §"`role-already-filled` and `user-already-joined` are two distinct 409 codes": both codes are already defined and the self-claim endpoint reuses them with no addition to the `RejectionReason` union.

From [`tasks/refinements/backend/get_session_endpoint.md`](./get_session_endpoint.md) — Decisions §"404 (NOT 403) for 'private session not visible to the caller'": existence-non-leak rule the new handler inherits unchanged. A self-claim attempt against an invisible session returns 404 `not-found`, identical to "unknown id."

From [`tasks/refinements/backend/list_session_participants_endpoint.md`](./list_session_participants_endpoint.md) — Decisions §"Route through `canSeeSession` rather than inlining the visibility SELECT": the list endpoint chose the boolean helper because it had no write to serialize. This endpoint chooses the inlined `visibilityWhereFragment` (matching `POST /sessions/:id/participants`) BECAUSE it has writes to serialize. The two choices are not in conflict; they're the right call for each endpoint's shape.

From [`tasks/refinements/moderator-ui/mod_invite_participants.md:359`](../moderator-ui/mod_invite_participants.md) — the original registration of THIS task. Notes the open refinement-time decisions: "whether self-claim requires the session to be private-visibility-or-host-invited (probably yes — public sessions should not let any logged-in user grab a debater slot), and how the slot-already-filled error surfaces to the debater." Both decided below.

From [ADR 0020](../../../docs/adr/0020-postgres-write-path-locking-and-event-ordering.md) — application-managed monotonic sequence per session; MAX-then-INSERT MUST be inside the same transaction so the `UNIQUE (session_id, sequence)` constraint catches concurrent writers. Same as the host-only POST.

From [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — event envelope shape; `participant-joined` is one of the registered event kinds.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest covers pure handler logic + Fastify `.inject()` cases; Cucumber+pglite covers the end-to-end write against the migrated schema. Both layers required.

## Constraints / requirements

- **Endpoint**: `POST /api/sessions/:id/invite/claim`. Justified under Decisions §"URL shape".

- **Auth**: required. `preHandler: app.authenticate`; 401 `auth-required` on any failure mode (middleware-owned).

- **Path param** (reuses `sessionIdParamsSchema` verbatim):

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

- **Body schema** (NEW, registered alongside `assignParticipantBodySchema` as `selfClaimParticipantBodySchema`):

  ```jsonc
  {
    "type": "object",
    "required": ["role"],
    "additionalProperties": false,
    "properties": {
      "role": { "type": "string", "enum": ["debater-A", "debater-B"] }
    }
  }
  ```

  The role enum **deliberately excludes `'moderator'`** — the moderator role is bound to the session host for the session's lifetime; a self-claim that tries to take the moderator slot fails Fastify's enum validation with 400 `validation-failed`. `additionalProperties: false` blocks a self-claim body that includes `userId` (or any other field) with 400 — the caller's id is implicit from the auth context.

- **No query string and no second body field for v1.** The invite URL's `?role=` query string is read by the participant-UI for slot pre-selection; the role is then submitted in the body, not in the URL. Carrying the role only in the body keeps the endpoint's contract independent of how the SPA gets the role hint (a future deep-link reader, manual selection in the UI, etc.).

- **Visibility-then-lifecycle ordering** — mirrors the host-only POST minus the authority check:

  1. Validate `:id` (Fastify schema; 400 if non-UUID).
  2. Begin `withTransaction`.
  3. Visibility-gated `SELECT id, host_user_id, ended_at FROM sessions WHERE id = $1 AND <visibilityWhereFragment(2)> FOR UPDATE`. Zero rows → 404 `not-found` (existence-non-leak; identical envelope to unknown id).
  4. Lifecycle check: `ended_at IS NOT NULL` → 409 `session-already-ended`.
  5. Block the host from self-claiming a debater slot: if `host_user_id === callerUserId`, throw 403 `not-a-moderator` with a message clarifying the host already holds the moderator slot via implicit assignment at session creation. Justified under Decisions §"Host cannot self-claim a debater slot".
  6. Role-availability pre-check (`SELECT … WHERE session_id = $1 AND role = $2 AND left_at IS NULL LIMIT 1`). Filled → 409 `role-already-filled`.
  7. User-availability pre-check (`SELECT … WHERE session_id = $1 AND user_id = $2 AND left_at IS NULL LIMIT 1`). Filled → 409 `user-already-joined`.
  8. `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, $3) RETURNING id, session_id, user_id, role, joined_at, left_at`.
  9. `MAX(sequence)+1` allocator inside the transaction.
  10. Build the `participant-joined` envelope. `actor = callerUserId` (the joining user IS the actor — they took the action; this is the canonical "self-action" envelope shape per ADR 0021). Payload: `{ user_id: callerUserId, role: <body.role>, screen_name: auth.screenName, joined_at: <ISO from RETURNING> }`.
  11. `validateEvent(envelope)` → `appendSessionEvent(client, envelope)` (collects for post-COMMIT broadcast).
  12. COMMIT.
  13. Post-COMMIT `app.wsBroadcast.emit({ event })` for the appended event.
  14. Return 200 + `participantRowToResponse(row)` (camelCase `SessionParticipantResponse`).

- **Visibility rule for self-claim**. The endpoint inherits the same visibility rule the rest of the session-management surface uses — **public OR host OR existing participant**. This means:

  - A **public session** is claimable by ANY authenticated user (the orchestrator brief flagged this as a question — see Decisions §"Public sessions are claimable by any authenticated user").
  - A **private session** is claimable only by callers who can already see it: the host (blocked separately at step 5 above with a clearer error) OR a current/past participant (a re-join after a leave, taking a different role or the same one). A stranger to a private session gets the same 404 they'd get from any other private-session read attempt — the existence-non-leak rule.

  Notably: there is **no "host-invited" pre-claim mechanism** for v1. A "private session, but a specific user was invited" surface would require a `session_invitations` table (a new schema migration) and a token-based invite-URL scheme (the moderator generates per-debater tokens; the URL carries the token; the self-claim verifies the token). For v1 the moderator's invite-URL share happens out-of-band; the platform's privacy model says "if you can see this private session you must already be in it, OR the host added you as a participant explicitly via the host-only POST." The self-claim endpoint does NOT widen the visibility model; it relies on it. Per Decisions §"No tokenized invitations in v1".

- **No `participantId` in path; no claim-vs-rejoin distinction at the URL level.** A repeat self-claim by the same caller against the same role they already hold returns 409 `user-already-joined` (because the partial-unique-index pre-check fires). A self-claim by a caller who is a HISTORICAL participant (a row exists with `left_at IS NOT NULL`) succeeds — they take a fresh row, per F5 (leave-and-rejoin is "new row"). No special-case "this is a rejoin" branch in the handler; the table's partial unique indexes implement the rule.

- **Idempotency: NOT idempotent at the HTTP level.** A second POST with the same body by the same caller against the same session is rejected with 409 `user-already-joined` (if the caller already holds an active role) or 409 `role-already-filled` (if someone else now holds the role). Justified under Decisions §"Not idempotent". The 409 envelope is the discriminator the participant-UI uses to decide whether to render a "you're already in this session" message vs. a "this slot was taken; please contact the moderator" message.

- **Transactional shape (load-bearing)**. The handler wraps the SELECT … FOR UPDATE + pre-checks + INSERT(participant) + MAX(seq) + INSERT(event) inside a single `withTransaction`. On any error after BEGIN: ROLLBACK and re-throw. The error handler renders the canonical envelope. Identical shape to `POST /sessions/:id/participants`.

- **`participant-joined` payload**: `{ user_id: callerUserId, role: <body.role>, screen_name: auth.screenName, joined_at: <ISO from RETURNING> }`. The `screen_name` comes from `request.authUser.screenName` (the auth middleware already loaded it at cookie verification — no extra round-trip; same source the create-session amendment uses for the implicit-moderator's `participant-joined` event).

- **`actor` on the envelope is the caller**. ADR 0021's discriminated envelope carries an `actor` field for every event. For the host-only POST the actor is the host (they assigned the debater); for the self-claim the actor is the joining debater themselves (they took the action). This matters for replay queries that walk "who did what when" — a self-claim is structurally distinguishable from a host-driven assignment by `actor === payload.user_id` (self-claim) vs. `actor !== payload.user_id` (host-driven). Justified under Decisions §"Actor on the envelope".

- **`RejectionReason` reuse — no new codes.** Every failure mode reuses an existing code:
  - `auth-required` (401) — middleware-owned.
  - `validation-failed` (400) — Fastify-owned: non-UUID `:id`, missing/invalid body `role`, body includes `userId` or other field, body's role is `'moderator'`.
  - `not-found` (404) — session does not exist OR exists-but-invisible (`ApiError.notFound`).
  - `session-already-ended` (409) — existing code (introduced by `end_session_endpoint`).
  - `not-a-moderator` (403) — repurposed for "you ARE the moderator; you cannot also claim a debater slot." Justified under Decisions §"Reuse `not-a-moderator` for host-tries-to-self-claim".
  - `role-already-filled` (409) — existing code (introduced by `participant_assignment`).
  - `user-already-joined` (409) — existing code (introduced by `participant_assignment`).

  No additions to the `RejectionReason` union; no edits to `statusCodeForRejection`. Justified under Decisions §"No new RejectionReason codes".

- **Status codes**:
  - 200 — successful self-claim; `SessionParticipantResponse` body.
  - 400 — `validation-failed`: non-UUID `:id`, missing/invalid `role` (including `'moderator'`), unknown body field.
  - 401 — `auth-required` (middleware).
  - 403 — `not-a-moderator`: the host attempted to self-claim a debater slot.
  - 404 — `not-found`: session does not exist or is not visible to the caller.
  - 409 — `session-already-ended`, `role-already-filled`, or `user-already-joined`.
  - 500 — DB error or unhandled exception.

- **No rate-limit infrastructure for v1.** The platform has no global rate-limit middleware today; adding one for this endpoint specifically would be premature and orthogonal. The endpoint's natural rate-limits are structural: a caller can have at most one active row per session (user-availability index), and each session has at most three role slots (role-availability index); a determined attacker spamming the endpoint produces 409s, not 200s, and the DB cost is one indexed SELECT per attempt. If a future iteration introduces a generic rate-limit middleware (e.g. for the auth surface or the WS handshake), this endpoint inherits it for free.

- **No audit/event emission beyond `participant-joined`**. The transactional shape already emits exactly one event per successful claim; that event IS the audit record (it lands in `session_events` with `actor`, `payload.user_id`, `payload.role`, and a sequence number tied to the session's monotonic clock). No separate "self-claim attempted" or "self-claim failed" audit events are emitted; failed claims surface as the typed error envelope and the request log (per `request_logging`) captures the rejection without an event row.

- **Test layers per ADR 0022**:
  - **Vitest** — 11 cases extending the existing suite in `apps/server/src/sessions/routes.test.ts`:
    1. authenticated + visible public session + valid `debater-A` role → 200 + `SessionParticipantResponse` with `userId === auth.id`, `role === 'debater-A'`, `leftAt === null`;
    2. no auth → 401 `auth-required`;
    3. unknown id → 404 `not-found`;
    4. private session NOT visible to caller → 404 `not-found` (not 403);
    5. private session VISIBLE to caller as historical participant → 200 (re-join succeeds via F5);
    6. host attempts to self-claim a debater slot → 403 `not-a-moderator`;
    7. ended session → 409 `session-already-ended`;
    8. role already filled by another debater → 409 `role-already-filled`;
    9. caller already holds the OTHER debater slot (active) → 409 `user-already-joined`;
    10. body missing `role` → 400 `validation-failed`; body includes `userId` → 400 `validation-failed`; body's role is `'moderator'` → 400 `validation-failed` (three sub-assertions in one case);
    11. non-UUID path param → 400 `validation-failed`.

    The memory pool shim already covers the role / user availability SELECTs and the `INSERT … RETURNING` shape (added by `participant_assignment`); no new matchers required.

  - **Cucumber+pglite** — 5 scenarios in a new `tests/behavior/backend/session-invite-self-claim.feature`:
    1. **Happy path** — alice creates a public session; ben is authenticated; ben POSTs `{role: 'debater-A'}` to the claim endpoint; response is 200 with `userId === ben.id, role === 'debater-A'`; `session_participants` has 2 rows (the implicit moderator + ben); `session_events` has 3 rows (`session-created` at seq 1, `participant-joined` moderator at seq 2, `participant-joined` ben at seq 3) with the third event's `actor === ben.id` and `payload.user_id === ben.id`.
    2. **Double-claim by the same caller** — ben self-claims `debater-A`; ben self-claims `debater-A` AGAIN; second response is 409 `user-already-joined`; no third event is emitted; the original row is untouched.
    3. **Foreign-user collision** — ben self-claims `debater-A`; maria attempts to self-claim `debater-A`; maria's response is 409 `role-already-filled`; only ben's row exists; only one `participant-joined` for `debater-A` is in the log.
    4. **Unknown session** — ben posts to `/api/sessions/<random-uuid>/invite/claim`; response is 404 `not-found` (no leak whether the id existed or not).
    5. **Unauthenticated** — no cookie; response is 401 `auth-required`.

    The "private session not visible to a stranger returns 404" property is NOT separately exercised here — it's the same `canSeeSession`-equivalent gate the `get_session_endpoint` and `list_session_participants_endpoint` Cucumber suites already cover via the same SQL surface. The Vitest case #4 above pins the property at the handler level.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; new cases extend the participant-routes describe blocks in `routes.test.ts` by 11.
- `pnpm run test:behavior:smoke` (Cucumber) green; the new feature adds 5 scenarios.
- `make test` green end-to-end.
- Generated OpenAPI document at `/docs/json` lists `POST /sessions/{id}/invite/claim` tagged `sessions` with the `cookieAuth` security requirement, a request body referencing the new `selfClaimParticipantBodySchema` (registered with `app.addSchema` so it gets a named OpenAPI component), a 200 response referencing `SessionParticipantResponse`, and 400/401/403/404/409 mapped to the canonical `ErrorEnvelope`.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the Closer appends `complete 100` to the leaf and the Status block.
- **Per ADR 0022 (no throwaway verifications)** — every behavioral assertion lands as a committed Vitest case or Cucumber scenario; no manual probes left out of the regression suite.
- **Participant-UI adoption is NOT this task's responsibility.** The debater's claim-view that POSTs to this endpoint is the open WBS leaf `participant_ui.part_session_join.part_invite_acceptance` (effort 1d, no refinement yet); it will consume this endpoint when it ships. **No new follow-up needs registration** — the consumer leaf already exists.

## Decisions

- **URL shape: `POST /api/sessions/:id/invite/claim` (chosen over `POST /api/sessions/:id/participants/self-claim` and a few other surveyed variants).** The `.tji` task title pre-named this URL (`POST /sessions/:id/invite/claim — debater self-claims a role slot when arriving via invite URL`); the `mod_invite_participants` follow-up registration drafted `POST /api/sessions/:id/participants/self-claim` in prose. Three alternatives surveyed at refinement time:
  - **`/api/sessions/:id/invite/claim`** (chosen). Matches the .tji title verbatim. Reads naturally with the moderator-UI's invite URL convention (`/sessions/:id/invite?role=...`): the SPA route AND the backend claim endpoint share the `/invite/` segment, so the user-visible URL and the API URL pair semantically. Reserves `/invite/*` as the namespace for any future invite-related affordances (e.g. `/invite/preview` to fetch session metadata before claiming, `/invite/decline` if a refusal record ever matters). The participant-UI consumer's claim button POSTs to `${origin}/api/sessions/${id}/invite/claim` with the body's `role` from the URL's `?role=` query.
  - **`/api/sessions/:id/participants/self-claim`** (rejected). Drafted in the follow-up registration but creates a 3-segment-deep noun-then-verb shape (`participants/self-claim`) that reads as "a participants resource with a self-claim sub-action" — but there's no underlying "self-claim" resource, just an action on the session. Putting it under `/participants/` also implies symmetry with the host-only `POST /participants` (which it does have) AND the historical-list `GET /participants` (which it doesn't relate to). The `/invite/` namespace better signals "this is the debater's path from an invite URL."
  - **Widen `POST /api/sessions/:id/participants` to accept a self-claim mode** (rejected). Overloads two unrelated authority models (host-only vs. self-claim) on one route. The body would need an `XOR(userId, self: true)` shape that's awkward to validate via JSON Schema, and Fastify-route-level OpenAPI would carry two response/error surfaces that are not actually unified. The separate-endpoint shape is cleaner at every layer.

- **Public sessions are claimable by any authenticated user (chosen over "only the invited debater may claim").** Two alternatives surveyed:
  - **Any authenticated user may claim a debater slot in a public session** (chosen). The platform's privacy model says public sessions are observable by any authenticated user (per `privacy_field_enforcement`); the natural read of "observable" extends to "participatable" for v1. A moderator who creates a public session is signaling "this debate is open; anyone can participate." The role-availability index (`session_participants_active_role_idx`) IS the structural gate — once a debater claims `debater-A`, the slot is filled until they leave or are removed, and no second claimant can take it. The moderator retains operational control via the host-only POST + DELETE (they can remove a debater they didn't want and assign someone they did) and via the privacy toggle (a session can be made private mid-flight to lock in the current participant set).
  - **Public sessions are observable-but-not-participatable; only the host's invite URL grants claim rights** (rejected for v1). Would require either (a) a tokenized invite mechanism (a per-debater token that the URL carries and the self-claim verifies — a new `session_invitations` table, a new schema migration, a new ADR for the invite-token format) or (b) a per-debater pre-allocation by the moderator (the moderator POSTs an "intent to invite ben at debater-A" row before sharing the URL; the self-claim cross-references that intent). Both add significant scope; neither is necessary for the v1 milestone (the M3-lobby goal is a moderator-with-the-debaters-on-a-call scenario; the moderator can verbally confirm "ben, take debater-A" before sending the link, and a stranger spam-claiming would be visible to the moderator immediately in the slot display). If a future iteration needs tokenized invites (e.g. for a public-discoverable debate platform where strangers shouldn't auto-claim), it's an additive feature — the existing model becomes "ungated" and a new "gated-by-token" mode lands alongside.

- **No tokenized invitations in v1 (chosen — defers the question registered by the .tji prompt).** The orchestrator-brief specifically asked: "whether self-claim requires private-visibility-or-host-invited." The above decision answers it: NO tokens, NO per-debater pre-allocation, NO new `session_invitations` table. Visibility IS the gate (public OR host OR existing-participant); role-availability IS the slot lock; the moderator's social channel (DM, voice, in-person) carries the trust. If a future iteration wants tokens, it would be a new ADR + a new schema + a backwards-compatible widening of THIS endpoint (the body would accept an optional `token` field; the visibility check would AND in the token's validity). The endpoint's contract is forward-compatible with that future.

- **Host cannot self-claim a debater slot (chosen — explicit 403 with `not-a-moderator` code).** Two alternatives surveyed:
  - **Explicit 403** (chosen). The host is structurally bound to the moderator role for the session's lifetime (per `participant_assignment`'s Option A and the `cannot-remove-moderator` 403 in the DELETE endpoint). Letting the host also hold a debater slot would mean the host simultaneously holds two roles, which the user-availability partial unique index would reject anyway — but the typed 403 with a clearer message ("you are the session's moderator; you cannot also be a debater") is more honest about the failure than letting the user-availability check fire with `user-already-joined`. The `not-a-moderator` code is a slight repurposing — its usual semantic is "you are NOT a moderator and the action requires moderator authority" — but the inverse reading ("the moderator role is wrong for this action") fits cleanly enough that introducing `is-the-moderator` as a new `RejectionReason` would be heavier-weight than the gain. The message text disambiguates.
  - **Let the user-availability check fire with `user-already-joined`** (rejected). Works but the typed code is less informative — the host knows they're already a participant, but `user-already-joined` doesn't communicate "the role conflict is structural: you can't be the moderator and a debater at the same time." A future iteration that allows role-swap (moderator → debater) would have to thread the host-special-case anyway; baking the explicit check in now keeps the future refactor scoped.

- **Reuse `not-a-moderator` for host-tries-to-self-claim (chosen over adding `is-the-moderator`).** Two alternatives surveyed:
  - **Reuse `not-a-moderator` with a disambiguating message** (chosen). The `RejectionReason` union is already long and growing; adding a code for a single new failure mode is overhead. The status code (403) and the message ("you are the session's moderator; you cannot also be a debater") together carry enough information for the participant-UI to render a clear error. The participant-UI doesn't typically discriminate on this code (the UI's expected user is a debater, not the host; the host hitting the self-claim endpoint is a defensive case, not a user-flow case).
  - **Add `is-the-moderator` as a new code** (rejected for v1). Net new code surface for a defensive case. Reconsider if a future endpoint needs to discriminate on "you are the host" vs. "you are not the host" beyond what `not-a-moderator` carries.

- **Not idempotent: repeat POST returns 409 (chosen over 200-with-existing-row).** Two alternatives surveyed:
  - **Not idempotent; repeat returns 409 `user-already-joined`** (chosen). The endpoint's job is to TRANSITION the caller from "not in the session" to "in the session"; a repeat POST is a state-machine violation, not a no-op. The 409 envelope lets the participant-UI render a typed "you're already in this session" message; if the user really did mean to re-join after leaving, the F5 path (DELETE first, then self-claim) is available. Mirrors the host-only POST's choice (which also rejects a duplicate assignment with 409 `user-already-joined`).
  - **Idempotent; repeat returns 200 with the existing row** (rejected). Hides the state-machine violation; loses the discriminator the UI uses to differentiate "this slot was just taken by someone else" (`role-already-filled`) from "you already hold this slot" (`user-already-joined`). The latter is the case the idempotent shape would silently flatten.

- **Actor on the envelope is the caller (chosen — self-claim is structurally distinguishable from host-driven assignment).** The `participant-joined` event's `actor` field carries the user who took the action: for the host-only POST it's the host (they assigned someone); for the self-claim it's the joining debater themselves. A replay query that walks the event log can distinguish the two shapes by comparing `actor === payload.user_id`: equal → self-claim; not-equal → host-driven assignment. This matters for audit / "who initiated this participation" queries that may surface in the moderator UI later. Mirrors ADR 0021's discriminated-envelope design — the actor is always the entity that took the action.

- **No new `RejectionReason` codes (chosen — every failure mode reuses an existing code).** The four pre-existing codes that `participant_assignment` added cover every failure mode this endpoint produces; the only additional code introduced here would be `is-the-moderator` (rejected above in favor of repurposed `not-a-moderator`). Keeping the `RejectionReason` union tight reduces the exhaustiveness-check surface in `statusCodeForRejection` and keeps the OpenAPI error envelope's enum stable.

- **Body schema is a NEW `selfClaimParticipantBodySchema` (chosen over reusing `assignParticipantBodySchema`).** Two alternatives surveyed:
  - **New body schema with `additionalProperties: false` and no `userId` field** (chosen). The self-claim's body is structurally different from the host-only POST's (the caller's id is implicit, not in the body); making this explicit at the schema layer prevents a confused client from sending `userId` and having it silently ignored. `additionalProperties: false` fails Fastify validation with 400 if `userId` is present, which is the right signal (the client is misusing the endpoint). The schema gets its own `$id` and `app.addSchema` registration so OpenAPI carries it as a named component.
  - **Reuse `assignParticipantBodySchema` and ignore the `userId` field** (rejected). Two endpoints sharing one body shape would imply they have the same contract; they don't. The OpenAPI documentation would be misleading; the client would not get a 400 if it sent `userId`, which is exactly the misuse the schema-level check is for.

- **No transactional batch of "claim N slots at once" (chosen — single-slot claim only).** A future iteration might want to let a moderator pre-claim both debater slots in one call for a managed scenario; this endpoint does not support that. Each claim is a single transaction, single slot, single event. Keeps the failure-mode matrix tractable (otherwise: partial success, transactional rollback semantics for multi-slot atomicity, etc.). Single-slot fits every M3-lobby scenario.

- **Test fixture pattern**: Cucumber scenarios reuse the existing user-fixture helpers (`alice` / `ben` / `maria` are seeded by the auth fixtures, per the precedent in `tests/behavior/steps/backend-participant-assignment.steps.ts`). No new fixture infrastructure needed. The "ben self-claims" scenarios authenticate as ben (using the existing auth-cookie helper) and POST to the endpoint — same shape as the host-only POST tests with the actor changed.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Shipped `POST /api/sessions/:id/invite/claim` in [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — added the new `selfClaimParticipantBodySchema` (sibling to `assignParticipantBodySchema`, omits `userId`, role enum restricted to the two debater slots) and a handler that lifts the host-only POST's `withTransaction` scaffold near-verbatim (visibility-gated `SELECT … FOR UPDATE` → host self-claim block → role-availability check → user-availability check → `INSERT … RETURNING` → `MAX(sequence)+1` → `validateEvent` → `appendSessionEvent` → COMMIT → post-COMMIT `wsBroadcast.emit`). Updated the file-header endpoint list accordingly.
- Vitest coverage extended: 11 new cases under `describe('POST /sessions/:id/invite/claim — debater self-claims a slot')` in [`apps/server/src/sessions/routes.test.ts`](../../../apps/server/src/sessions/routes.test.ts). Suite went from 3417 → 3428 passing. Cases pin the user-availability vs. role-availability ordering (a repeat self-claim by the same caller surfaces as `user-already-joined` before any role conflict is checked), the host-block 403, the 404-on-invisible-private-session rule, and the validation-failure modes for missing/invalid body fields.
- Cucumber coverage extended: 5 new scenarios in [`tests/behavior/backend/session-invite-self-claim.feature`](../../../tests/behavior/backend/session-invite-self-claim.feature) with step definitions in [`tests/behavior/steps/backend-session-invite-self-claim.steps.ts`](../../../tests/behavior/steps/backend-session-invite-self-claim.steps.ts). Suite went from 222 → 227 passing. Scenarios drive the happy path, double-claim-by-self, foreign-user role collision, unknown-session 404, and unauthenticated 401 against the migrated schema in pglite.
- No new `RejectionReason` codes added (every failure mode reuses an existing one per the Decisions §"No new RejectionReason codes"). No edits to `apps/server/src/errors.ts` or the methodology types.
- Amendment noted at implementation time: `@fastify/ajv-compiler`'s default `removeAdditional: true` silently strips a smuggled `userId` body field rather than returning the 400 the schema's `additionalProperties: false` implies. The security property is preserved (the handler always reads `request.authUser.id`, never the body) and is pinned by the Vitest case asserting the inserted row carries the caller's id even when a spoofed `userId` is sent. The deviation from the constraint's literal "should fail with 400" wording is documented here so a future reader of the refinement won't be surprised that the spoof-attempt test asserts on the row's contents rather than on a 400 response.
- e2e: not run, not required (Vitest + Cucumber per ADR 0022).
