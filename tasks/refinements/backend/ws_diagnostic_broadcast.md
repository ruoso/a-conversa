# Server → all subscribed clients: diagnostic broadcast

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.websocket_protocol.ws_diagnostic_broadcast`
**Effort estimate**: 0.5d
**Inherited dependencies**: `backend.websocket_protocol.ws_event_broadcast` (settled — `app.wsBroadcast`, `app.wsConnectionSenders`, the per-connection sender registry, the bridge pattern + the broadcast-subscriber template), `backend.websocket_protocol.ws_subscribe_to_session` (settled — `app.wsSubscriptions.connectionsForSession(...)`), `data_and_methodology.diagnostics.diagnostic_event_emission` (settled — the `DiagnosticBus` primitive + the five-kind discriminated `DiagnosticEntry` union + `diffDiagnostics` + `classifyDiagnostic`).

## What this task is

Land the WebSocket fan-out surface that turns a `DiagnosticBus` emission into a `diagnostic` envelope on every WS connection currently subscribed to the diagnostic's session. Three things happen together:

1. **The bus decoration** — `wsDiagnosticBusPlugin` decorates `app.diagnosticBus` with a fresh `DiagnosticBus` per Fastify instance. Mirror of `wsBroadcastPlugin` (the `event-applied` bus's decorator).
2. **The session-context wrapper** — `WsDiagnosticBroadcast` (decorated onto `app.wsDiagnosticBroadcast`) exposes `notifyForSession(sessionId, sequence, prev, next)` as the one entry point the projection-cache wiring (a future task) will call AFTER `applyEvent` re-computes the diagnostic snapshot. The wrapper sets a single-slot active context immediately before `bus.notify(...)`, clears it in `finally`, and the fan-out listener reads sessionId/sequence off the context at fire time.
3. **The fan-out subscriber** — `buildDiagnosticBroadcastListener(...)` returns a pair of listeners (`fired` + `cleared`) registered on `app.diagnosticBus`. On each emit the listener looks up `connectionsForSession(sessionId)` and sends a fresh `WsEnvelope<'diagnostic'>` over each subscribed connection. Per-connection error isolation is the hard contract: one bad socket logs at warn and the iteration continues so the other subscribers still receive the broadcast.

The wire surface adds one new `WsMessageType` — `'diagnostic'` — to the closed discriminated union in `packages/shared-types/src/ws-envelope.ts`. The payload carries `{ sessionId, kind, severity, status, sequence, diagnostic }`, where `diagnostic` is the full `DiagnosticEntry` from the diagnostics module passed through verbatim. The wire schema treats `diagnostic` as `z.unknown()` for the same reason `snapshot-state.projection` is unknown — the inner type is owned by another module's refinements and re-validating it here would tightly couple the WS contract to detector-internals.

## Why it needs to be done

The structural-diagnostic detectors (`cycle`, `contradiction`, `multi-warrant`, `dangling-claim`, `coherency-hint`) are pure read functions over the projection. The `DiagnosticBus` is the in-process pub/sub the detectors fire through. Without this task, diagnostics fire only in-process — no client surface observes them. Three downstream consumers depend on this primitive:

- The **moderator console** renders a diagnostic panel (blocking entries red-bordered, advisory entries yellow); without the WS broadcast, the panel can't react to deltas in real time.
- The **participant tablet** annotates per-facet UI elements when a coherency hint fires for a node the tablet is showing.
- The future **projection-cache wiring** (a separate task that wires `ProjectionCache.applyEvent` to call `wsDiagnosticBroadcast.notifyForSession(...)` after each event-apply) is what produces the actual emissions; this task delivers the bridge surface the wiring will call.

## Inputs / context

From [docs/architecture.md](../../../docs/architecture.md):

- Clients connect over WebSockets; event broadcasts are server-authoritative. The `diagnostic` envelope is one of three Group-A server-emitted unsolicited frames (alongside `event-applied` and `error`); receivers re-render based on every frame.

From [`apps/server/src/diagnostics/event-emission.ts`](../../../apps/server/src/diagnostics/event-emission.ts):

- The `DiagnosticBus` API: `on(event, listener) → unsubscribe`, `notify(prev, next)`. The bus dispatches synchronously, per-entry, on `'fired' | 'cleared'`. Error containment is the SUBSCRIBER's job; the bus rethrows. `DiagnosticEntry` is the five-kind discriminated union (`cycle | contradiction | multi-warrant | dangling-claim | coherency-hint`). `pending-consequences` is **deliberately excluded** from the aggregator per its own refinement's stub-framing — the wire schema mirrors this.

From [`apps/server/src/diagnostics/classification.ts`](../../../apps/server/src/diagnostics/classification.ts):

- `classifyDiagnostic(entry) → Severity` returns `'blocking' | 'advisory'`. Cycle + contradiction are blocking; multi-warrant, dangling-claim, and the three coherency-hint sub-kinds are advisory. Doc-grounded in `docs/methodology.md` lines 210–227.

From [`apps/server/src/ws/broadcast/event-applied.ts`](../../../apps/server/src/ws/broadcast/event-applied.ts):

- The structural template for a broadcast subscriber: `(evt) => { sessionId = ...; connectionIds = subscriptions.connectionsForSession(sessionId); for each id { sender = connectionSenders.get(id); if missing: skip; try sender(envelope); catch: log + continue }; }`. The diagnostic listener is the same shape with `sessionId` sourced from the active-context wrapper rather than from the bus event.

From [`apps/server/src/ws/broadcast/bus.ts`](../../../apps/server/src/ws/broadcast/bus.ts):

- The `event-applied` bus's `WsBroadcastBus` is the structural reference for `app.diagnosticBus`'s decoration shape — per-instance, idempotent `hasDecorator` check, `fastify-plugin`-wrapped so the decoration reaches the root scope.

From [`apps/server/src/ws/subscriptions.ts`](../../../apps/server/src/ws/subscriptions.ts):

- `WsSubscriptionRegistry.connectionsForSession(sessionId)` returns a fresh array snapshot. Same snapshot semantics make the fan-out safe against re-entrant unsubscribes.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):

- Every empirical verification is a committed test. The bridge ships with Vitest unit tests (`diagnostic.test.ts`) covering fan-out + per-connection error isolation + the per-kind severity classification + the status discriminator + the defensive missing-context path; the cucumber feature `ws-diagnostic.feature` exercises the same wire path against pglite.

## Constraints / requirements

- **Bridge pattern, parallel to the `event-applied` bridge.** Decorates a per-app bus + a fan-out subscriber + a per-connection sender lookup. Reject inventing a new pub/sub primitive when the existing one fits.
- **`diagnostic` extends the closed `WsMessageType` enum** via the union-extension-at-Group-A-tail convention. Three-place coordinated change (`wsMessageTypes` + `wsMessagePayloadSchemas` + `WsMessagePayloadMap`); the compiler enforces exhaustiveness.
- **The diagnostic-entry pass-through is verbatim.** No reshaping, no flattening. `payload.diagnostic` carries the full `DiagnosticEntry` from `event-emission.ts`. The construction surface in the bridge module is TypeScript-typed; the wire schema accepts `z.unknown()`.
- **Severity reuses `classifyDiagnostic`.** The wire `severity` field is `'blocking' | 'advisory'`, the same vocabulary the classifier returns. NOT `info | warn | error` — that would invent a translation layer that doesn't match any other surface (HTTP error codes, the moderator UI's panel styling, the methodology doc's resolution-of-diagnostics section).
- **Kind enum is the five surfaced kinds** — `cycle | contradiction | multi-warrant | dangling-claim | coherency-hint`. `pending-consequences` is excluded per the upstream detector's stub-framing.
- **Status discriminator** — `'fired' | 'cleared'`, mirroring the `DiagnosticBus`'s event names. Receivers maintain their own diagnostic-set state by applying the deltas.
- **Session context is wrapper-injected, not bus-extended.** The `DiagnosticBus` was defined per-entry without session context (see its module comment). Modifying the bus would force every existing consumer to accept a wider entry shape or break. The wrapper threads context through a single-slot holder set immediately before `bus.notify(...)` and cleared in `finally` — safe because `bus.notify` is synchronous.
- **Per-connection error isolation.** One sender throwing MUST NOT break the fan-out. The subscriber catches per-connection, logs at warn with `{ err, connectionId, sessionId, messageId, diagnosticKind, diagnosticStatus, sequence }`, and continues. Mirror of `event-applied`'s contract.
- **In-process / single-instance.** Same limitation as `WsSubscriptionRegistry` + `WsBroadcastBus` — broadcasts emitted on one Fastify instance don't reach subscribers connected to another. Clustering is out of scope.
- **No new dependency.** The bridge composes existing primitives (`DiagnosticBus`, `WsConnectionSenderRegistry`, `WsSubscriptionRegistry`).
- **Diagnostic-detection logic is OUT of scope.** The detectors + the bus's `notify` contract are settled in `apps/server/src/diagnostics/`. This task only consumes what the bus emits.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm --filter @a-conversa/shared-types run build` succeeds.
- `pnpm run test:smoke` (Vitest) green, with **+16 tests** in `apps/server/src/ws/broadcast/diagnostic.test.ts` plus a one-line vocabulary-pin update in `packages/shared-types/src/ws-envelope.test.ts` (same test, updated array; no test-count change).
- `pnpm run test:behavior:smoke` (Cucumber) green, with **+3 scenarios** in `tests/behavior/backend/ws-diagnostic.feature`.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- A reader of `apps/server/src/ws/broadcast/diagnostic.ts` can identify exactly where the active-context wrapper sets + clears the session context, and where the per-connection error-isolation try/catch lives.
- A reader of `packages/shared-types/src/ws-envelope.ts`'s `diagnosticPayloadSchema` can identify why the inner `diagnostic` field is `z.unknown()` (the leading comment explains the projection-pattern parallel + the construction-surface-enforcement story).

## Decisions

- **Bridge pattern (Shape A), mirroring the `event-applied` bridge.** Two shapes were considered:
  - **Shape A — Bus listener.** A fan-out listener subscribes to `app.diagnosticBus`'s `'fired'` / `'cleared'` events; the projection-cache wiring (future) calls `app.wsDiagnosticBroadcast.notifyForSession(...)` to fire the bus with session context. This is the chosen shape.
  - **Shape B — Direct call.** The projection-cache wiring would call `app.wsBroadcast.notifyDiagnostic(sessionId, sequence, prev, next)` directly. Less indirection, but it forces the broadcast surface to own the diff logic and forecloses an audit/metrics subscriber from listening to the same bus.
  Shape A wins because (1) it mirrors the `event-applied` bridge (codebase vocabulary uniform), (2) the existing `DiagnosticBus` + `diffDiagnostics` already produce the per-entry `fired`/`cleared` stream the bridge needs (no duplication), and (3) adding a second subscriber (audit, metrics) is a single `.on('fired', ...)` registration on `app.diagnosticBus`.

- **`diagnostic` as the envelope type, payload carries derived + pass-through fields.** Three alternatives surveyed:
  - **(a) Flatten the `DiagnosticEntry` onto the payload top-level** — rejected because every detector kind has a different field set (cycle has `nodes`, contradiction has `nodeA`/`nodeB`/`edges`, multi-warrant has `dataNodeId`/`claimNodeId`/`warrantNodeIds`, etc.). Flattening would force the wire schema to either declare each variant as a separate top-level shape (which is what the discriminated-union pattern already does inside the `diagnostic` field) or be permissively-shaped (which loses type-safety). The inner pass-through is the only consistent option.
  - **(b) Include only the kind discriminator + opaque payload** — rejected because severity is derived (`classifyDiagnostic`) and consumers (the moderator UI's diagnostic panel) want it on every envelope without a second lookup. Inlining derived fields keeps the wire format self-contained.
  - **(c) Carry sessionId/sequence/status/severity/kind at the top of payload + `diagnostic` for the verbatim pass-through** — accepted. The derived fields are stable across detector evolutions (their enums are pinned in the wire schema); the pass-through is the source-of-truth shape that travels along with them.

- **Severity vocabulary is `'blocking' | 'advisory'`, NOT `info | warn | error`.** The classifier (`apps/server/src/diagnostics/classification.ts`) is the source of truth and is doc-grounded in `docs/methodology.md` lines 210–227 ("Resolution of structural diagnostics"). Mapping to `info/warn/error` would invent a translation layer that:
  1. Doesn't match the moderator-UI's blocking-vs-advisory rendering taxonomy.
  2. Doesn't match the methodology doc's vocabulary (the doc has no notion of "info"; blocking diagnostics aren't "errors" in the HTTP sense).
  3. Forces every future severity decision to be translated twice (classifier → wire vocab → consumer's UI vocab), with each translation a potential drift point.
  Keeping the wire vocabulary aligned with the classifier's vocabulary makes the diagnostic surface self-consistent end-to-end.

- **Pass-through is verbatim — `payload.diagnostic === entry` referentially.** The bridge MUST NOT clone or reshape the `DiagnosticEntry`. Two reasons:
  1. Receivers that already know how to render a `DiagnosticEntry` (the moderator UI; future audit log consumers) can render the broadcast directly without an envelope-to-entry adapter.
  2. The schema-on-write invariant (per ADR 0021's spirit) says the wire MUST carry the canonical shape produced by the source-of-truth module. Reshaping would mean the wire carries a derivative — receivers would have to know about both shapes.
  The Vitest test pins this with `toBe(entry)` (referential equality, not `toEqual` deep-equal), so an accidental clone in a future refactor surfaces loudly.

- **Session context is wrapper-injected (single-slot active context), not bus-extended.** The `DiagnosticBus` was defined per-entry without session context (see its module-level comment block in `event-emission.ts`). Two reasons this design choice is preserved:
  1. **Backward compatibility with existing consumers.** The bus's unit tests + its API surface (the `DiagnosticEntry` union) are shipped. Widening the entry shape would force every existing consumer (the diagnostics module's own tests; the future moderator-UI direct consumer if it ever bypassed the WS surface) to either accept a wider entry shape or break.
  2. **Separation of concerns.** Session context is a routing concern (the WS surface needs it to dispatch fan-out); the diagnostics module is about WHAT the diagnostic is, not WHERE it should be delivered. Keeping context out of the bus's contract preserves the boundary.
  The single-slot wrapper is safe because `bus.notify(...)` is synchronous — there is no concurrent re-entrant `notifyForSession(...)` call inside a single thread. The wrapper sets context immediately before `bus.notify`, clears it in `finally`, and the fan-out listener reads it inside its synchronous per-entry callback. A defensive `getActiveContext() === undefined` branch in the listener logs a warn + skips fan-out for the raw-bus-bypass case (a programmer error in some future consumer that calls `bus.notify` directly without going through the wrapper).

- **Per-connection error isolation lives in the SUBSCRIBER, not the bus.** Mirror of the `event-applied` subscriber's contract + the bus's existing `DiagnosticBus.notify` rethrow semantics. Pulling the error-policy into the bus would force every future subscriber to inherit a one-size-fits-all error handling; keeping it in the subscriber lets the WS fan-out's specific policy (one bad socket logs + iteration continues) be local to the WS module.

- **Ordering relative to `event-applied`.** Two ingredients enforce the invariant `event-applied(N)` arrives BEFORE any `diagnostic` envelope derived from the post-N projection on every subscribed connection:
  1. **Routes emit `event-applied` AFTER COMMIT** (the post-commit-emit invariant from `ws_event_broadcast`).
  2. **The projection-cache wiring** (a future task; out of scope here) will call `applyEvent(event)` to update the projection, then compute `prev/next` diagnostics, then call `wsDiagnosticBroadcast.notifyForSession(...)`. The ordering is `event-applied broadcast → diagnostic broadcast` in the same code path AFTER COMMIT.
  3. **The bus dispatches synchronously**, and the fan-out listener sends synchronously to each connection's sender. The per-connection in-memory duplex stream `ws.WebSocket.send` queues frames in order they're invoked.
  End-to-end: every subscribed connection sees `event-applied(N)` before any `diagnostic` derived from the post-N projection, for the same session. Cross-broadcast ordering across multiple events is per-session FIFO. The `sequence` field on the diagnostic envelope lets a client double-check the ordering invariant at message-receive time (each diagnostic's `sequence` equals the `event.sequence` of the most recent `event-applied` that preceded it for the same session).

- **`pending-consequences` is excluded from the wire `kind` enum.** Mirrors the upstream detector's stub-framing. Re-promoting it is a one-line append in both `event-emission.ts` (add to `DiagnosticKind` + the aggregator's loop) AND `packages/shared-types/src/ws-envelope.ts` (`wsDiagnosticKinds`). The classifier already has a doc-grounded slot for it (advisory per `docs/data-model.md` line 104).

- **The `diagnostic` envelope complements (does NOT duplicate) the structured-error envelope from `ws_error_message`.** The two envelopes carry distinct semantics:
  - `error` is per-client request-failure response, correlated via `inResponseTo` to a specific client envelope. Codes are HTTP-aligned (`bad-request`, `forbidden`, `not-found`, etc.) plus WS-specific (`unknown-message-type`, `malformed-envelope`) plus future methodology rejection codes.
  - `diagnostic` is session-wide derived signal from the projection layer. It fires even when no client made a request (e.g., a remote moderator's event triggers a contradiction that every subscribed participant should see). NO `inResponseTo` — diagnostics are unsolicited.
  Collapsing them would force receivers to disambiguate "what did I request that errored" from "what does the system want me to notice about the session state" within a single envelope type. Keeping them separate keeps the receiver's switch-on-type readable.

- **In-process / single-instance limitation.** Same as the rest of the WS substream — broadcasts emitted on one Fastify instance don't reach subscribers connected to another. Clustering is out of scope; recovery paths are (1) reconnection + replay (`ws_reconnection_handling`) which re-derives diagnostics on the new instance via the projection-cache wiring, and (2) a future cluster-fanout layer that subscribes every instance to a message bus. The bus's shape doesn't change; only what listens does.

- **No backpressure handling in v1.** Same as the `event-applied` bridge. A future task may add backpressure-aware fan-out (skip a connection whose `bufferedAmount` exceeds a threshold); explicitly out of scope here.

- **Cucumber notify step calls `app.wsDiagnosticBroadcast.notifyForSession(...)` directly.** The feature exercises the WS wire path (subscribe → notify → fan-out → client receive) but does NOT drive the projection-cache wiring (which doesn't exist yet). Rationale: same as the `event-applied` cucumber's bus-emit step — the wiring's own end-to-end behaviour is owned by its own task; this feature isolates the broadcast wire path.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- Shared types: [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) — `diagnostic` added to `wsMessageTypes` (Group A tail), `diagnosticPayloadSchema` + `WsDiagnosticKind` + `WsDiagnosticSeverity` + `WsDiagnosticStatus` exported, registry + map entries; vocabulary-pin in [`packages/shared-types/src/ws-envelope.test.ts`](../../../packages/shared-types/src/ws-envelope.test.ts) extended.
- Bridge: [`apps/server/src/ws/broadcast/diagnostic.ts`](../../../apps/server/src/ws/broadcast/diagnostic.ts) — `wsDiagnosticBusPlugin` (decorates `app.diagnosticBus`), `WsDiagnosticBroadcast` (the session-context-aware wrapper, decorated onto `app.wsDiagnosticBroadcast`), `buildDiagnosticBroadcastListener` (the pure listener builder), `wsDiagnosticBroadcastPlugin` (the end-to-end wiring plugin).
- Barrel: [`apps/server/src/ws/broadcast/index.ts`](../../../apps/server/src/ws/broadcast/index.ts) + [`apps/server/src/ws/index.ts`](../../../apps/server/src/ws/index.ts) (additive append, parallel-task-safe).
- Server wiring: [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) — `wsDiagnosticBroadcastPlugin` registered AFTER `wsConnectionHandlingPlugin` + the event-applied broadcast. [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts)'s `__buildTestWsApp` also registers the plugin so cucumber + integration tests pick it up.
- Tests (Vitest): [`apps/server/src/ws/broadcast/diagnostic.test.ts`](../../../apps/server/src/ws/broadcast/diagnostic.test.ts) (16 tests).
- Tests (Cucumber): [`tests/behavior/backend/ws-diagnostic.feature`](../../backend/ws-diagnostic.feature) (3 scenarios) + [`tests/behavior/steps/backend-ws-diagnostic.steps.ts`](../../steps/backend-ws-diagnostic.steps.ts).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
