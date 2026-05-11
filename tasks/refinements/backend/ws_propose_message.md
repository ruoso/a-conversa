# Propose message: client → server

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.websocket_protocol.ws_propose_message`
**Effort estimate**: 1d
**Inherited dependencies**: `backend.websocket_protocol.ws_message_envelope` (settled — closed `WsMessageType` enum + `WsDispatcher`), `backend.websocket_protocol.ws_auth_on_connect` (settled — `connection.user` populated by the upgrade gate), `backend.websocket_protocol.ws_subscribe_to_session` (settled — `app.wsSubscriptions.connectionsForSession(sessionId)` snapshot lookup), `backend.websocket_protocol.ws_event_broadcast` (settled — `app.wsBroadcast.emit({ event })` bus + centralized `appendSessionEvent` helper + post-commit-emit invariant), `backend.websocket_protocol.ws_error_message` (settled — canonical wire `error` envelope + `onHandlerError` echoes `ApiError`-shaped throws), `data_and_methodology.event_types.proposal_events` (settled — `ProposalPayload` discriminated union + `proposalPayloadSchema`), `data_and_methodology.methodology_engine.*` (settled — `validateAction` + `proposeHandler` for the eight tightened sub-kinds).

## What this task is

Land the **first of five** client→server methodology-action WS handlers. The propose handler:

1. Validates that the client is **subscribed** to the target session (subscribe-before-act gate).
2. Re-checks `canSeeSession(pool, sessionId, userId)` so a session that became invisible between subscribe and propose is rejected with the same existence-non-leak rule the HTTP routes use.
3. Loads the session's projection (replay from `session_events`), allocates `MAX(sequence)+1` under `FOR UPDATE` row lock on `sessions`, builds a `MethodologyAction.propose` from the payload + the authenticated `connection.user.id`, runs it through `validateAction(projection, action)`, INSERTs the resulting event via the centralized `appendSessionEvent` helper, COMMITs, then emits `app.wsBroadcast.emit({ event })` AFTER the transaction commits.
4. Sends a `proposed` ack envelope to the originating client (`inResponseTo` correlated to the request's `id`).
5. On rejection — at any gate (subscribe, visibility, methodology engine, optimistic-concurrency mismatch) — throws an `ApiError`-shaped value so the dispatcher's `onHandlerError` seam echoes a typed `error` envelope on the wire (per `ws_error_message`).

The handler delegates auth (already populated on the connection by `ws_auth_on_connect`), visibility (`canSeeSession`), schema-on-write (the methodology engine's universal checks + `validateEvent`), and event-append SQL (`appendSessionEvent`). No parallel implementations.

Scope is **propose only**. Vote / commit / mark-meta-disagreement / snapshot are separate downstream tasks that follow this same shape — same handler-builder skeleton, same union-extension convention, same `rejectedToApiError(rejection)` wiring.

## Why it needs to be done

The participant tablet and moderator console will both drive propose actions over the WebSocket — the live UI mints proposals in response to participants' tap-and-type interactions and expects an immediate `proposed` ack plus a subsequent `event-applied` broadcast as the projection-update signal. Without this handler, the only path to write a `proposal` event is the (not-yet-existing) HTTP route, which would force the live UIs to maintain a dual transport surface and would lose the request-response correlation `inResponseTo` provides over the duplex pipe.

Downstream consumers:

- `participant_ui` and `moderator_ui` propose facets, components, axiom-marks, etc. via this surface.
- The four sibling message-type tasks (`ws_vote_message`, `ws_commit_message`, `ws_meta_disagreement_message`, `ws_snapshot_message`) inherit the gating skeleton + the union-extension layout this task establishes.
- The reconnection task (`ws_reconnection_handling`) replays missed propose events through the same `event-applied` broadcast surface — this task is what feeds that stream.

## Inputs / context

From [`apps/server/src/methodology/types.ts`](../../../apps/server/src/methodology/types.ts):

- `ProposeAction` extends `ActionEnvelopeBase` with `kind: 'propose'` + `proposal: ProposalPayload`. The envelope's `requester`, `sessionId`, `eventId`, `sequence`, `actor`, `createdAt` are populated by the handler before the engine call.
- `ValidationResult` discriminated on `ok`. `Valid` carries `events: ReadonlyArray<EventToAppend>` the handler must persist in order; `Rejected` carries `reason: RejectionReason` + `detail: string`.

From [`apps/server/src/methodology/engine.ts`](../../../apps/server/src/methodology/engine.ts):

- `validateAction(projection, action)` runs the three universal checks (session match, sequence match, participant gate) BEFORE dispatching to `proposeHandler`. The handler therefore does NOT re-implement the participant gate.

From [`apps/server/src/methodology/handlers/propose.ts`](../../../apps/server/src/methodology/handlers/propose.ts):

- `proposeHandler` is the per-sub-kind switch; eight arms run real validators (`decompose`, `interpretive-split`, `axiom-mark`, `meta-move`, `edit-wording`, `break-edge`, `amend-node`, `annotate`), three fall through to the universal-pass placeholder (`classify-node`, `set-node-substance`, `set-edge-substance`).

From [`apps/server/src/events/append.ts`](../../../apps/server/src/events/append.ts):

- `appendSessionEvent(client, event)` is the single SQL surface; the helper INSERTs inside the caller's transaction and returns the event for the post-commit broadcast emit. The handler MUST route through it.

From [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts):

- Every event-append site already uses the FOR UPDATE on `sessions` + `MAX(sequence)+1 inside the transaction` + `appendSessionEvent` + post-commit `app.wsBroadcast.emit(...)` pattern. The propose handler mirrors this exactly.

From [`apps/server/src/ws/error-envelope.ts`](../../../apps/server/src/ws/error-envelope.ts):

- The dispatcher's `onHandlerError` seam already discriminates `ApiError`-shaped throws via `isApiErrorShape` and echoes their `code` + `message` on the wire. The handler throws `ApiError` (or `rejectedToApiError(rejection)`) and the seam does the rest — `sendWsError` is NOT called directly by the handler.

From [`apps/server/src/ws/subscriptions.ts`](../../../apps/server/src/ws/subscriptions.ts):

- `app.wsSubscriptions.connectionsForSession(sessionId).includes(connection.connectionId)` is the subscribe-before-act check.

From [ADR 0020](../../../docs/adr/0020-postgres-write-path-locking-and-event-ordering.md): the FOR UPDATE row-lock + UNIQUE (session_id, sequence) write-path serialisation.

From [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md): schema-on-write — `validateEvent` runs at append time.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): pure-logic builder behaviour → Vitest; wire-path behaviour against pglite → Cucumber.

## Constraints / requirements

- **Single source of truth**: the methodology engine. The handler builds a `MethodologyAction.propose` from the payload + the authenticated requester and calls `validateAction(projection, action)`. NO parallel propose-validation logic.
- **Single append helper**: `appendSessionEvent(client, event)` for the INSERT. NO inline SQL.
- **Post-commit-emit invariant**: `app.wsBroadcast.emit(...)` runs AFTER the transaction's COMMIT (mirrors `ws_event_broadcast`'s decision). A subscriber that observed a frame for a rolled-back row would be lying.
- **Subscribe-before-act gate** is the first check. A client that issues a `propose` envelope without first subscribing receives a typed `forbidden` error. Rationale below in Decisions.
- **Visibility re-check** runs AFTER subscribe. A session that became invisible between subscribe and propose surfaces as `not-found` — same existence-non-leak rule the subscribe handler inherits.
- **Optimistic-concurrency**: the client's `expectedSequence` MUST equal `MAX(sequence)` at the point of the FOR UPDATE. Mismatch surfaces as `sequence-mismatch` (409) — handled uniformly with the engine's universal `sequence-mismatch` check via `rejectedToApiError`.
- **Throws, doesn't `sendWsError`**: every rejection throws an `ApiError`-shaped value; the dispatcher's `onHandlerError` echoes it. The handler does NOT call `sendWsError` directly.
- **Closed-union extension** (`packages/shared-types/src/ws-envelope.ts`): two new entries — `propose` (C→S) and `proposed` (S→C ack). The future four sibling tasks (vote/commit/meta/snapshot) extend the same union, so the layout convention is documented in Decisions to keep extensions merge-friendly.
- **Proposer's dual signal**: the proposer receives BOTH the `proposed` ack (request-correlated via `inResponseTo`) AND the `event-applied` broadcast (the standard projection-update signal every subscribed client receives). Documented contract.
- **Schema-on-write**: `validateEvent` runs on the constructed event envelope before `appendSessionEvent` (consistent with every existing append site).

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm --filter @a-conversa/shared-types run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; ~940 baseline tests still pass plus new handler tests + the vocabulary pin update.
- `pnpm run test:behavior:smoke` (Cucumber) green; 192 baseline scenarios still pass plus the new propose feature.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- A reader of `apps/server/src/ws/handlers/propose.ts` can identify exactly where each sibling message-type task (vote/commit/meta/snapshot) will plug in (the same builder skeleton + gating-ladder shape).
- A reader of `packages/shared-types/src/ws-envelope.ts` can see the documented union-extension convention (C→S types grouped together; their server-emitted ack/result counterparts grouped together immediately after).

## Decisions

- **Subscribe-before-act gate.** A `propose` envelope is rejected with `ApiError.forbidden('not subscribed to this session — send a subscribe envelope first')` (HTTP code `'forbidden'`, mapped to 403 on the HTTP surface; on the WS wire the code rides through as the `error.payload.code` discriminator) when the client is not in `app.wsSubscriptions.connectionsForSession(sessionId)`. Rationale for **reusing `'forbidden'` rather than minting a new `RejectionReason`**:
  - The methodology engine's `RejectionReason` union models methodology semantics (participant gate, sequence match, role gates, methodology-state rejections). "You forgot to subscribe" is a **protocol-layer** failure — the WS surface owns it, not the engine. Minting `'not-subscribed'` as a `RejectionReason` would force every HTTP route (which doesn't have a subscription concept) to handle a status code that's structurally unreachable from HTTP.
  - `'forbidden'` is the canonical HTTP/WS code for "you are authenticated but lack the standing for this action right now" — exactly the semantics here. The `message` field carries the specific reason. The protocol-layer-vs-methodology-layer split keeps the `RejectionReason` vocabulary focused.
  - `'not-a-participant'` was considered and rejected: that code means "you are not a participant in the methodology sense" (the engine's universal gate). Subscribing is a transport concept; a non-participant who tries to propose hits the engine's `not-a-participant` rejection at the `validateAction` call, not this earlier gate. Conflating the two would mask the distinction in logs and on-wire diagnostics.

- **Methodology engine reuse via `validateAction`.** The handler constructs `MethodologyAction.propose` from the payload + `connection.user.id` and calls `validateAction(projection, action)`. The engine runs three universal checks (session match, sequence match, participant gate) and dispatches to `proposeHandler`. The propose handler's eight tightened sub-kind arms (per `proposeHandler` in `methodology/handlers/propose.ts`) and three universal-pass arms run unchanged. The WS handler does NOT re-implement validation; rejections surface as `RejectedValidationResult` → `rejectedToApiError(rejection)` → thrown → dispatcher seam echoes on the wire.

- **`proposed` ack + `event-applied` broadcast — the dual signal.** When the propose succeeds, the proposer receives **two** server-emitted envelopes:
  1. **`proposed` ack** — `{ type: 'proposed', id: <server uuid>, inResponseTo: <client req id>, payload: { sessionId, sequence, eventId } }`. Sent directly on the proposer's socket. The `inResponseTo` correlation is the authoritative "your request landed" signal — the client clears its in-flight propose state on this frame.
  2. **`event-applied` broadcast** — `{ type: 'event-applied', id: <server uuid>, payload: { event } }`. Fired by the bus subscriber against every connection in `connectionsForSession(sessionId)`, which includes the proposer (the proposer subscribed first — that's the gate above). The broadcast IS the projection-update signal; UIs incrementally apply `event` to their cached projection.
  Both frames are required: the ack carries `inResponseTo` (the only deterministic per-request correlator) but does NOT carry the event payload (the wire's invariant is "the event IS the broadcast"); the broadcast carries the event but lacks `inResponseTo`. The client that originated the propose receives both; non-proposer subscribed clients receive only the broadcast.

- **`appendSessionEvent` reuse + post-commit-emit.** The handler routes the INSERT through `appendSessionEvent(client, event)` (the single SQL surface) and emits on `app.wsBroadcast` AFTER `withTransaction` resolves — exactly mirroring every existing event-append site in `apps/server/src/sessions/routes.ts`. Two reasons:
  1. Schema-on-write + ADR 0020 FOR UPDATE serialisation are already encapsulated; a fresh propose handler that duplicated the SQL would be one more place to fix when the column list or sequence-allocator shape evolves.
  2. The post-commit-emit invariant (`ws_event_broadcast`'s decision) is what keeps a broadcast subscriber from ever observing a frame for a rolled-back event. Emitting inside the transaction would risk that; the helper's "doesn't call emit" comment is the contract this handler honors.

- **Optimistic-concurrency token surfaced as 409 `sequence-mismatch` via `rejectedToApiError`.** The client's payload carries `expectedSequence` — the sequence number the client believes is the most recent applied event. The handler reads `MAX(sequence)` inside the FOR UPDATE'd transaction and compares: a mismatch produces a synthesised `RejectedValidationResult` with `reason: 'sequence-mismatch'`, runs through `rejectedToApiError(rejection)` (which maps `sequence-mismatch` to HTTP 409 per `errors.ts`), and the thrown `ApiError` is echoed by the dispatcher seam with `code: 'sequence-mismatch'` on the wire. Rationale for using the existing reason rather than minting a new code:
  - The methodology engine ALREADY emits `sequence-mismatch` from its universal check (`validateAction` rejects when `action.sequence !== projection.lastAppliedSequence + 1`). Surfacing the same code from a different check produces a uniform client-side branch (`switch (error.code) { case 'sequence-mismatch': showStaleStateWarning(); ... }`).
  - The `expectedSequence` vs. `MAX(sequence)` check is the same invariant the engine's universal check enforces, just measured one step earlier (before the projection is built). Treating them as the same wire-code keeps the contract clean.
  Note: in practice the engine's universal `sequence-mismatch` check fires when the projection's `lastAppliedSequence + 1` doesn't match the action's `sequence`. Because the handler reads `MAX(sequence)` and sets `action.sequence = MAX + 1`, the engine check would normally pass. The explicit `expectedSequence` test fires when the client's view of the sequence has drifted from the server's — that's the racy-client case (two propose envelopes in flight, server applied one, client sent the second without seeing the first).

- **New wire types `propose` (C→S) + `proposed` (S→C ack); union layout convention.** Two entries added to `wsMessageTypes` + `wsMessagePayloadSchemas` + `WsMessagePayloadMap` in [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts). **Layout convention (documented in the file's comments):**
  1. The closed vocabulary is split into three groups, each preserving append order so future tasks insert at the group's tail rather than mid-array (minimising merge conflict surface across the four sibling tasks).
  2. **Group A — server-emitted unsolicited frames**: `'hello'`, `'event-applied'`, `'error'` (no `inResponseTo` requirement; the server originates).
  3. **Group B — client → server request types**: `'subscribe'`, `'unsubscribe'`, `'propose'` (each future sibling — `'vote'`, `'commit'`, `'mark-meta-disagreement'`, `'snapshot'` — appends to this group's tail).
  4. **Group C — server → client ack/result types correlated via `inResponseTo`**: `'subscribed'`, `'unsubscribed'`, `'proposed'` (each future sibling adds its matching ack — `'voted'`, `'committed'`, `'meta-disagreement-marked'`, `'snapshot-result'` — at this group's tail).
  The grouping mirrors the protocol's actual shape (unsolicited / request / response) and means each downstream task touches three lines in two distinct regions of the file — minimising rebase conflicts. The grouping is documented in the file as a stable convention, and the existing entries are reordered within `wsMessageTypes` to match. The `WsMessagePayloadMap` interface and the `wsMessagePayloadSchemas` registry follow the same grouping (TypeScript's `Record<WsMessageType, ...>` exhaustiveness check forces all three places to stay in sync).

- **Handler builder closure, mirroring `subscribe.ts`.** `buildProposeHandler({ pool, registry, broadcast, log, now? })` returns the handler. `now` defaulted to `Date.now` so hermetic tests can pin the timestamp. The builder shape matches `buildSubscribeHandler` — easy to unit-test in isolation against a memory pool; the registration plumbing lives in `handlers/index.ts`'s `wsHandlersPlugin`.

- **Projection loaded by event-log replay per request.** The handler `SELECT id, session_id, sequence, kind, actor, payload, created_at FROM session_events WHERE session_id = $1 ORDER BY sequence ASC` and runs the rows through `projectFromLog` to obtain the projection passed to `validateAction`. Rationale: the per-session `ProjectionCache` (per `data_and_methodology.projection.projection_caching`) is NOT yet wired to a Fastify-decorated singleton in production — wiring it is its own task and would over-scope this one. The replay-per-propose path is correct (every applied event is durable in `session_events` by ADR 0020) and the cost is bounded by the session's event count, which is small in v1. Two future paths are open:
  - A `wsProjectionCachePlugin` would decorate `app.projections` with a pool-backed `ProjectionCache`; the propose handler would replace `projectFromLog` with `app.projections.getProjection(sessionId)`.
  - The HTTP propose route (if/when minted) inherits the same projection-acquisition strategy — keeping replay-per-request here lets both surfaces switch atomically.
  The current path is documented as "v1 replay-per-request; cache-backed path is a follow-up" in the handler's docblock.

- **Sequence allocation: MAX(sequence)+1 inside the transaction.** Same as every other event-append site. The FOR UPDATE row lock on `sessions` serialises concurrent appenders; the explicit `expectedSequence` check is the client-correlated optimistic-concurrency token.

- **`actor` is the proposing user.** `MethodologyAction.propose.actor = connection.user.id`. The engine forwards `action.actor` into `EventToAppendEnvelope.actor` (per `propose.ts` line 1181). No system-generated events on this path.

- **Test coverage layered per ADR 0022:**
  - Pure-logic handler-builder behaviour (subscribe gate, visibility gate, engine-rejection echoing, expected-sequence mismatch, success path including the `proposed` ack + the bus emit) → Vitest in `apps/server/src/ws/handlers/propose.test.ts`. Uses the same `__buildTestWsApp` builder pattern as `subscribe.test.ts` + a memory pool that recognises the SQL queries the handler issues (visibility + event-log SELECT + BEGIN/COMMIT + MAX(sequence) + INSERT INTO session_events).
  - Wire-path behaviour against pglite → Cucumber in `tests/behavior/backend/ws-propose.feature` (3-4 scenarios). Reuses the existing WS-test infrastructure (auth-gated app + cookie + client lifecycle) from `backend-ws-auth.steps.ts` / `backend-ws-connection.steps.ts` / `backend-ws-subscribe.steps.ts`.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- Shared types: [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) — `'propose'` + `'proposed'` added to `wsMessageTypes` (Group-B / Group-C respectively per the documented union-layout convention) + matching payload schemas + `WsMessagePayloadMap` entries; the file's comment block documents the three-group convention so future sibling tasks insert at the right tails.
- Server (handler): [`apps/server/src/ws/handlers/propose.ts`](../../../apps/server/src/ws/handlers/propose.ts) — `buildProposeHandler` + `registerProposeHandlers` + the subscribe-before-act gate + the visibility re-check + the projection-replay loader + the FOR-UPDATE sequence-allocator + the `appendSessionEvent` call + the post-commit `proposed` ack + bus emit + the `rejectedToApiError`-mapped throw path.
- Server (registration): [`apps/server/src/ws/handlers/index.ts`](../../../apps/server/src/ws/handlers/index.ts) — `wsHandlersPlugin` extended to register `buildProposeHandler` alongside the subscribe handlers.
- Tests (Vitest): [`apps/server/src/ws/handlers/propose.test.ts`](../../../apps/server/src/ws/handlers/propose.test.ts) (handler integration cases) + a one-line vocabulary-pin update in [`packages/shared-types/src/ws-envelope.test.ts`](../../../packages/shared-types/src/ws-envelope.test.ts).
- Tests (Cucumber): [`tests/behavior/backend/ws-propose.feature`](../../backend/ws-propose.feature) + [`tests/behavior/steps/backend-ws-propose.steps.ts`](../../backend/steps/backend-ws-propose.steps.ts).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
