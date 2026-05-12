# WebSocket reconnection handling: server-side catch-up surface

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.websocket_protocol.ws_reconnection_handling`
**Effort estimate**: 2d
**Inherited dependencies**: `backend.websocket_protocol.ws_event_broadcast` (settled — `event-applied` envelope is the fan-out surface this catch-up handler reuses for replay frames), `backend.websocket_protocol.ws_snapshot_message` (settled — `serializeProjectionForWire` is the shared projection serializer the snapshot-fallback path reuses), `backend.websocket_protocol.ws_message_envelope` (settled — closed `WsMessageType` enum + `WsDispatcher`), `backend.websocket_protocol.ws_auth_on_connect` (settled — `connection.user` populated by the upgrade gate), `backend.websocket_protocol.ws_subscribe_to_session` (settled — `app.wsSubscriptions.connectionsForSession(sessionId)` snapshot lookup), `backend.websocket_protocol.ws_error_message` (settled — canonical wire `error` envelope + `onHandlerError` echoes `ApiError`-shaped throws).

## What this task is

Server-side surface for clean client reconnection with state catch-up. A client that briefly disconnects (network blip, server-going-away 1001, etc.) opens a fresh WS connection, re-authenticates via the upgrade-time gate, re-sends a `subscribe` envelope for each session it was tracking, and then asks the server for the events it missed since the last sequence it observed via a new client→server `catch-up` request.

The catch-up handler:

1. **Subscribe-before-act gate** (same as propose / vote / commit / mark-meta-disagreement / snapshot) — the connection must already be subscribed to the requested session.
2. **Visibility re-check** (`canSeeSession`) — same existence-non-leak rule the rest of the WS surface inherits.
3. **Catch-up-window heuristic** — if `(currentMaxSequence - sinceSequence) <= WS_CATCHUP_MAX_EVENTS`, stream missing events as `event-applied` envelopes (the exact same envelope type the live broadcast surface uses) then send a final `caught-up` ack with `{ sessionId, throughSequence, eventCount, fromSnapshot: false }`.
4. **Snapshot fallback** — if the gap exceeds the threshold (the client is too far behind for an event-by-event replay to be efficient), the handler skips the replay, sends a single `snapshot-state` envelope (built via `serializeProjectionForWire`, the same helper the snapshot handler uses), and then a `caught-up` ack with `{ sessionId, throughSequence, eventCount: 0, fromSnapshot: true }`.
5. **No-op at head** — when `sinceSequence === currentMaxSequence`, the handler sends a `caught-up` ack with `eventCount: 0` immediately. No replay frames, no snapshot.
6. **Defensive "client ahead" path** — when `sinceSequence > currentMaxSequence` (the client thinks it has seen more events than the server has — should not happen, but defensive), the handler logs a warn and sends a `caught-up` ack with `eventCount: 0` and `throughSequence: currentMaxSequence`. Does NOT error: the client is harmlessly resync-confused, and erroring would force them through a reconnect loop they can't recover from.

The handler emits no event, opens no transaction, takes no row-locks. It runs a single read (or two: MAX + slice) and streams the result. The connection-level state is purely client-supplied (`sinceSequence`) — the server tracks no extra per-connection bookkeeping for catch-up.

This is the **server surface only**. The client orchestration (detecting a disconnect, retrying with backoff, re-authenticating, re-subscribing, deciding which `sinceSequence` to send) lives in the participant / moderator / audience workspaces; their refinements depend on this task.

## Why it needs to be done

Without this surface, a transient disconnect forces the client to fetch a full `snapshot` on every reconnect — wasteful when the client is one event behind, and infeasible for the audience-surface which may track sessions with hundreds of events. The shape `subscribe → catch-up → react-to-deltas` is the only way to:

- Recover cleanly from a 1001 (server restarting) without a flash of stale state.
- Recover cleanly from a transient network blip without a UI hiccup.
- Run an audience-surface chapter-navigation flow that scrubs forward through events without forcing a full re-snapshot per scrub.
- Resume state-dependent UIs (the participant tablet's facet display; the moderator's diagnostic panel) without re-running the full projection-build from scratch.

The `snapshot` handler (`ws_snapshot_message`) is the **anchor primitive** — fetch the current state at a sequence. The `event-applied` broadcast (`ws_event_broadcast`) is the **delta primitive** — receive a single event as it lands. The catch-up handler closes the gap between them: replay a *contiguous range* of past events as a stream of `event-applied` frames (reusing the live envelope type so the client has one handler for both replay and live updates), or fall back to a fresh snapshot if the range is too wide to replay efficiently.

Downstream consumers:

- `participant_ui` retry/orchestration task: on reconnect, sends `subscribe → catch-up(sinceSequence: lastKnown)`.
- `moderator_ui` retry/orchestration task: same shape; may use a larger threshold tolerance if the moderator console runs a longer-lived projection.
- `audience_ui` retry/orchestration task: same shape; chapter-navigation scrub uses the snapshot-fallback path heavily.

## Inputs / context

From [`apps/server/src/ws/handlers/snapshot.ts`](../../../apps/server/src/ws/handlers/snapshot.ts):

- `serializeProjectionForWire(projection: Projection): Record<string, unknown>` — the projection-to-wire helper that flattens `Map`s to plain objects and materialises iterators to arrays. Re-exported from `apps/server/src/ws/handlers/index.ts` for cross-module reuse. The catch-up handler uses it verbatim on the snapshot-fallback path.

From [`apps/server/src/ws/broadcast/event-applied.ts`](../../../apps/server/src/ws/broadcast/event-applied.ts):

- The `event-applied` envelope shape: `{ type: 'event-applied', id: <uuid>, payload: { event: <Event> } }`. The catch-up handler constructs frames in this exact shape so receiving clients route them through the same `event-applied` reducer they already use for live broadcasts.

From [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts):

- The closed `WsMessageType` enum + the three-group union-extension convention. This task appends `'catch-up'` to Group B's tail and `'caught-up'` to Group C's tail. The vocabulary-pin test in `ws-envelope.test.ts` widens by one entry per group.

From [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts):

- `projectFromLog(events, sessionId)` — same primitive the snapshot handler uses. The catch-up handler reuses it on the snapshot-fallback path.

From [`apps/server/src/ws/handlers/meta-disagreement.ts`](../../../apps/server/src/ws/handlers/meta-disagreement.ts) (the structural template for the gate stack + the per-row mapper):

- The two gates (subscribe-before-act + visibility) are identical to this handler's gates; the event-log SELECT is identical (when the slice path runs). The difference is: NO transaction, NO FOR UPDATE / MAX(sequence) under lock / INSERT / broadcast — this handler is read-only.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): pure-logic builder behaviour → Vitest; wire-path behaviour against pglite → Cucumber. No ad-hoc verifications.

## Constraints / requirements

- **Read-only.** No event append, no broadcast emit (the per-frame `event-applied` sends use `connection.socket.send` directly, NOT `app.wsBroadcast.emit` — they're targeted at the requesting client only, not fanned out), no transaction.
- **Subscribe-before-act gate** is the first check. Same `'forbidden'` wire code the snapshot handler uses.
- **Visibility re-check** runs AFTER subscribe. Same `'not-found'` existence-non-leak.
- **Configurable threshold** via env var `WS_CATCHUP_MAX_EVENTS` (default 500). Read at handler-registration time via the same lazy-resolution pattern the auth secret uses; tests can override via the handler-options shape.
- **Reuse `event-applied` envelope for replay frames** — same `type`, same payload shape, same envelope construction. Clients route replay and live frames through one handler.
- **Reuse `serializeProjectionForWire`** for the snapshot-fallback path. The handler imports the helper from `handlers/snapshot.js`; no parallel serializer.
- **Per-connection sends, not broadcasts.** Replay frames go on the requesting client's socket only. Other subscribers are unaffected. (Contrast: the live `event-applied` broadcast goes via the bus to all subscribers.)
- **No extra per-connection bookkeeping.** The server does NOT track `lastSentSequence` per connection. `sinceSequence` is the only piece of state and it comes from the client on every request.
- **Closed-union extension** (`packages/shared-types/src/ws-envelope.ts`): two new entries — `'catch-up'` (C→S request) and `'caught-up'` (S→C ack). The vocabulary-pin test in `ws-envelope.test.ts` widens by one entry per group.
- **Throws, doesn't `sendWsError`**: every rejection throws an `ApiError`-shaped value; the dispatcher's `onHandlerError` echoes it as the canonical wire `error` envelope with `inResponseTo`.
- **No reordering invariant during replay.** The handler reads its slice of `session_events`, then iterates and sends. A live broadcast (from a concurrent `propose` / `vote` / `commit` / `mark`) may arrive AT THE BUS between the SELECT and the iteration. The handler does NOT serialize against the live bus; the client deduplicates by `event.sequence`. This is the only contract that is both implementable and meaningful.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm --filter @a-conversa/shared-types run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; baseline 1000+ tests still pass plus the new handler tests + the vocabulary-pin update.
- `pnpm run test:behavior:smoke` (Cucumber) green; baseline 212+ scenarios still pass plus the new catch-up feature.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

## Decisions

- **HEADLINE — Shape B (server-mediated catch-up with snapshot fallback), NOT Shape A (pure client orchestration), NOT Shape C (per-connection sequence tracking + auto-replay).**

  Three reasonable shapes were considered:

  - **Shape A — Pure client orchestration**: the server already has all the primitives needed (`subscribe` + `snapshot` + `event-applied`). On reconnect, the client opens a new WS connection (auth gate runs, new `connectionId` minted), sends `subscribe`, then sends `snapshot`, then listens to `event-applied` broadcasts. No new server surface required. The "task" would reduce to documenting the protocol pattern.
  - **Shape B — Server-mediated catch-up**: add a `catch-up` client→server message that takes `{ sessionId, sinceSequence }`. The server responds with either (i) a stream of `event-applied` envelopes for events `> sinceSequence` + a final `caught-up` ack, OR (ii) a `snapshot-state` envelope + a `caught-up` ack with `fromSnapshot: true` if the gap is too wide. Each branch is selected by a configurable threshold heuristic.
  - **Shape C — Per-connection sequence tracking + auto-replay**: the server tracks per-connection `lastSentSequence`; on `subscribe-with-resume`, automatically streams missing events. More complex (per-connection state survives the WS message loop), and largely subsumed by Shape B.

  Decision: **Shape B**. Rationale:

  1. Shape A is too thin to justify a 2-day task — it amounts to "write a paragraph in the protocol doc." The catch-up window is the explicit user-facing primitive every long-lived projection-on-the-wire surface eventually needs; making it a typed wire message gives clients a deterministic request-response shape (rather than a multi-step subscribe-then-snapshot dance with implicit ordering invariants).
  2. Shape B's snapshot-fallback gives clients a deterministic resume point for any `sinceSequence` value AND avoids unbounded replay cost for a long-disconnected client. The heuristic switch is the cleanness win — clients don't need to decide between "ask for a slice" and "ask for a snapshot"; they just ask, and the server picks.
  3. Shape C adds per-connection state that's redundant with the client's own sequence tracking. Every client already knows the last sequence it observed (it's the most recent `event.sequence` it processed). Passing it on each catch-up request is a fixed cost; tracking it server-side would force the server to maintain bookkeeping across the WS message loop, which complicates the connection-close path and the dispatcher's stateless invariant.
  4. Shape B reuses two existing primitives verbatim — the `event-applied` envelope (for the slice path) and `serializeProjectionForWire` (for the snapshot path) — without duplicating either. The new surface is one handler + one new request type + one new ack type.

- **Snapshot-fallback heuristic: `gap > WS_CATCHUP_MAX_EVENTS` (default 500).** When `currentMaxSequence - sinceSequence > 500`, the handler skips the event-by-event replay and sends a snapshot. Rationale:

  1. A 500-event slice is the rough break-even point on round-trip-cost vs. snapshot-cost for typical projections (~50KB serialised snapshot; ~200 bytes per event-applied frame including envelope overhead; the snapshot dominates around the 250–500 event mark depending on payload density). The exact number doesn't matter much; the order of magnitude does.
  2. Configurable via env var so the heuristic can be tuned per deployment without a code change. Tests inject the value directly into the handler options to keep the verification deterministic.
  3. Default of 500 is deliberately conservative on the snapshot side — most reconnects in normal operation will be well below 500 events (the typical case is < 10 events behind after a network blip), so the slice path is the hot path. The snapshot fallback handles the audience-chapter-scrub case and the long-network-partition recovery case.
  4. The threshold check is a simple inequality — no per-session tuning, no adaptive heuristic. Adding adaptive behaviour later is a backward-compatible change (clients don't observe the threshold; they observe the response shape, which is unambiguously discriminated by `caught-up.payload.fromSnapshot`).

- **Reuse `event-applied` envelope for replay frames.** The slice path constructs frames with `type: 'event-applied'`, NOT a new `event-replayed` discriminator. Rationale:

  1. The wire shape of a replayed event is structurally identical to a live event — same `Event` envelope, same fields. A separate type would force every client to write two handlers that do the same thing.
  2. The replay sequence is monotonically increasing AND adjacent to the live broadcast stream by construction (replay covers `(sinceSequence, currentMax]`; live broadcasts cover `> currentMax`). Clients route both through one reducer keyed by `event.sequence`.
  3. Each `event-applied` envelope still carries its OWN freshly-minted server-mint `id` (the message id, not the event id). The `event.id` and `event.sequence` are stable across replay and live — but the envelope's outer `id` is per-frame. Same shape every broadcast surface uses.
  4. The `caught-up` ack at the end gives the client an explicit "the replay window is closed" signal. Without it, the client has no way to know whether a subsequent `event-applied` is a replay frame or a live broadcast. The ack carries `throughSequence` so the client can pin its local state to the catch-up boundary.

- **Client-supplied dedup contract.** Clients MUST deduplicate `event-applied` frames by `event.sequence`. This is the only ordering / non-duplication guarantee that's both implementable and meaningful:

  - The handler reads its slice from the DB (`SELECT ... WHERE sequence > $sinceSequence AND sequence <= $currentMax ORDER BY sequence ASC`). The bus may emit a NEW live broadcast at sequence `currentMax + 1` between the SELECT and the iteration, and that live broadcast reaches the same socket via the broadcast subscriber. If `currentMax + 1` arrives at the client BEFORE the catch-up handler's last replay frame, the client sees the live broadcast first and then the replay tail — both contain sequence numbers; the dedup is a `sequence > lastApplied` check.
  - The handler cannot synchronously block the bus while it iterates its slice — the bus is per-app-instance and synchronous-dispatch; blocking would freeze every other subscriber.
  - Documenting the dedup contract is the right surface: clients already have a `lastAppliedSequence` they track for the snapshot anchor; checking each incoming `event-applied` against it is one comparison.

  Pinned by the cucumber scenario "catch-up after a fresh propose interleaves with the live broadcast" — the client receives `event-applied(seq N)` (from catch-up) and `event-applied(seq N)` (from live) and the dedup guarantee is the only thing that prevents the client from applying the event twice.

- **No client retry / backoff / jitter implementation in this task.** The server surface is the catch-up handler + the envelope vocabulary. Client orchestration — detecting the disconnect, deciding when to retry, picking `sinceSequence`, handling the snapshot-fallback response — lives in the participant / moderator / audience workspaces and is owned by future tasks. This refinement explicitly defers that work.

- **Configurable threshold via env var `WS_CATCHUP_MAX_EVENTS` (default 500).** Read once at handler-registration time. The handler accepts the value via its options shape so tests can inject a small threshold (e.g. 3) to exercise both branches deterministically. Production callers don't pass the option; the env-resolution path reads `process.env['WS_CATCHUP_MAX_EVENTS']` (falling back to 500 if absent or unparseable). Same lazy-resolution pattern the connection-handling plugin uses for `SESSION_TOKEN_SECRET`.

- **Subscribe-before-act gate** reuses the `'forbidden'` wire code from the existing taxonomy. A client that asks to catch up on a session it hasn't subscribed to is treated identically to one that proposes / votes / commits / snapshots without subscribing — uniform protocol-layer invariant. The HTTP `event-log` endpoint (when it lands) is the surface for callers who want a slice WITHOUT subscribing.

- **Visibility re-check** runs AFTER subscribe — same existence-non-leak rule. A session that became invisible between subscribe and catch-up surfaces as `not-found`.

- **`sinceSequence` is `int.nonnegative`.** Zero is valid (the client says "I have seen nothing; send me everything"). The schema rejects negative values. There's no implicit "missing field defaults to zero" — the client must supply the value explicitly.

- **`sinceSequence` past the head — defensive, not an error.** When `sinceSequence > currentMaxSequence`, the handler does NOT error. It logs a warn (the client's local sequence is somehow ahead of the server's, which should not happen but is recoverable) and sends a `caught-up` ack with `eventCount: 0` and `throughSequence: currentMaxSequence`. Forcing an error here would push the client into a reconnect loop they can't recover from. Pinned by the unit test "client ahead → caught-up eventCount=0".

- **`caught-up` payload shape.** `{ sessionId, throughSequence, eventCount, fromSnapshot }`:
  - `sessionId` — for client routing when a single connection multiplexes sessions.
  - `throughSequence` — the sequence of the last event the catch-up considered (the slice path: `currentMaxSequence` at the time of the SELECT; the snapshot path: `projection.lastAppliedSequence`).
  - `eventCount` — the number of `event-applied` frames the handler emitted as part of THIS catch-up. Zero for the snapshot-fallback path and for the no-op-at-head case.
  - `fromSnapshot` — `true` when the snapshot-fallback path ran; `false` for the slice path (including the no-op case where the slice was empty).

- **Test coverage layered per ADR 0022:**
  - Pure-logic handler-builder behaviour (gate stack, threshold heuristic, slice path, snapshot path, no-op at head, client-ahead defensive path) → Vitest in `apps/server/src/ws/handlers/catch-up.test.ts`. Memory-pool shim recognises the auth SELECT + visibility SELECT + MAX(sequence) SELECT + slice SELECT. The threshold is injected via the handler options (not the env) for hermetic tests.
  - Wire-path behaviour against pglite → Cucumber in `tests/behavior/backend/ws-catch-up.feature` (4 scenarios). Reuses the existing WS-test infrastructure (auth-gated app + cookie + client lifecycle) from `backend-ws-auth.steps.ts` / `backend-ws-connection.steps.ts` / `backend-ws-subscribe.steps.ts`. Includes the four headline scenarios documented in the deliverables.

## Open questions

(none — all decided)
