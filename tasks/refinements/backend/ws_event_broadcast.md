# Server → all subscribed clients: event-applied broadcast

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.websocket_protocol.ws_event_broadcast`
**Effort estimate**: 1d
**Inherited dependencies**: `backend.websocket_protocol.ws_connection_handling` (settled — upgrade path + the per-connection context + `__buildTestWsApp`), `backend.websocket_protocol.ws_auth_on_connect` (settled — auth gate populates `connection.user`), `backend.websocket_protocol.ws_message_envelope` (settled — closed `WsMessageType` enum + dispatcher), `backend.websocket_protocol.ws_subscribe_to_session` (settled — `app.wsSubscriptions.connectionsForSession(sessionId)` snapshot lookup), `backend.session_management.*` (settled — every `session_events` INSERT site).

## What this task is

Land the broadcast surface that turns an event-append on `session_events` into an `event-applied` envelope on every WS connection currently subscribed to the appended event's `sessionId`. Three things happen together:

1. **The bus primitive** — an in-process `WsBroadcastBus` decorated onto `app.wsBroadcast`. Routes call `app.wsBroadcast.emit({ event })` AFTER their `session_events` INSERT commits; the bus dispatches synchronously to every registered listener. Shape mirrors `DiagnosticBus` (`apps/server/src/diagnostics/event-emission.ts`).
2. **The fan-out subscriber** — a listener (registered by `wsEventAppliedBroadcastPlugin`) that on each emit looks up `connectionsForSession(event.sessionId)` and sends a fresh `WsEnvelope<'event-applied'>` over each subscribed connection. Per-connection error isolation is the hard contract: one bad socket logs at warn and the iteration continues so the other subscribers still receive the broadcast.
3. **The per-connection sender registry** — `app.wsConnectionSenders` maps `connectionId` to a `(envelope) => void` closure that knows how to serialise + send on the underlying socket. The connection handler registers a sender on socket open and unregisters on close, so the fan-out subscriber can reach any connection by id without coupling to the connection-handler closure.

The wire surface adds one new `WsMessageType` — `'event-applied'` — to the closed discriminated union in `packages/shared-types/src/ws-envelope.ts`. The payload wraps the appended event verbatim (`{ event: Event }` where `Event` is the `events.ts` envelope).

Every event-append site in `apps/server/src/sessions/routes.ts` (six INSERT INTO session_events calls across five endpoints) is refactored to (a) go through the centralized `appendSessionEvent(client, event)` helper for the SQL, and (b) emit on the bus AFTER the transaction commits. The post-commit-emit invariant is what keeps subscribers from ever observing a frame for an event the DB rolled back.

## Why it needs to be done

Every real-time client (moderator console, debater tablets, audience surface) is server-broadcast: they receive applied events over WebSocket and re-render. Without this task, the broadcast pipe is silent — clients can subscribe to a session but never observe any event. Five downstream tasks depend on this primitive:

- `ws_proposal_status_broadcast` — derives per-facet vote state from events and broadcasts the derived view (a separate envelope type sitting ATOP this raw-event-broadcast).
- `ws_diagnostic_broadcast` — derives structural diagnostics from the projection and broadcasts changes. Same atop-of-this-task relationship.
- `ws_reconnection_handling` — replays missed broadcasts to a reconnecting client.
- `audience.broadcast_surface` — the audience UI lives on this stream.
- `participant_ui` / `moderator_ui` — the live debate UIs consume `event-applied` to incrementally update the projection client-side.

## Inputs / context

From [docs/architecture.md](../../../docs/architecture.md):

- "Clients (moderator, debaters, audience) connect over **WebSockets** ... event broadcasts are server-authoritative." The broadcast surface is THE channel through which a session's event log reaches every active observer in real time.

From [`apps/server/src/diagnostics/event-emission.ts`](../../../apps/server/src/diagnostics/event-emission.ts):

- `DiagnosticBus` — the existing in-process pub/sub pattern this task mirrors. Same Decisions: synchronous dispatch, listener snapshot before iteration, `on(...)` returns an unsubscribe handle, error containment is the SUBSCRIBER's job (the bus rethrows). Keeping the two buses structurally identical makes the codebase's pub/sub vocabulary uniform.

From [`apps/server/src/ws/subscriptions.ts`](../../../apps/server/src/ws/subscriptions.ts):

- `WsSubscriptionRegistry.connectionsForSession(sessionId)` returns a fresh array snapshot of subscribed connection ids. The snapshot semantics (NOT a live view) are what makes the fan-out safe against re-entrant unsubscribes (e.g. a misbehaving client whose `send` triggers an `unsubscribe`).

From [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts):

- Six `INSERT INTO session_events` sites across five endpoints (`POST /sessions` has two — `session-created` at sequence=1 and `participant-joined` at sequence=2; the others one each: `POST /sessions/:id/end`, `POST /sessions/:id/participants`, `DELETE /sessions/:id/participants/:userId`, `POST /sessions/:id/include`). Each writes inside a `withTransaction(...)` block. Each is refactored to use the centralized `appendSessionEvent` helper and emit on the bus AFTER COMMIT.

From [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts):

- The closed `WsMessageType` enum + `wsMessagePayloadSchemas` registry. Adding `event-applied` is a deliberate three-place change (`wsMessageTypes`, `wsMessagePayloadSchemas`, `WsMessagePayloadMap`); the TS exhaustiveness check forces them to stay in lock-step.

From [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md):

- Schema-on-write — every row in `session_events` is structurally valid by construction (the routes call `validateEvent` before INSERT). Broadcasts inherit this — every `event-applied` envelope carries a validated event, so receivers can re-run `validateEvent` on the payload for defense in depth without ever surfacing a "partially valid event arrived on the wire" failure mode.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):

- Every empirical verification is a committed test. The broadcast surface ships with Vitest unit tests (`bus.test.ts`, `event-applied.test.ts`, `integration.test.ts`) covering the bus contract + per-connection error isolation + the wire-path end-to-end; the cucumber feature `ws-event-broadcast.feature` exercises the same wire path against pglite.

## Constraints / requirements

- **Bus pattern mirrors `DiagnosticBus`.** Same synchronous-dispatch shape, same listener-snapshot semantics, same `on(...)` returning an unsubscribe handle. Reject inventing a new pub/sub primitive when the existing one fits.
- **`event-applied` extends the closed `WsMessageType` enum.** Three-place coordinated change (`wsMessageTypes` + `wsMessagePayloadSchemas` + `WsMessagePayloadMap`); the compiler enforces exhaustiveness.
- **The broadcast envelope's payload wraps the event verbatim** — `{ event: Event }`. NOT a flattened `{ sessionId, sequence, kind, payload }` shape; flattening would drift from the persisted log's source-of-truth shape and force receivers to maintain two parsers.
- **Post-commit-emit invariant.** Routes MUST emit on the bus AFTER the transaction's COMMIT. Emitting inside the transaction risks a subscriber observing a frame for an event the DB later rolls back. The refactor collects events into a local array inside the `withTransaction(...)` callback and iterates `app.wsBroadcast.emit(...)` on the return value AFTER `withTransaction` resolves.
- **Per-connection error isolation.** One sender throwing MUST NOT break the fan-out. The subscriber catches per-connection, logs at warn level with `{ err, connectionId, sessionId, messageId, eventKind, eventSequence }`, and continues the iteration.
- **Ordering invariant.** Per-session FIFO: events appended in sequence order produce broadcasts in the same order on every subscribed connection. Three ingredients keep this true: (1) routes serialise per-session appends via FOR UPDATE on the sessions row (ADR 0020); (2) routes emit AFTER COMMIT in the same code path that allocated the sequence; (3) the bus dispatches synchronously and the fan-out sends synchronously.
- **In-process / single-instance.** Clustering is out of scope. A horizontally-scaled deployment would NOT see broadcasts emitted on one instance reach subscribers connected to another — the bus is local to its Fastify instance, mirroring the same limitation `WsSubscriptionRegistry` documents.
- **Centralized append helper.** `apps/server/src/events/append.ts` exposes `appendSessionEvent(client, event)` — the single SQL surface for INSERT INTO session_events. Every appender routes through it.
- **Proposal-status / diagnostic broadcasts are NOT in scope.** They're separate sibling tasks (`ws_proposal_status_broadcast`, `ws_diagnostic_broadcast`) that consume DERIVED state on top of this raw-event broadcast.
- **No mocks of the WS library.** Vitest tests against the listener are pure-logic (the registries are pure JS; the senders are captured-array closures); the integration test uses the real `app.injectWS` path.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm --filter @a-conversa/shared-types run build` succeeds.
- `pnpm run test:smoke` (Vitest) green, with **+16 tests** (9 in `apps/server/src/ws/broadcast/bus.test.ts` + 6 in `apps/server/src/ws/broadcast/event-applied.test.ts` + 1 in `apps/server/src/ws/broadcast/integration.test.ts`) plus one vocabulary-pin update in `packages/shared-types/src/ws-envelope.test.ts` (no test-count change there — same test, updated array).
- `pnpm run test:behavior:smoke` (Cucumber) green, with **+4 scenarios** in `tests/behavior/backend/ws-event-broadcast.feature`.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- A reader of `apps/server/src/ws/broadcast/bus.ts` can identify exactly where the post-commit-emit invariant is documented and where additional listeners (audit, metrics, cluster-fanout) would attach.
- A reader of `apps/server/src/ws/broadcast/event-applied.ts` can identify exactly where the per-connection error-isolation try/catch lives.
- A reader of `apps/server/src/events/append.ts` can identify the single SQL surface for `INSERT INTO session_events` and the comment explaining why this helper does NOT call `app.wsBroadcast.emit(...)`.

## Decisions

- **Bus pattern (Shape A), mirroring `DiagnosticBus`.** Two architectural shapes were considered:
  - **Shape A — Event bus.** Routes publish to an in-process pub/sub after their INSERT commits; the WS broadcast subscriber listens + fans out. This is the chosen shape.
  - **Shape B — Direct call.** Routes call `app.wsBroadcast.applyEvent(event)` directly. Less indirection, but tighter coupling between session-management routes and the WS surface — every route would need to know about the broadcast contract, and adding a second consumer of the same event-append signal (audit, metrics, cluster-fanout) would require touching every route.
  Shape A wins because (1) it mirrors the existing `DiagnosticBus` pattern (codebase vocabulary uniform), (2) it lets a second consumer be added with a single `bus.on('event-applied', ...)` registration without touching routes, and (3) it keeps the routes' surface narrow — they emit on the bus and don't know what listens.

- **`event-applied` as the envelope type, payload wraps the event verbatim.** The envelope shape is `{ type: 'event-applied', id: <server-uuid>, payload: { event } }`. Considered alternatives: (a) flatten the event onto the payload top-level (`{ sessionId, sequence, kind, payload }`) — rejected because the persisted-event shape is the canonical contract (per ADR 0021), and flattening would drift; receivers would parse two different shapes for the same conceptual object. (b) Include a `sessionId` / `sequence` field on the payload alongside `event` — rejected because both fields live on `event` already; duplicating risks drift.

- **Post-commit-emit invariant (the ordering ingredient).** Routes collect appended events into a local array inside the `withTransaction(...)` callback and emit AFTER the transaction returns. Three reasons:
  1. **No phantom broadcasts.** Emitting inside the transaction risks a subscriber observing a frame for an event the DB later rolls back. A subscriber that wrote the broadcast to a side-channel (audit log, metrics) would be lying.
  2. **Per-session ordering.** Routes serialise per-session appends via FOR UPDATE on the sessions row (ADR 0020). Emit-after-commit preserves the order — the bus's synchronous dispatch then carries it through to each subscriber.
  3. **Transaction-aware subscriber would couple too tightly.** A subscriber that tracked transaction state would need a hook into `withTransaction`'s lifecycle. The post-commit-emit invariant lets the bus and the subscribers stay transaction-unaware.

- **Per-connection error isolation lives in the SUBSCRIBER, not the bus.** Mirror of `DiagnosticBus`'s contract: the bus is a low-level primitive that dispatches synchronously and rethrows. Per-connection try/catch (one bad socket doesn't break the fan-out) lives in the `event-applied` subscriber. Pulling the error-policy into the bus would either (a) force every future subscriber to inherit a one-size-fits-all error handling, or (b) require a configurable error-policy on the bus — both add complexity for no benefit when the subscriber owns the policy that matches its own semantics.

- **Per-connection sender registry as a separate `app.wsConnectionSenders` decoration.** The alternative was attaching the sender closure directly to `WsConnectionContext`. Two reasons to keep it separate:
  1. The subscription registry returns `connectionId` strings; a per-id sender lookup is a single `Map.get`. Storing senders on the context would require an additional `connectionId -> context` map anyway.
  2. The context's `socket` is implementation-detail of the connection handler (the raw `ws.WebSocket` from the upstream library). Exposing it via a minimal `(envelope) => void` sender closure hides the socket entirely from the broadcast subscriber.

- **Centralized `appendSessionEvent` helper.** Pulled the SQL into one place (`apps/server/src/events/append.ts`) so future migrations or schema-on-write extensions land once. Considered keeping the INSERT inline at each call site and emitting on the bus inline too — rejected because the six call sites would each be one place to fix when the column list changes, and the bus-emit code would be duplicated identically six times. The helper does NOT call `app.wsBroadcast.emit(...)` itself — that has to happen AFTER COMMIT, which is outside the helper's transactional scope; the route owns the post-commit emit.

- **In-process / single-instance limitation.** Same as `WsSubscriptionRegistry`'s limitation — broadcasts emitted on one instance don't reach subscribers connected to another. Clustering is out of scope; recovery paths are: (1) `ws_reconnection_handling` reconnects + replays missed events from the data-model; (2) a future cluster-fanout layer subscribes to a message bus every instance publishes onto. The bus's shape doesn't change; only what listens does.

- **Proposal-status / diagnostic broadcasts deferred to their own tasks.** Each derives state ATOP this raw-event broadcast:
  - `ws_proposal_status_broadcast` computes per-facet vote state from `proposal` and `vote` events; it'll either (a) listen on the same bus and emit a derived envelope, or (b) layer a higher-level "projection-derived" bus over this one. The design is its own task.
  - `ws_diagnostic_broadcast` consumes the existing `DiagnosticBus` (already in `apps/server/src/diagnostics/event-emission.ts`) and emits a derived envelope. The two buses (WS broadcast + diagnostic emission) compose at the subscriber layer; this task doesn't preempt that composition.
  Keeping the three broadcasts as separate tasks lets each one's payload shape, gating rule, and delivery semantics be reasoned about in isolation.

- **No backpressure handling in v1.** `ws.WebSocket.send` is fire-and-forget at the API level; the library buffers internally and `bufferedAmount` surfaces backpressure but isn't part of the broadcast contract today. A future task may add backpressure-aware fan-out (skip a connection whose `bufferedAmount` exceeds a threshold; let the client catch up via `ws_reconnection_handling`); explicitly out of scope for v1.

- **Sender re-uses `serializeWsEnvelope`.** Each per-connection sender is a thin wrapper around `serializeWsEnvelope(envelope) + socket.send(...)`. Keeps every server-emitted frame (hello, ack, broadcast) going through one serialise code path — a server bug in envelope construction surfaces loudly via `WsEnvelopeValidationError` at serialise-time rather than producing a malformed wire frame.

- **Cucumber bus-emit step calls `app.wsBroadcast.emit(...)` directly.** The feature exercises the broadcast wire path (subscribe → emit → fan-out → client receive) but does NOT drive every route to its INSERT-then-commit point. Rationale: the routes' end-to-end behaviour is already covered by `routes.test.ts` Vitest suite (which pins INSERT → bus emit ordering inside each route) AND by the session-management cucumber features (`create-session.feature`, `end-session.feature`, etc.). Stacking the wire-broadcast assertion on top of every route would multiply the test-matrix without adding coverage of the broadcast surface itself. Direct bus-emit isolates the broadcast wire path for surgical assertions.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- Shared types: [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) — `event-applied` added to `wsMessageTypes` + `eventAppliedPayloadSchema` + `WsMessagePayloadMap` entry.
- Bus: [`apps/server/src/ws/broadcast/bus.ts`](../../../apps/server/src/ws/broadcast/bus.ts) — `WsBroadcastBus` + `wsBroadcastPlugin`.
- Per-connection senders: [`apps/server/src/ws/broadcast/connections.ts`](../../../apps/server/src/ws/broadcast/connections.ts) — `WsConnectionSenderRegistry` + `wsConnectionSendersPlugin`.
- Fan-out subscriber: [`apps/server/src/ws/broadcast/event-applied.ts`](../../../apps/server/src/ws/broadcast/event-applied.ts) — `buildEventAppliedBroadcastListener` + `wsEventAppliedBroadcastPlugin`.
- Barrel: [`apps/server/src/ws/broadcast/index.ts`](../../../apps/server/src/ws/broadcast/index.ts).
- Append helper: [`apps/server/src/events/append.ts`](../../../apps/server/src/events/append.ts) — `appendSessionEvent`.
- Connection wiring: [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) — registers the broadcast bus + sender registry + subscriber plugins inside `wsConnectionHandlingPluginAsync`; per-connection sender registered on open / unregistered on close.
- Routes refactor: [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — every event-append site routes through `appendSessionEvent` and emits on `app.wsBroadcast` after COMMIT; the routes plugin defensively registers `wsBroadcastPlugin` so `__buildTestSessionsApp` (used by `routes.test.ts`) decorates the bus.
- Tests (Vitest): [`apps/server/src/ws/broadcast/bus.test.ts`](../../../apps/server/src/ws/broadcast/bus.test.ts) (9 tests), [`apps/server/src/ws/broadcast/event-applied.test.ts`](../../../apps/server/src/ws/broadcast/event-applied.test.ts) (6 tests), [`apps/server/src/ws/broadcast/integration.test.ts`](../../../apps/server/src/ws/broadcast/integration.test.ts) (1 test); the vocabulary-pin in [`packages/shared-types/src/ws-envelope.test.ts`](../../../packages/shared-types/src/ws-envelope.test.ts) updated to include `event-applied`. Total: 920 vitest tests (+16 from 904 baseline).
- Tests (Cucumber): [`tests/behavior/backend/ws-event-broadcast.feature`](../../backend/ws-event-broadcast.feature) (4 scenarios) + [`tests/behavior/steps/backend-ws-event-broadcast.steps.ts`](../../steps/backend-ws-event-broadcast.steps.ts). Total: 190 cucumber scenarios (+4 from 186 baseline).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
