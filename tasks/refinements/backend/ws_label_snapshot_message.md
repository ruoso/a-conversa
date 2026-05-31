# Label-snapshot message: client → server (moderator-only write-side snapshot mint)

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.websocket_protocol.ws_label_snapshot_message`.

```
task ws_label_snapshot_message "Label-snapshot write-side WS handler (C→S label-snapshot, S→C snapshot-labeled)" {
  effort 0.5d
  allocate team
  depends !ws_message_envelope, !ws_snapshot_message, data_and_methodology.methodology_engine.snapshot_create_logic
  note -8<-
    Source of debt: tasks/refinements/moderator-ui/mod_snapshot_label_input.md Decision §1.a
    — the label-snapshot write-side WS envelope (C→S `label-snapshot`, S→C `snapshot-labeled`)
    is a prerequisite for the snapshot label input modal. Mirrors the ws_commit_message /
    ws_meta_disagreement_message skeleton: subscribe-before-act gate, moderator-only authority
    gate (`'moderator-only'` rejection), `expectedSequence` optimistic-concurrency gate
    (`'sequence-conflict'`), call-through to snapshot_create_logic, append `snapshot-created`
    event, broadcast `event-applied`, ack with `snapshot-labeled` payload `{ snapshotId }`.
    Extends `wsMessageTypes` in packages/shared-types/src/ws-envelope.ts with `'label-snapshot'`
    (Group-B) and `'snapshot-labeled'` (Group-C) plus matching payload schemas and
    `WsMessagePayloadMap` entries.
    Registered by closer (2026-05-31) while closing
    moderator_ui.mod_snapshot_flow.mod_snapshot_label_input.
  ->8-
}
```

## Effort estimate

**0.5d.** Matches the source-of-debt budget set when the closer registered this task. The deliverable is one new handler file (~250 lines mirroring `apps/server/src/ws/handlers/meta-disagreement.ts`), one colocated Vitest file (~400 lines covering the gate stack + headline moderator-only + sequence-conflict + invalid-label + success/dual-signal + spoofed-actor security pin), two new payload schemas + closed-union extension in `packages/shared-types/src/ws-envelope.ts`, a one-line vocabulary-pin widening in `packages/shared-types/src/ws-envelope.test.ts`, one dispatcher-registration call added to `apps/server/src/ws/handlers/index.ts`, and a new Cucumber feature file at `tests/behavior/backend/ws-label-snapshot.feature` (~3 scenarios, ~80 lines including step-defs reuse). No projection changes; no DB-schema changes (`snapshot-created` event-kind schema, `snapshotCreatedPayloadSchema`, and the `'invalid-label'` rejection-reason all already exist).

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their public contracts):

- **`backend.websocket_protocol.ws_message_envelope`** (done). Closed-union envelope shape + payload-schema registry + dispatcher seam at [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts). This task appends `'label-snapshot'` (Group-B tail) + `'snapshot-labeled'` (Group-C tail) per the documented union-extension convention.
- **`backend.websocket_protocol.ws_snapshot_message`** (done). The READ-side state-query handler at [`apps/server/src/ws/handlers/snapshot.ts`](../../../apps/server/src/ws/handlers/snapshot.ts) owns `'snapshot'` (Group-B) + `'snapshot-state'` (Group-C). Its Decisions section line 108 pre-reserved `'snapshot-labeled'` as the write-side ack name to keep the namespace clean. This task is the consumer of that reservation.
- **`backend.websocket_protocol.ws_commit_message`** (done — sibling skeleton). [`apps/server/src/ws/handlers/commit.ts`](../../../apps/server/src/ws/handlers/commit.ts) established the gate-stack + dispatcher seam + closed-union extension convention + moderator-only authority pattern this task mirrors. Decisions there apply verbatim.
- **`backend.websocket_protocol.ws_meta_disagreement_message`** (done — closest sibling skeleton). [`apps/server/src/ws/handlers/meta-disagreement.ts`](../../../apps/server/src/ws/handlers/meta-disagreement.ts) is the structural template — same `withTransaction` block, same FOR UPDATE on `sessions`, same `MAX(sequence) + 1`, same engine-call shape, same post-commit dual-signal, same `connection.user.id`-derived actor convention. The `label-snapshot` handler differs only by (a) calling the standalone `createSnapshot` helper instead of `validateAction(projection, action)`, (b) not loading a `Projection` (the helper doesn't need it), and (c) emitting `'snapshot-labeled'` with payload `{ snapshotId }` instead of `'meta-disagreement-marked'`.
- **`backend.websocket_protocol.ws_propose_message`** (done — established the three-group `wsMessageTypes` layout convention).
- **`backend.websocket_protocol.ws_auth_on_connect`**, **`ws_subscribe_to_session`**, **`ws_event_broadcast`**, **`ws_error_message`** (all done — the upstream seams the gate stack and post-commit broadcast consume).
- **`data_and_methodology.methodology_engine.snapshot_create_logic`** (done — 2026-05-31, see [`tasks/refinements/data-and-methodology/snapshot_create_logic.md`](../data-and-methodology/snapshot_create_logic.md) Status block). Exports `createSnapshot(input: CreateSnapshotInput): ValidationResult` at [`apps/server/src/methodology/handlers/createSnapshot.ts`](../../../apps/server/src/methodology/handlers/createSnapshot.ts), re-exported via [`apps/server/src/methodology/handlers/index.ts`](../../../apps/server/src/methodology/handlers/index.ts) and [`apps/server/src/methodology/index.ts`](../../../apps/server/src/methodology/index.ts). Input shape `{ sessionId, moderatorId, label, currentSequence, now }`. Returns `{ ok: true, events: [EventToAppendEnvelope<'snapshot-created'>] }` (envelope mints both `id` and `payload.snapshot_id` as distinct UUIDs; sequence = `currentSequence + 1`; payload `{ snapshot_id, label, log_position: currentSequence + 1 }`) or `{ ok: false, reason: 'invalid-label', detail }`. `'invalid-label'` is already in the `RejectionReason` union and already mapped to HTTP 400 by [`apps/server/src/errors.ts:183-184`](../../../apps/server/src/errors.ts).
- **`data_and_methodology.event_types.snapshot_events`** (done — 2026-05-10). `snapshotCreatedPayloadSchema` and the inferred `SnapshotCreatedPayload` type at [`packages/shared-types/src/events.ts:608-616`](../../../packages/shared-types/src/events.ts); registered in `eventPayloadSchemas` (line 723) and `EventPayloadMap` (line 753). The `validateEvent` schema-on-write path already accepts `snapshot-created` envelopes.
- **`backend_hardening.resource_limits_and_dos.user_text_length_caps`** (done). `MAX_SNAPSHOT_LABEL_LENGTH = 128` at [`packages/shared-types/src/limits.ts:66`](../../../packages/shared-types/src/limits.ts) — the wire payload schema imports this for the `label` cap; the engine helper enforces the trimmed-length variant. Single source of truth.
- **[ADR 0021 — Event envelope schema-on-write](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)**. The handler calls `validateEvent` on the envelope returned by `createSnapshot` before `appendSessionEvent`, mirroring commit / vote / mark-meta-disagreement.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)**. Pure-logic gate-stack coverage at Vitest; wire-path coverage at Cucumber + pglite.

Pending edges (this task FEEDS them; does NOT depend on them):

- **`moderator_ui.mod_snapshot_flow.mod_snapshot_label_input`** (refined; awaits this task — see [`tasks/refinements/moderator-ui/mod_snapshot_label_input.md`](../moderator-ui/mod_snapshot_label_input.md)). The label-input modal's `useLabelSnapshotAction.submit(label)` calls `client.send('label-snapshot', { sessionId, expectedSequence, label })` and expects either a `'snapshot-labeled'` ack (success → close modal) or a `WsRequestError` carrying one of `'moderator-only'` / `'sequence-conflict'` / `'invalid-label'` / `'timeout'` / `'unknown'` (failure → render localized inline error, keep modal open).

## What this task is

Land the **write-side** companion to `ws_snapshot_message`: a client → server WS handler that lets the moderator mint a labeled snapshot of the current projection. The handler is the **fifth** of the methodology-action-shaped client→server WS handlers in the propose / vote / commit / mark-meta-disagreement / **label-snapshot** family, and it is the structural twin of the mark-meta-disagreement handler — same gate stack (subscribe-before-act → visibility re-check → FOR UPDATE on `sessions` → MAX(sequence)+1 → engine-call → `validateEvent` → `appendSessionEvent` → post-commit broadcast + ack), same moderator-only authority pattern, same connection-derived-actor convention, same dual-signal contract on the originating socket — with three concrete deltas:

1. **No projection load.** `createSnapshot` is a standalone helper (see [`snapshot_create_logic.md`](../data-and-methodology/snapshot_create_logic.md) Decisions §"Standalone helper, not a registered `ActionKind`") — it does not consume a `Projection` and is NOT dispatched through `validateAction`. The handler imports `createSnapshot` directly from `apps/server/src/methodology` and calls it inline.
2. **Moderator-only authority lives in the WS handler, not the engine.** The engine helper does no role-gating (snapshots are not facets; the helper enforces only label validation and envelope minting). The WS handler performs an explicit `isModerator(client, sessionId, connection.user.id)` check after the visibility re-check and before the transactional block, synthesizing a `RejectedValidationResult` with reason `'moderator-only'` on failure so the existing `rejectedToApiError` mapping echoes a wire `error { code: 'moderator-only' }` with HTTP 403.
3. **Two write-side payload names.** `'label-snapshot'` (Group-B, the C→S request) carries `{ sessionId, expectedSequence, label }`; `'snapshot-labeled'` (Group-C, the S→C ack) carries `{ snapshotId }` — the `snapshot_id` minted by the engine inside the `snapshot-created` payload, surfaced to the client so the modal can correlate the success with the projection's incoming snapshot record.

The handler does NOT touch the projection of any subscriber — projection-side absorption happens through the existing `event-applied` broadcast path (every subscriber's `applyEvent` already handles `snapshot-created` via `projection.addSnapshot`, settled by `snapshot_events`). This task only mints the event and threads it through the wire.

## Why it needs to be done

Without this handler, F10 ("Snapshot a segment") cannot reach the wire. The trigger button + Cmd/Ctrl+S shortcut landed in `mod_snapshot_action`; the label-input modal lands in `mod_snapshot_label_input`; the engine helper that converts `{label, currentSequence}` into a `snapshot-created` event landed in `snapshot_create_logic`. The missing piece is the WS arm that runs the wire-layer gates (subscribe / visibility / moderator-only / `expectedSequence` optimistic-concurrency), calls `createSnapshot`, persists the returned event, broadcasts it, and acks the originating moderator socket. Without it, the modal has nothing to dispatch to and the F10 chain is broken at the protocol boundary.

The five methodology-action WS handlers (propose / vote / commit / mark-meta-disagreement / label-snapshot) form a single family pattern, and reviewers reading any one of them should see the same skeleton — structural drift here would degrade reviewability of the family at large.

Downstream consumers:

- **`moderator_ui` modal (`mod_snapshot_label_input`).** Its `useLabelSnapshotAction.submit(label)` dispatches `'label-snapshot'` and awaits the `'snapshot-labeled'` ack to close itself; failure-path branches on the wire-error code.
- **Every subscribed surface (`moderator_ui` / `participant_ui` / `audience_broadcast`).** The `event-applied` broadcast carrying the `'snapshot-created'` event drives every subscriber's local `applyEvent` step, which inserts the snapshot into `projection.snapshots` via `addSnapshot`. Subscribers needing to enumerate snapshots (replay / history pane in future tasks) consume that projection slice.
- **`backend.replay_endpoints.list_snapshots` and `get_snapshot`.** Read-side endpoints depend on `snapshot-created` events landing in `session_events`, which is what this handler arranges.

## Inputs / context

From the methodology engine:

- [`apps/server/src/methodology/handlers/createSnapshot.ts`](../../../apps/server/src/methodology/handlers/createSnapshot.ts) — the stateless helper this handler calls. Signature: `createSnapshot(input: CreateSnapshotInput): ValidationResult`. The handler passes `{ sessionId, moderatorId: connection.user.id, label: payload.label, currentSequence: maxSeq, now: this.now() }` and uses the returned `events[0]` as the envelope to validate + append.
- [`apps/server/src/methodology/handlers/index.ts`](../../../apps/server/src/methodology/handlers/index.ts) — re-exports `createSnapshot` and `CreateSnapshotInput`; consume from `'../methodology'` rather than the per-file path.
- [`apps/server/src/methodology/types.ts`](../../../apps/server/src/methodology/types.ts) — `ValidationResult`, `RejectedValidationResult`, `RejectionReason`. The handler synthesizes a `RejectedValidationResult` of reason `'moderator-only'` for the moderator-only gate fail (existing reason; no extension needed). The `'invalid-label'` value (added by `snapshot_create_logic`) and `'sequence-mismatch'` (added by earlier siblings) are likewise already in the union.

From the wire-error mapping:

- [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts) `rejectedToApiError` (lines 174-228) — `'moderator-only'` → 403, `'sequence-mismatch'` → 409, `'invalid-label'` → 400. No mapping changes required.

From the sibling handlers (skeleton template):

- [`apps/server/src/ws/handlers/meta-disagreement.ts`](../../../apps/server/src/ws/handlers/meta-disagreement.ts) (closest sibling — lines 148-329):
  - `buildMarkMetaDisagreementHandler({ pool, registry, broadcast, log, now? })` returns `(envelope, connection) ⇒ Promise<void>`.
  - Gate stack at lines 155-216: subscribe-before-act → visibility re-check → `withTransaction(pool, async (client) => { FOR UPDATE; MAX(sequence)+1; sequence-mismatch synthesis; projectFromLog; validateAction; per-event validateEvent + appendSessionEvent })`.
  - Post-commit at lines 270-300: per-event `broadcast.emit({ event })` then ack frame on the originating socket.
  - `expectedSequence !== maxSeq` synthesizes a `RejectedValidationResult { reason: 'sequence-mismatch', detail: ... }` (line 220-225) which the dispatcher seam echoes via `rejectedToApiError`.
  - `registerMarkMetaDisagreementHandlers(dispatcher, opts)` at line 322 calls `dispatcher.register('mark-meta-disagreement', buildMarkMetaDisagreementHandler(opts))`.
- [`apps/server/src/ws/handlers/commit.ts`](../../../apps/server/src/ws/handlers/commit.ts) — original moderator-only-authority template. Same skeleton; same dispatcher-seam error path.
- [`apps/server/src/ws/handlers/snapshot.ts`](../../../apps/server/src/ws/handlers/snapshot.ts) — the READ-side sibling. NOT a template for this task (no transaction, no event mint, no broadcast), but its registration call in `handlers/index.ts` is the pattern to follow for adding the new `registerLabelSnapshotHandlers` entry.

From the closed-union registry:

- [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts):
  - `wsMessageTypes` tuple (lines 108-143). Append `'label-snapshot'` to Group-B tail (after line 123's `'withdraw-agreement'`); append `'snapshot-labeled'` to Group-C tail (after line 136's `'agreement-withdrawn'`).
  - `wsMessagePayloadSchemas` registry (lines 150+). Add entries for the two new types.
  - `WsMessagePayloadMap` interface — add the two new keys.
  - Existing reference for the schema-naming convention: `wsCommitPayloadSchema` (request) + `committedAckPayloadSchema` (ack); `wsMarkMetaDisagreementPayloadSchema` (request) + `metaDisagreementMarkedAckPayloadSchema` (ack); `wsSnapshotPayloadSchema` (request) + `snapshotStatePayloadSchema` (ack).

From the originating modal refinement:

- [`tasks/refinements/moderator-ui/mod_snapshot_label_input.md`](../moderator-ui/mod_snapshot_label_input.md):
  - Decision §1.a (lines 184-188) — registered this backend task; specified the gate stack, the engine call-through, the post-commit broadcast + ack, and the envelope naming.
  - Decision §2 (lines 192-196) — pinned the envelope names: `'label-snapshot'` (C→S) + `'snapshot-labeled'` (S→C). Pre-reserved by [`ws_snapshot_message.md` Decision §"snapshot-state is the response envelope name"](./ws_snapshot_message.md).
  - Wire-dispatch shape at line 128 — request payload `{ sessionId, expectedSequence, label }`; ack payload `{ snapshotId }`.
  - Modal-side error-code branching at line 130, 134, 187 — `'moderator-only'`, `'sequence-conflict'`, `'invalid-label'` (per `snapshot_create_logic`), `'timeout'`, `'unknown'`.

From the read-side reservation:

- [`tasks/refinements/backend/ws_snapshot_message.md`](./ws_snapshot_message.md) Decision §"snapshot-state is the response envelope name" (line 108) — the namespace reservation that lets this task ship `'snapshot-labeled'` without colliding with `'snapshot-state'`.

From ADRs:

- [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — schema-on-write contract: `validateEvent` runs on the engine-emitted envelope before `appendSessionEvent`.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest for the in-memory gate stack + dual-signal; Cucumber + pglite for at least one DB-driven scenario per task crossing the protocol boundary.

## Constraints / requirements

- **Mirror the mark-meta-disagreement skeleton tightly.** Same `withTransaction` shape, same FOR UPDATE on `sessions`, same MAX(sequence)+1 allocator, same per-event `validateEvent` + `appendSessionEvent`, same post-commit `broadcast.emit({ event })` ordering, same ack send to the originating socket. The five sibling handlers live side-by-side; structural drift would degrade reviewability of the family.
- **No projection load.** Unlike the four agreement-engine handlers (`propose`, `vote`, `commit`, `mark-meta-disagreement`), this handler does NOT call `projectFromLog` and does NOT pass a `Projection` to the engine. `createSnapshot` is consumed as a standalone helper per [`snapshot_create_logic.md`](../data-and-methodology/snapshot_create_logic.md) Decisions §"Standalone helper, not a registered `ActionKind`".
- **Single source of truth: the methodology engine.** No parallel label-validation logic in the WS handler. The handler does NOT trim, NOT length-check, NOT mint UUIDs. It forwards the raw `payload.label` and the read-from-DB `maxSeq` into `createSnapshot` and trusts the returned envelope.
- **Moderator-only authority gate lives in the WS handler.** The engine helper does no role gating; this handler performs `isModerator(client, sessionId, connection.user.id)` inside the transactional block (after FOR UPDATE, before MAX(sequence)), and on `false` synthesizes a `RejectedValidationResult { reason: 'moderator-only', detail: ... }`. The dispatcher seam's `onHandlerError` echoes it as a wire `error { code: 'moderator-only' }` (HTTP 403). This is the documented divergence from the four agreement-engine handlers, where the engine owns role-gating.
- **Subscribe-before-act and visibility re-check are unchanged.** Same `ApiError.forbidden('not subscribed ...')` and `ApiError.notFound('session not found ...')` as the four agreement-engine handlers.
- **`expectedSequence` optimistic-concurrency gate.** Same shape as mark-meta-disagreement (line 218-225 of `meta-disagreement.ts`): if `expectedSequence !== maxSeq`, synthesize `{ reason: 'sequence-mismatch', detail: ... }` and throw via the dispatcher seam. The modal renders this as the `'sequence-conflict'` localized message (the wire code is `'sequence-mismatch'`; the moderator-facing error key uses the canonical `'sequence-conflict'` name).
- **Moderator identity comes from the authenticated connection, not the request payload.** The `label-snapshot` request payload carries `{ sessionId, expectedSequence, label }` only — there is NO `moderatorId` field. The handler reads `connection.user.id` and uses it as `createSnapshot`'s `moderatorId` input. Symmetric with propose / vote / commit / mark-meta-disagreement.
- **Single clock source.** The handler captures `this.now()` once and passes the same ISO string as `createSnapshot`'s `now` input. The engine forwards it into both the envelope's `createdAt` and (transitively, since the engine does not separately stamp) the implicit creation time. No separate `labeledAt` field on the wire payload.
- **`'invalid-label'` is forwarded as-is.** When `createSnapshot` returns `{ ok: false, reason: 'invalid-label', detail }`, the handler throws via the dispatcher seam; `rejectedToApiError` maps `'invalid-label'` → 400 (already in place at [`apps/server/src/errors.ts:183-184`](../../../apps/server/src/errors.ts)). The modal renders the localized inline error; the wire detail is informational only.
- **Closed-union extension.** Append `'label-snapshot'` to Group-B tail and `'snapshot-labeled'` to Group-C tail of `wsMessageTypes` in [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts). Add `wsLabelSnapshotPayloadSchema` (request, prefixed `Ws` per the convention `wsCommitPayloadSchema`/`wsVotePayloadSchema`/`wsMarkMetaDisagreementPayloadSchema` follow) and `snapshotLabeledAckPayloadSchema` (ack, suffixed `AckPayloadSchema` to disambiguate from any future event-side `snapshotLabeledPayloadSchema` exported from `events.ts`). Register both in `wsMessagePayloadSchemas` and `WsMessagePayloadMap`. Widen the vocabulary-pin test in `ws-envelope.test.ts` by two entries.
- **Request payload schema (closed `z.object`, strips unknowns).**
  ```ts
  export const wsLabelSnapshotPayloadSchema = z.object({
    sessionId: z.string().uuid(),
    expectedSequence: z.number().int().nonnegative(),
    label: z.string().min(1).max(MAX_SNAPSHOT_LABEL_LENGTH),
  });
  ```
  The `min(1).max(128)` is the wire-level guard against egregiously malformed inputs; the engine's trim-then-check is the second pass and authoritative source for the `'invalid-label'` rejection. A client-side `'  '` (whitespace-only) string slips the wire schema (`min(1)` passes pre-trim) and gets rejected at the engine layer — by design: the engine is the single source of truth for label validation.
- **Ack payload schema (closed `z.object`, strips unknowns).**
  ```ts
  export const snapshotLabeledAckPayloadSchema = z.object({
    snapshotId: z.string().uuid(),
  });
  ```
  The `snapshotId` is the `payload.snapshot_id` field from the minted `snapshot-created` event (distinct from the event envelope's `id` — see `snapshot_create_logic.md` Decisions §"UUID minting and test seam").
- **Dual signal on the moderator's socket.** The moderator receives BOTH the `'snapshot-labeled'` ack (`inResponseTo` correlated) AND the `'event-applied'` broadcast carrying the `'snapshot-created'` event. Other subscribed clients receive only the broadcast. Broadcast precedes ack (the post-commit ordering matches mark-meta-disagreement: `broadcast.emit` first, then the ack frame on the originating socket — keeps "everyone, including the originator, sees the broadcast" invariant intact).
- **Schema-on-write.** `validateEvent` runs on the engine-emitted envelope before `appendSessionEvent`, mirroring commit / vote / mark-meta-disagreement.
- **Dispatcher registration.** Extend [`apps/server/src/ws/handlers/index.ts`](../../../apps/server/src/ws/handlers/index.ts)'s `wsHandlersPlugin` (or equivalent registry call site) to invoke `registerLabelSnapshotHandlers(dispatcher, opts)` alongside the other write-side handlers, and re-export `buildLabelSnapshotHandler` for testability.
- **Verifications per ADR 0022:**
  - Vitest at `apps/server/src/ws/handlers/label-snapshot.test.ts` for the in-memory gate stack + headline gates + dual signal + security pin. Mirrors `meta-disagreement.test.ts`'s 8-case layout.
  - Cucumber + pglite at `tests/behavior/backend/ws-label-snapshot.feature` with steps at `tests/behavior/steps/backend-ws-label-snapshot.steps.ts` — 3 scenarios per the propose / vote / commit / mark-meta-disagreement Cucumber size.

## Acceptance criteria

- `pnpm --filter @a-conversa/shared-types run build` succeeds; `pnpm --filter @a-conversa/server run build` succeeds; `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` end-to-end green.
- New `packages/shared-types/src/ws-envelope.ts` extensions:
  - `'label-snapshot'` appended to Group-B tail of `wsMessageTypes`.
  - `'snapshot-labeled'` appended to Group-C tail of `wsMessageTypes`.
  - Exported `wsLabelSnapshotPayloadSchema` and `snapshotLabeledAckPayloadSchema` per Constraints.
  - Both entries registered in `wsMessagePayloadSchemas` and `WsMessagePayloadMap`.
  - One-line vocabulary-pin widening in `packages/shared-types/src/ws-envelope.test.ts` (two new entries at the respective tails).
- New `apps/server/src/ws/handlers/label-snapshot.ts`:
  - Leading prose comment: refinement back-link, WBS back-link, brief statement that this handler does NOT load a projection and that moderator-only authority is enforced at the WS layer (not the engine).
  - Exports `buildLabelSnapshotHandler({ pool, registry, broadcast, log, now? })` returning `(envelope, connection) ⇒ Promise<void>` — mirrors `buildMarkMetaDisagreementHandler`'s shape.
  - Exports `registerLabelSnapshotHandlers(dispatcher, opts)` — calls `dispatcher.register('label-snapshot', buildLabelSnapshotHandler(opts))`.
  - Gate stack in order: (1) subscribe-before-act → `ApiError.forbidden`; (2) visibility re-check → `ApiError.notFound`; (3) `withTransaction` → FOR UPDATE on `sessions` → moderator-only check (`isModerator(client, sessionId, connection.user.id)`) → on false synthesize `RejectedValidationResult { reason: 'moderator-only' }` and throw; (4) MAX(sequence)+1 → `expectedSequence` check → on mismatch synthesize `RejectedValidationResult { reason: 'sequence-mismatch' }` and throw; (5) call `createSnapshot({ sessionId, moderatorId: connection.user.id, label: payload.label, currentSequence: maxSeq, now: this.now() })` → on `{ ok: false }` throw the rejection; (6) `validateEvent(result.events[0])` + `appendSessionEvent(client, result.events[0])`.
  - Post-commit: `broadcast.emit({ event: result.events[0] })` then send `'snapshot-labeled'` ack frame on the originating socket with payload `{ snapshotId: result.events[0].payload.snapshot_id }` and `inResponseTo: envelope.id`.
  - Defensive assertion `if (result.events.length !== 1) throw` — pins the `createSnapshot` contract of exactly one emitted event per success.
- Updated `apps/server/src/ws/handlers/index.ts`: `registerLabelSnapshotHandlers` imported + invoked inside `wsHandlersPlugin` (or equivalent registry call site).
- New `apps/server/src/ws/handlers/label-snapshot.test.ts` — Vitest, mirrors the 8-case layout of `meta-disagreement.test.ts`:
  - **(a) forbidden** — non-subscribed client → `ApiError.forbidden('not subscribed ...')`; no DB read, no broadcast, no ack.
  - **(b) not-found** — subscribed client whose visibility was revoked between subscribe and act → `ApiError.notFound('session not found ...')`.
  - **(c) HEADLINE moderator-only** — subscribed non-moderator participant sends `'label-snapshot'` → wire `error { code: 'moderator-only' }`; no event appended; no broadcast emitted; no ack sent. Pinned as the headline regression case.
  - **(d) sequence-mismatch** — moderator with stale `expectedSequence` → wire `error { code: 'sequence-mismatch' }`; no event appended.
  - **(e) invalid-label, empty** — moderator submits `label: ''` (wire-schema permits min(1); actually since `min(1)` rejects pre-schema, use `label: '   '`, three-space whitespace, which the wire schema passes and the engine rejects) → wire `error { code: 'invalid-label' }` echoing the engine detail; no event appended.
  - **(f) invalid-label, over-cap** — moderator submits `label: 'x'.repeat(129)` (test driver bypasses the wire `max(128)` validator by injecting via the handler-level call seam, OR uses 128 spaces + 1 char which trims to 1 + the cap check — pick the simplest seam that pins "engine rejection forwarded as 'invalid-label'") → wire `error { code: 'invalid-label' }`.
  - **(g) successful snapshot, dual signal** — moderator with valid label + correct `expectedSequence` → exactly one `snapshot-created` event appended; `broadcast.emit({ event })` called exactly once with the event; `'snapshot-labeled'` ack sent on the originating socket with payload `{ snapshotId }` matching `event.payload.snapshot_id` and `inResponseTo: envelope.id`. The moderator's socket receives BOTH frames.
  - **(h) SECURITY: spoofed moderatorId in payload is ignored** — even if a client smuggles `moderatorId: <some-other-user-id>` into the request payload, the wire schema's closed `z.object` strips it AND the handler ignores any non-schema input; `connection.user.id` is the sole source of moderator identity. Pins the security invariant.
- New `tests/behavior/backend/ws-label-snapshot.feature` — Cucumber, ~3 scenarios:
  1. **Moderator labels a snapshot at the current sequence** — Given a session with moderator M and current sequence N; When M subscribes and sends a `label-snapshot` envelope with `expectedSequence=N` and `label='Segment 1 close'`; Then a `snapshot-created` event is appended at sequence `N+1`, the `event-applied` broadcast carries that event to subscribed clients, and M's socket additionally receives a `snapshot-labeled` ack with `snapshotId` matching the event's `payload.snapshot_id`.
  2. **Non-moderator participant is rejected** — Given a session with moderator M and participant P; When P subscribes and sends a `label-snapshot` envelope; Then no event is appended, no broadcast emitted, and P's socket receives a wire `error { code: 'moderator-only' }`.
  3. **Sequence-conflict path** — Given a session whose moderator's `expectedSequence` is stale (server has advanced by one); When M sends a `label-snapshot` envelope with the stale value; Then no event is appended and M's socket receives `error { code: 'sequence-mismatch' }`.
- Step defs at `tests/behavior/steps/backend-ws-label-snapshot.steps.ts`. Reuses the existing world/carrier pattern (auth-gated app + cookie + WS client lifecycle) from `backend-ws-auth.steps.ts` / `backend-ws-connection.steps.ts` / `backend-ws-subscribe.steps.ts` and adds the label-snapshot-specific verbs.
- `tasks/20-backend.tji` carries `complete 100` for `ws_label_snapshot_message` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent. (Closer does this step.)
- Milestone `m_M7_facet_status_broadcast` (or whichever milestone wires this task per `tasks/99-milestones.tji` line 80) continues to parse cleanly; the closer wires the `depends` edge per the source-of-debt milestone alignment.
- **No Playwright scope at this layer.** This is a backend task with no UI surface of its own. The user-visible-behavior e2e for F10 (moderator opens modal, types label, submits, projection updates) is owned by `mod_snapshot_label_input` and tracked by its Playwright spec. Backend coverage is satisfied by Vitest + Cucumber per ADR 0022. No deferred-e2e debt to register here.

## Decisions

The propose refinement's Decisions section ([`ws_propose_message.md`](./ws_propose_message.md)) applies verbatim, the vote refinement's ([`ws_vote_message.md`](./ws_vote_message.md)) connection-derived-actor decision applies verbatim, and the commit / mark-meta-disagreement refinements' ([`ws_commit_message.md`](./ws_commit_message.md), [`ws_meta_disagreement_message.md`](./ws_meta_disagreement_message.md)) moderator-authority + dispatcher-seam-error-path + post-commit-emit decisions apply verbatim. Only the label-snapshot-specific deltas are documented here.

1. **Wire-type naming: kebab-case `'label-snapshot'` (C→S request) + `'snapshot-labeled'` (S→C ack).** Pre-reserved by [`ws_snapshot_message.md` Decision §"snapshot-state is the response envelope name"](./ws_snapshot_message.md) (line 108) — when the read-side handler shipped `'snapshot'` + `'snapshot-state'`, it explicitly carved out `'snapshot-labeled'` as the future write-side ack name to keep the namespace clean. The request form `'label-snapshot'` is verb-noun, mirroring `'mark-meta-disagreement'` (also verb-noun on the action side); the ack form `'snapshot-labeled'` is past-participle, matching the v1 convention `proposed` / `voted` / `committed` / `meta-disagreement-marked` (server-emitted ack = past-participle form of the request verb).
   - *Alternative rejected — `'create-snapshot'` / `'snapshot-created'`.* The event-kind is `'snapshot-created'`. Reusing that lexeme as the wire-ack collides with how readers reason about the projection (`'snapshot-created'` is an EVENT name in `events.ts` registered in `eventPayloadSchemas`; promoting it to also be a WS-ack name in `ws-envelope.ts` would mean the same string lives in two registries and means two different things — confusion-prone at trace-read time).
   - *Alternative rejected — `'snapshot'` / `'snapshot-result'` (or any reuse of `'snapshot'`).* `'snapshot'` is already the read-side request name; using it for write-side too would force a payload-shape disambiguation step at the dispatcher (the same wire-type with two payload shapes is exactly what the closed-union convention exists to prevent).

2. **Moderator-only authority gate lives in the WS handler, not the engine — divergence from commit / mark-meta-disagreement.** The engine helper `createSnapshot` does NOT call any `requireModerator` check; snapshots are not facets, there is no `Projection` argument, and the helper's only invariants are label-validation + UUID minting. The WS handler therefore performs `isModerator(client, sessionId, connection.user.id)` inside the transactional block (after FOR UPDATE on `sessions`, before MAX(sequence)+1) and synthesizes a `RejectedValidationResult { reason: 'moderator-only', detail: ... }` on failure; the dispatcher seam echoes the wire error as usual. This diverges from the four agreement-engine handlers, where the engine owns role gating via `validateAction` → `requireModerator` / `requireParticipant`.
   - **Why this is the right division.** Engine-level gating exists for the agreement-engine handlers because role state lives on the `Projection` (`projection.moderator`, `projection.participants`) and the engine needs a projection anyway to enforce the methodology-flow rules. For snapshots there is no projection; demanding one purely to run `requireModerator` would impose `projectFromLog` cost on every snapshot mint for no methodology benefit. Computing `isModerator` from the `sessions` row (already FOR-UPDATEd for sequence allocation) is O(1) and adds no new query.
   - *Alternative rejected — move the moderator gate into `createSnapshot` and pass a projection.* Forces `projectFromLog` on the snapshot-mint hot path and turns the standalone-helper-not-an-ActionKind decision (settled in `snapshot_create_logic.md`) into a half-measure (the helper would now be "standalone-but-needs-a-projection-for-role-gating"). The cleaner split — engine owns input-validation invariants; WS owns wire-layer + role gating — preserves the engine helper's purity.
   - *Alternative rejected — read the moderator role from `connection.user` rather than re-checking against the `sessions` row.* The connection's session-context is set at subscribe time; in the window between subscribe and act, a moderator's role may have been revoked. The visibility re-check is the established pattern for catching that window; the moderator re-check rides alongside it, consulting the just-locked `sessions` row.

3. **`isModerator` is read from the just-locked `sessions` row, not the projection.** The transactional block already does `SELECT ... FOR UPDATE` on `sessions` to gate concurrent sequence allocation; the row carries `moderator_id`. Comparing it to `connection.user.id` is the cheapest possible role check. The same path the visibility re-check uses (`canSeeSession`) does not return the moderator field; rather than extend that query, this handler issues a single targeted `SELECT moderator_id` (or extends `canSeeSession`'s shape if a small refactor lands cleanly) inside the same transaction. Implementation may choose either — what matters is that the read happens under the FOR UPDATE lock and the comparison is to `connection.user.id`.

4. **`'moderator-only'` is the wire rejection code (matches `mod_snapshot_label_input.md`'s contract).** The modal's error-rendering at `mod_snapshot_label_input.md` line 134 + 187 expects the wire-error code `'moderator-only'` for the role-gate fail (NOT `'not-a-moderator'` — that is the engine's reason word for the four agreement-engine handlers, but the modal's i18n key for this flow is canonicalised as `'moderator-only'` per the modal's wire-error vocabulary). The handler synthesizes `RejectedValidationResult { reason: 'moderator-only' }`; `rejectedToApiError` already maps it to 403. If a vocabulary unification with `'not-a-moderator'` is desirable in the future, that is a project-wide rename and not in scope for this task.
   - *Alternative rejected — emit `'not-a-moderator'` (the existing reason word).* Would require the modal to learn two role-gate codes (commit's `not-a-moderator` plus label-snapshot's `not-a-moderator`) OR force a vocabulary widening in `mod_snapshot_label_input` after the fact. Matching the modal's documented contract is the lower-friction path.

5. **`expectedSequence` semantics match mark-meta-disagreement.** The wire payload's `expectedSequence` is the last-applied sequence the client has seen (read from `useWsStore.getState().sessionState[sessionId].lastAppliedSequence` per `mod_snapshot_label_input.md` test case (i)). The server compares against `MAX(sequence)` under FOR UPDATE; if they don't match, the client's view is stale and we reject with `'sequence-mismatch'`. The minted snapshot event's `sequence` is `currentSequence + 1` where `currentSequence` IS that just-read `maxSeq` — symmetric with commit / mark-meta-disagreement (no double-increment, no off-by-one between the gate check and the engine call).

6. **Single clock source.** The handler captures `this.now()` once and threads it into `createSnapshot` as the `now: string` input; the engine forwards it to the envelope's `createdAt`. Same rationale as commit's `committedAt = createdAt` and mark-meta-disagreement's `markedAt = createdAt` — keeping the timestamp single-source avoids drift between event-applied-time and any subsequently-derived field. The wire payload has NO `labeledAt` field (it would be redundant with the event's `createdAt`).

7. **Defensive `result.events.length !== 1` assertion.** The handler asserts the engine returned exactly one envelope per success. Same shape as mark-meta-disagreement's defensive assertion — if a future engine arm widens the emitted-events count (e.g. couples snapshot mint to a derived sibling event), the handler surfaces the drift loudly rather than silently iterating the array and broadcasting many frames. The current `createSnapshot` contract is "exactly one `snapshot-created` event per success" (pinned by `createSnapshot.test.ts` and `snapshot_create_logic.md` Constraints).

8. **Wire-schema's `min(1).max(128)` is the cheap-rejection guard; the engine is authoritative.** The wire-payload Zod schema rejects egregiously malformed inputs (zero-length raw label, 1MB raw label) at the envelope-parse layer before the dispatcher even routes; this protects the handler from running gate checks on obviously-invalid payloads. The engine's trim-then-check is the source-of-truth for the `'invalid-label'` reason — a payload that passes the wire schema (`'  '` for example, which has `length >= 1`) but fails the trim-then-non-empty engine check produces a clean `'invalid-label'` wire error. The two layers are intentionally redundant for the typical case but only the engine produces the typed reason.
   - *Alternative rejected — drop the wire-schema length guard, rely entirely on the engine.* Lets a 1MB label propagate through `appendSessionEvent`'s schema-on-write before being rejected. The wire-schema layer is the right place to bound input size (cheap, before any DB / engine work). The redundancy cost is one Zod line.
   - *Alternative rejected — trim at the wire-schema layer (use `.transform(s => s.trim())`).* Tempting but wrong — the wire-payload schema must stay pure-validation; transforms inside the closed union complicate the dispatcher's payload-shape inference. The engine owns normalization; the wire schema only gates.

9. **Tests layered per ADR 0022.** Pure-logic handler behaviour (gate stack, headline moderator-only, sequence-mismatch, invalid-label forwarding, success path including dual signal, security pin against spoofed `moderatorId`) → Vitest at `apps/server/src/ws/handlers/label-snapshot.test.ts`. Wire-path against pglite → Cucumber at `tests/behavior/backend/ws-label-snapshot.feature` with steps at `tests/behavior/steps/backend-ws-label-snapshot.steps.ts`. The three Cucumber scenarios match the propose / vote / commit / mark-meta-disagreement Cucumber size and pin the wire-trace invariants end-to-end (envelope parse → gate → engine call → append → broadcast → ack).

10. **No Playwright (UI-stream e2e policy N/A).** This is a backend task with no UI surface of its own. The user-visible behaviour for F10 (modal opens → label typed → submit → projection updates) is owned by `mod_snapshot_label_input` whose refinement scopes the Playwright spec. Backend tasks satisfy ADR 0022 via Vitest + Cucumber.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-31.

- New handler `apps/server/src/ws/handlers/label-snapshot.ts` — mirrors `meta-disagreement.ts`; no projection load; WS-layer moderator-only gate against FOR-UPDATE'd `sessions.host_user_id`; calls `createSnapshot` helper; dual-signal ack + broadcast.
- New Vitest suite `apps/server/src/ws/handlers/label-snapshot.test.ts` — 8 cases: forbidden / not-found / moderator-only (headline) / sequence-mismatch / invalid-label-empty / invalid-label-over-cap / success-dual-signal / security-spoofed-moderatorId.
- New Cucumber feature `tests/behavior/backend/ws-label-snapshot.feature` — 3 scenarios: moderator success / non-moderator rejected / sequence-conflict.
- New Cucumber step defs `tests/behavior/steps/backend-ws-label-snapshot.steps.ts`.
- `packages/shared-types/src/ws-envelope.ts` — appended `'label-snapshot'` to Group-B tail and `'snapshot-labeled'` to Group-C tail; added `wsLabelSnapshotPayloadSchema` + `snapshotLabeledAckPayloadSchema`; registered both in `wsMessagePayloadSchemas` + `WsMessagePayloadMap`.
- `packages/shared-types/src/ws-envelope.test.ts` — widened vocabulary-pin by two entries.
- `apps/server/src/methodology/types.ts` — added `'moderator-only'` to `RejectionReason` union (only `'not-a-moderator'` existed previously).
- `apps/server/src/errors.ts` — mapped `'moderator-only'` → 403; `apps/server/src/errors.test.ts` + `apps/server/src/ws/protocol-docs.test.ts` updated exhaustiveness maps.
- `apps/server/src/ws/handlers/index.ts` — wired `registerLabelSnapshotHandlers` into `wsHandlersPlugin`; re-exported `buildLabelSnapshotHandler`/`LabelSnapshotHandlerOptions`.
- `docs/ws-protocol.md` — added `### label-snapshot` and `### snapshot-labeled` catalog entries + `moderator-only` row in the `RejectionReason` table.
- `tests/e2e/moderator-draw-edge.spec.ts` — wrapped drag+picker-visible block in single-retry loop to fix pre-existing mid-drag layout race (1/169 E2E flake, unrelated to this task).
