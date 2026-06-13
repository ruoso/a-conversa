# sl_restart_endpoint — POST /api/sessions/:id/restart (reopen an ended session)

## TaskJuggler entry

`session_lifecycle.sl_restart_endpoint` — defined in
[`tasks/77-session-lifecycle.tji`](../../77-session-lifecycle.tji) (lines
38–43). Back-link note on the task:

> Mirror of the end endpoint
> (`backend.session_management.end_session_endpoint`): moderator-only, clears
> `sessions.ended_at` back to NULL and emits a new `session-restarted` event
> at the next sequence, atomically in one transaction; the row returns to
> 'live' (`started_at` stays set). Register the `session-restarted` event kind
> in the event-type registry (alongside `session_lifecycle_events`) and make
> the projection + replay loader tolerate it — it records the reopen for the
> change history and carries no state beyond that. 409 if the session is not
> currently ended (only an ended session can restart); 403 not-a-moderator for
> non-hosts; 404 for invisible sessions — same authority/visibility contract
> as end. Behavior tests per ADR 0007/0022.

This is the first task in the `session_lifecycle` work-stream; it gates
milestone `m_session_lifecycle` (M12) and is the backend predecessor for the
moderator "Restart session" button (`sl_mod_restart_action`).

## Effort estimate

**1d** (from the `.tji`). The handler is a near-exact mirror of the
already-shipped end endpoint; most of the effort is the new event-kind
registration across four code sites plus the SQL CHECK-constraint migration,
and the Cucumber coverage.

## Inherited dependencies

**Settled:**

- **`backend.session_management.end_session_endpoint`** — shipped in the M3
  backend. Refinement:
  [`tasks/refinements/backend/end_session_endpoint.md`](../backend/end_session_endpoint.md).
  It established the entire pattern this task mirrors: the visibility-gated
  `SELECT ... FOR UPDATE` row lock, the application-managed
  `MAX(sequence) + 1` allocator, the single-transaction "flip the column AND
  append the event" write, and the visibility-then-authority error ordering
  (404 before 403). Handler at
  `apps/server/src/sessions/routes.ts:2549–2750`.

- **`data_and_methodology.event_types.session_lifecycle_events`** — shipped
  2026-05-10. Refinement:
  [`tasks/refinements/data-and-methodology/session_lifecycle_events.md`](../data-and-methodology/session_lifecycle_events.md).
  Registered `session-created` / `session-ended` / `participant-joined` /
  `participant-left` as Zod-schema'd kinds in the discriminated event union
  (`packages/shared-types/src/events.ts`). This task adds a fifth sibling,
  `session-restarted`, following the same registration recipe.

**Pending:** none — both predecessors are complete.

## What this task is

Add `POST /api/sessions/:id/restart`: an authenticated, moderator-only
endpoint that reopens an **ended** session. In one transaction it (1) clears
`sessions.ended_at` back to `NULL` and (2) appends a new `session-restarted`
event at the next per-session sequence. The row returns to the `live` derived
status (`started_at` is untouched, `ended_at` is now NULL again). The endpoint
is the exact authority/visibility mirror of the end endpoint and reuses its
seams wholesale.

The supporting work is registering the new `session-restarted` event kind:

1. a forward-only migration extending the `session_events.kind` CHECK
   constraint;
2. an empty payload schema + registry + type-map entries in
   `packages/shared-types/src/events.ts`;
3. a projection/replay handler so the new kind replays cleanly (it carries no
   state — it only records the reopen in the change history).

## Why it needs to be done

The M3 backend can end a session but cannot undo it: an `ended_at` set by a
mis-click or a premature end is permanent. The operator registered restart on
2026-06-13 as the inverse control. This endpoint is the backend half; the
moderator "Restart session" button (`sl_mod_restart_action`, which
`depends !!sl_restart_endpoint`) is the UI half. Downstream, the replay loader
and projection must tolerate the new event kind so that a restarted session's
log still replays — the `sl_e2e` lifecycle Playwright spec asserts a restarted
row returns to live with both join-live and see-replay affordances present.

## Inputs / context

- **End endpoint handler (the template):**
  `apps/server/src/sessions/routes.ts:2549–2750`. Registered as
  `POST /api/sessions/:id/end` with `preHandler: app.authenticate`
  (`routes.ts:2550–2552`). Structure to mirror:
  - visibility-gated `SELECT id, host_user_id, ended_at FROM sessions ...
    FOR UPDATE` using `visibilityWhereFragment(...)`; zero rows → 404
    `not-found` (`routes.ts:2617–2628`);
  - authority check `existing.host_user_id !== userId` → 403
    `not-a-moderator` (`routes.ts:2644–2646`);
  - state check (end: `ended_at !== null` → 409; **restart inverts this**);
  - the column UPDATE returning the full row (`routes.ts:2665–2671`);
  - `SELECT COALESCE(MAX(sequence), 0) FROM session_events WHERE
    session_id = $1` then `nextSeq = maxSeq + 1` (`routes.ts:2700–2713`);
  - build envelope, `validateEvent(envelope)` (`routes.ts:2715–2732`),
    `appendSessionEvent(client, envelope)` (`routes.ts:2735–2737`);
  - 200 + `sessionRowToResponse(updatedRow)` (`routes.ts:2748`).
- **Transaction + helpers:** `withTransaction` (`routes.ts:1430–1476`),
  `sessionRowToResponse` (`routes.ts:1487–1503`), `toIsoString`
  (`routes.ts:1376–1381`); `validateEvent`
  (`apps/server/src/events/validate.ts`); `appendSessionEvent`
  (`apps/server/src/events/append.ts`).
- **Visibility gating:** `apps/server/src/sessions/visibility.ts`. Note the
  **live** gate carries `ended_at IS NULL` (`visibility.ts:222`) while the
  replay gate does not (`visibility.ts:240–264`). Restart must use the same
  visibility predicate the end endpoint uses — the host/participant path that
  retains access to ended sessions (`visibility.ts:196`), since an ended
  session is precisely what restart operates on. The host is always the
  caller (moderator-only), so the host always passes the visibility gate.
- **Errors:** `apps/server/src/errors.ts` — `not-a-moderator` (403, line
  195), `not-found` (404, lines 107–109). The 409 is constructed directly,
  as end does (`routes.ts:2655`).
- **Schema:** `sessions.ended_at TIMESTAMPTZ NULL`
  (`apps/server/migrations/0002_sessions.sql:53–55`); `started_at
  TIMESTAMPTZ NULL` added in
  `apps/server/migrations/0018_sessions_started_at.sql:42–43`. Derived status:
  `lobby` (started_at NULL) → `live` (started_at set, ended_at NULL) →
  `ended` (ended_at set). Clearing `ended_at` with `started_at` set returns
  the row to `live`.
- **Event registry (four sites to extend), `packages/shared-types/src/events.ts`:**
  - `eventKinds` array (line ~132, alongside `'session-ended'` at line 135);
  - a new `sessionRestartedPayloadSchema = z.object({})` + inferred type
    (near the other session-lifecycle schemas, ~line 224);
  - `eventPayloadSchemas` registry map (~line 760);
  - `EventPayloadMap` interface (~line 801).
  The envelope itself (`id, sessionId, sequence, kind, actor, payload,
  createdAt`) is shared per ADR 0021 — no envelope change needed.
- **Projection / replay loader:** `apps/server/src/projection/replay.ts` —
  exhaustive `switch (event.kind)` in `applyEvent` (~lines 1433–1485). Add a
  `case 'session-restarted'` with a handler mirroring `handleSessionCreated`
  (`replay.ts:117–125`): it returns the session's projected state to `open`
  (the live/open state) and pushes a `session-restarted` change-feed entry.
- **CHECK-constraint migration pattern:** latest is
  `apps/server/migrations/0016_session_events_proposal_withdrawn.sql` —
  `DROP CONSTRAINT IF EXISTS session_events_kind_check;` then `ADD CONSTRAINT
  ... CHECK (kind IN (...))` with the new kind appended. Next migration number
  is **0019**.
- **Existing Cucumber feature to mirror:**
  `tests/behavior/backend/end-session.feature` (69 lines) — Background +
  four scenarios (success/403/409/404).

## Constraints / requirements

1. **Mirror the end endpoint exactly** for authority + visibility: 404
   `not-found` for non-existent or invisible sessions (checked **before**
   authority, preserving existence-non-leak); 403 `not-a-moderator` for a
   visible non-host; reuse `visibilityWhereFragment` + `SELECT ... FOR UPDATE`
   + `withTransaction`.
2. **State precondition is the inverse of end:** restart requires the session
   to be **currently ended** (`ended_at IS NOT NULL`). A not-ended session
   (lobby or live) returns **409 `session-not-ended`**. Like end's 409, this
   is deliberately not idempotent.
3. **Atomic write:** the `UPDATE sessions SET ended_at = NULL WHERE id = $1`
   and the `session-restarted` event INSERT happen in one transaction at the
   next `MAX(sequence) + 1`. `started_at` is **not** touched.
4. **`session-restarted` carries no payload.** Empty object
   (`z.object({})`); the reopen is recorded by the event's existence at its
   sequence, nothing more. (Contrast `session-ended`, which carries
   `ended_at`; restart has nothing analogous to record — the cleared column is
   NULL.)
5. **Projection + replay tolerate the new kind** without throwing: the kind
   validates, replays, and (per requirement) restores the projected session
   state to open/live so a restarted-then-replayed log ends in the live state.
6. **Migration is forward-only** (ADR 0020): no down migration; drop +
   re-add the CHECK constraint inside the single migration transaction, with
   the full kind list reproduced (the migrations are not additive ALTERs —
   each restates the whole `CHECK (kind IN (...))` set).
7. **Response shape matches end:** 200 + the bare
   `sessionRowToResponse(row)` body (`id, hostUserId, privacy, topic,
   createdAt, endedAt`) — `endedAt` is now `null`.
8. **No widening of who may restart or replay.** Restart is moderator-only;
   it does not touch ADR 0045 replay-visibility gating.

## Acceptance criteria

All tests are durable and committed per **ADR 0022** (no throwaway
verifications); behavior coverage uses Cucumber + pglite per **ADR 0007**.

1. **New Cucumber feature** `tests/behavior/backend/restart-session.feature`,
   mirroring `end-session.feature`, exercising the production handler against
   the pglite-backed pool (this crosses the protocol + replay boundary, so
   Cucumber is the right pin per the backend/WS testing policy). Scenarios:
   - **Host restarts an ended session:** create → end → restart → 200; the
     `sessions` row's `ended_at` is null again; `started_at` is unchanged; a
     `session-restarted` event lands at the next sequence (one past the
     `session-ended` event); the response body's `endedAt` is null.
   - **Restart a not-ended (live/lobby) session → 409 `session-not-ended`;**
     the row's `ended_at` stays null and no `session-restarted` event is
     appended.
   - **Non-host caller → 403 `not-a-moderator`;** `ended_at` stays set
     (session remains ended).
   - **Unknown / invisible session id → 404 `not-found`** (the
     `00000000-0000-4000-8000-000000000000` unknown-id case, as end's feature
     does).
   - **Round-trip replays clean:** after end → restart, loading the session's
     event log through the replay loader yields a projection in the open/live
     state (no throw on the `session-restarted` kind).
2. **Vitest unit coverage in `packages/shared-types`** for the new kind:
   `session-restarted` is in `eventKinds`, its payload schema accepts `{}`
   and rejects extra keys (mirroring the existing per-kind schema tests in
   `packages/shared-types/src/events.test.ts`), and a full envelope with
   `kind: 'session-restarted'` validates via `validateEvent`.
3. **Vitest projection coverage** in `apps/server/src/projection` that
   `applyEvent` handles `session-restarted` — exhaustive-switch stays
   exhaustive (TypeScript `never` check), and a created→ended→restarted log
   projects to the open state.
4. **Migration lint clean:** `0019_session_events_session_restarted.sql`
   passes `pnpm run lint:migrations` (a DROP/re-ADD of a CHECK constraint is
   not a flagged destructive op; no NOT NULL / type change / rename).
5. **Build + full test suite green** before commit (global build/test gate).
6. **e2e is NOT in scope here** — this is a backend endpoint with no
   user-reachable surface of its own. The lifecycle Playwright flows (a
   moderator restarts an ended session; the row returns to live with both
   join-live and see-replay present) are owned by **`sl_e2e`**
   (`session_lifecycle.sl_e2e`, already in the WBS,
   `depends !sl_mod_lifecycle_actions` etc.) once the restart button
   (`sl_mod_restart_action`) makes it reachable. No deferral debt to register
   — `sl_e2e` already exists and already scopes this scenario.

## Decisions

- **D1 — `session-restarted` is a new, stateless event kind (not an
  idempotent column-clear, not a reuse of an existing kind).** The operator
  fixed this at registration: the reopen must be recorded on the immutable
  log so the change history and replay show it. **Alternatives rejected:**
  (a) *Clear `ended_at` with no event* — leaves the log unable to explain why
  a session that was ended is live again; breaks the
  log-is-source-of-truth invariant the lifecycle events established. (b)
  *Reuse `session-mode-changed`* — that kind means lobby→operate canvas
  transitions (ADR 0028) and maintains `started_at`; overloading it with
  reopen semantics conflates two distinct lifecycle axes. A dedicated kind is
  the same move every prior lifecycle/terminal event made (`entity-removed`,
  `session-mode-changed`, `withdraw-agreement`, `proposal-withdrawn`).
- **D2 — empty payload (`z.object({})`), no `restarted_at` field.** Unlike
  `session-ended` (which records the `ended_at` it set), restart's effect is
  setting a column to NULL — there is no new value worth carrying, and the
  event's `createdAt` envelope field already timestamps the reopen. Keeping
  the payload empty avoids a redundant, drift-prone field. The strict
  `z.object({})` (reject extra keys) matches the validator's existing
  per-kind strictness.
- **D3 — the 409 code is `session-not-ended`** (parallel to end's
  `session-already-ended`). It names the precondition that failed and is the
  natural inverse string; the moderator restart button surfaces it (the
  `.tji` note for `sl_mod_restart_action` says "surfaces the 409 not-ended
  case").
- **D4 — restart restores the projected session state to open/live on
  replay.** The projection handler mirrors `handleSessionCreated` (sets state
  to open) rather than inventing a third "reopened" state — downstream
  consumers already understand open vs ended; a restarted session is
  behaviorally a live session again. The change-feed entry
  (`{ kind: 'session-restarted' }`) is what signals the reopen to anything
  that wants to distinguish it.
- **D5 — no new ADR.** This task reuses two established seams without
  introducing a new one: the end-endpoint write pattern and the event-kind
  registration recipe. The semantic question ("how does reopening work?") was
  decided by the operator at WBS registration, not by this refinement, and
  the choice among alternatives is recorded above (D1–D2). Prior new-kind
  ADRs (0027/0028/0030/0037) each resolved a genuine semantic tension;
  `session-restarted` carries none — it is the literal inverse of an existing
  kind. The `sl_docs` task (`session_lifecycle.sl_docs`) runs the amendment
  pass that folds the `session-restarted` kind into DESIGN.md / architecture
  docs and the ADR 0021 envelope notes.
- **D6 — the migration restates the full `CHECK (kind IN (...))` list.** This
  is the established forward-only pattern (every `00NN_session_events_*.sql`
  migration drops and re-adds the constraint with the whole list, not an
  additive ALTER). `0019` appends `'session-restarted'` to the
  session-lifecycle group at the top of the list, with an explanatory header
  docblock mirroring `0016`'s.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-13.

- Added `POST /api/sessions/:id/restart` handler to `apps/server/src/sessions/routes.ts` — moderator-only, atomically clears `sessions.ended_at` and appends `session-restarted` event; 409 `session-not-ended` if not ended, 403 non-host, 404 invisible/unknown.
- Added `session-restarted` event kind to `packages/shared-types/src/events.ts` — empty payload schema (`z.object({})`), registered in `eventPayloadSchemas` and `EventPayloadMap`; tests in `packages/shared-types/src/events.test.ts`.
- Added migration `apps/server/migrations/0019_session_events_session_restarted.sql` — drops and re-adds `session_events_kind_check` CHECK constraint with `'session-restarted'` appended.
- Extended `apps/server/src/projection/replay.ts` + `types.ts` with `case 'session-restarted'` handler (restores projected state to open; pushes change-feed entry); Vitest coverage in `apps/server/src/projection/replay.test.ts`.
- Extended `apps/server/src/events/validate.test.ts` — added `session-restarted` to exhaustive `Record<EventKind>` maps.
- Extended `apps/server/src/test-mode/synthetic/rekey.ts` — added exhaustive-switch arm for `session-restarted`.
- Extended moderator graph helpers `apps/moderator/src/graph/affectedEntities.ts` + `eventSummary.ts` — added `case 'session-restarted'` arms (no affected entities; `NONE` summary).
- Added Cucumber feature `tests/behavior/backend/restart-session.feature` + step file `tests/behavior/steps/backend-restart-session.steps.ts` — 5 scenarios (200 success + seq advance, 409 session-not-ended, 403 non-host, 404 unknown, end→restart round-trip replay).
- Added `@a-conversa/shared-types: workspace:*` to root `package.json` devDependencies so Cucumber step files can resolve the import at runtime.
