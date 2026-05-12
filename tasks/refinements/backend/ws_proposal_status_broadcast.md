# Server → all subscribed clients: per-facet proposal-status broadcast

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.websocket_protocol.ws_proposal_status_broadcast`
**Effort estimate**: 1d
**Inherited dependencies**: `backend.websocket_protocol.ws_event_broadcast` (settled — `app.wsBroadcast` bus + the `event-applied` listener pattern + the per-connection sender registry + the post-commit-emit invariant), `backend.websocket_protocol.ws_subscribe_to_session` (settled — `app.wsSubscriptions.connectionsForSession(...)`).

## What this task is

Land a second listener on the `app.wsBroadcast` bus that — for the four event kinds that can modify per-facet proposal status — fans out a derived `proposal-status` envelope to every WS connection subscribed to the affected session. The envelope's payload is the source-of-truth `perFacetStatus` for the proposal at the triggering event's sequence, computed via the existing `deriveFacetStatus(...)` projection helper. Two pieces ship together:

1. **`buildProposalStatusBroadcastListener(...)`** — a pure builder capturing the subscription registry, the connection-sender registry, the event-log reader, and the logger; returns a `WsBroadcastListener` ready for registration. Pure so the filter / compute / fan-out behaviour is unit-testable without standing up a Fastify instance or a real DB pool.
2. **`wsProposalStatusBroadcastPlugin`** — the Fastify plugin that wires the listener against `app.wsBroadcast`. Registered **after** `wsEventAppliedBroadcastPlugin` in `server.ts` so the registration order — and therefore the synchronous-dispatch order on the bus — is `event-applied` → `proposal-status`.

The wire surface adds one new `WsMessageType` — `'proposal-status'` — to the closed discriminated union in `packages/shared-types/src/ws-envelope.ts`, appended at the tail of **Group A** (server-emitted unsolicited frames, alongside `hello`, `event-applied`, `error`, `diagnostic`). Payload shape: `{ sessionId, proposalId, sequence, perFacetStatus }` where `perFacetStatus` is a `Partial<Record<FacetName, FacetStatus>>` reflecting only the facets the proposal actually targets.

## Why it needs to be done

The four write handlers (propose / vote / commit / mark-meta-disagreement) already broadcast their raw events via `event-applied`. Clients could compute per-facet status themselves by replaying the projection precedence rules from the raw event stream — but that duplicates the server's `deriveFacetStatus` logic on three different surfaces (moderator / participant / audience), and any drift between client and server logic would create silent inconsistency. The `proposal-status` broadcast lets the server be the single source of truth for the facet-status view; clients render directly from the broadcast without re-implementing the precedence rules.

## Inputs / context

From [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts):

- `deriveFacetStatus(projection, proposalId, facet) → FacetStatus | undefined`. The status precedence rules live here. `FacetStatus` is `'proposed' | 'agreed' | 'disputed' | 'committed' | 'meta-disagreement'`. This module is the source of truth — the broadcast subscriber reads through it and reflects whatever it returns, no parallel computation.

From [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts):

- The 11 proposal sub-kinds; only four of them target a per-facet state (`classify-node` → `node.classification`, `set-node-substance` → `node.substance`, `set-edge-substance` → `edge.substance`, `edit-wording` → `node.wording`). The remaining seven are structural (axiom-mark, decompose, interpretive-split, meta-move, break-edge, amend-node, annotate) — they have no facet target.
- Vote sub-arms: `agree`, `dispute`, `withdraw` (withdraw is a `vote` variant, not a separate kind).

From [`apps/server/src/ws/broadcast/event-applied.ts`](../../../apps/server/src/ws/broadcast/event-applied.ts):

- The structural template for a broadcast listener: per-connection iteration with try / catch per send so one bad socket logs at warn and the iteration continues.

## Decisions

### Group-A append placement

The `'proposal-status'` literal is appended at the tail of **Group A** in `WsMessageType`, beside the other server-emitted unsolicited frames (`hello`, `event-applied`, `error`, `diagnostic`). The `proposal-status` envelope is server-emitted, has no `inResponseTo`, and is broadcast (not request/response) — group-A is the only correct home. The diagnostic and proposal-status agents both targeted this tail; the convention scales because each task appends one literal and the diff is independent.

### Filter set: four event kinds, opt-out for every other kind

The listener proceeds only for `proposal`, `vote`, `commit`, `meta-disagreement-marked`. Every other event kind (`session-created`, `participant-joined`, `participant-left`, `entity-included`, `node-created`, `edge-created`, `annotation-created`, `session-ended`, `snapshot-created`) returns the listener early — no broadcast. This rules out N+1 work on session-lifecycle events that can't change per-facet state. Structural proposal sub-kinds (axiom-mark, decompose, …) also skip — `deriveFacetStatus` returns `undefined` for them and the listener treats `undefined` as "no broadcast".

### Source of truth is `deriveFacetStatus`

The broadcast subscriber does not re-implement status precedence. For each affected proposal it loads the projection from the event log (`projectFromLog`) up to and including the triggering event's sequence, then calls `deriveFacetStatus(projection, proposalId, facet)` for the facet the proposal targets. The payload's `perFacetStatus` is exactly `{ <facetName>: <status> }`. Today this is a single-facet object; the shape leaves room for multi-facet proposals (none exist yet) without a wire-format break.

### Snapshot replay vs. live projection cache

The server has no live per-session projection-cache decorator today (the projection-cache primitive exists at `apps/server/src/projection/cache.ts` but isn't decorated as `app.projection`). The listener replays the projection from the event log inside its async dispatch. The "Take the projection AT the current event's sequence" invariant is honoured because the bus emits AFTER the DB commits (`ws_event_broadcast`'s post-commit-emit rule) and the listener SELECTs `events WHERE sequence <= event.sequence ORDER BY sequence ASC`. The replay sees exactly the state up to and including the triggering event — no extra rows.

When a live cache decorator lands (a future task), the listener can swap the replay for an `app.projection.snapshotAt(sessionId, sequence)` call without changing the wire format or the subscriber's contract.

### Ordering invariant: `event-applied` → `proposal-status`

The bus is synchronous (mirroring `DiagnosticBus`) and dispatches to listeners in registration order. `wsEventAppliedBroadcastPlugin` registers its listener first; `wsProposalStatusBroadcastPlugin` registers second. So for each emit on the bus, the event-applied listener completes (synchronously sending its envelope to every subscriber) **before** this listener's synchronous prefix runs. This listener is async (DB query + projection replay), so the actual `proposal-status` fan-out happens after the event-applied fan-out has finished. Clients can rely on the order: the raw event arrives first, then (if applicable) the derived per-facet status.

### Per-connection error isolation

Mirror of `event-applied.ts`'s contract. Each `wsConnectionSenders.send(connId, envelope)` is wrapped in try/catch; a failed send logs at warn level with the `connectionId` + `sessionId` + `proposalId` and the iteration continues so the other senders still receive the broadcast. Failure modes covered: socket already closed, downstream send throwing (e.g. backpressure), JSON-serialization failure (defensive — the schema-validated envelope should never fail JSON, but the catch is there).

### What is NOT in scope

- **Per-facet-status caching.** Recomputing the projection per emit is wasteful at high event rates, but the projection-cache task owns the cache primitive; threading it through the listener is one swap when that primitive lands.
- **Suppression of no-op transitions.** If a vote arrives that doesn't change `perFacetStatus` (e.g. a re-agree from the same voter), the listener still broadcasts. The wire surface is idempotent; clients re-rendering on the same status are a no-op.
- **Multi-instance fan-out.** The bus + the subscription registry + the connection-sender registry are all in-process. Cross-instance broadcast needs a separate transport (Postgres LISTEN/NOTIFY, Redis pub/sub, or NATS) and is out of scope.

## Acceptance

- New `'proposal-status'` `WsMessageType` lands in `packages/shared-types/src/ws-envelope.ts`'s closed union, with the `wsProposalStatusPayloadSchema` covering `{ sessionId, proposalId, sequence, perFacetStatus }`. The vocabulary pin test in `ws-envelope.test.ts` references it.
- `buildProposalStatusBroadcastListener(...)` exports cleanly; the listener filter-skips on irrelevant kinds, computes the projection at the triggering sequence, and fans out via `app.wsConnectionSenders.send`.
- `wsProposalStatusBroadcastPlugin` registers the listener against `app.wsBroadcast`, AFTER the event-applied plugin (so registration order matches the desired emit order).
- Unit tests in `apps/server/src/ws/broadcast/proposal-status.test.ts`: filter skips on session-created / participant-joined / entity-included / node-created / annotation-created / structural proposals; vote-agree / vote-dispute / vote-withdraw / commit / meta-disagreement-marked produce broadcasts with the expected `perFacetStatus`; multiple subscribed connections each receive; subscribers for a different session do NOT receive; one bad sender doesn't break the others.
- Cucumber scenarios in `tests/behavior/backend/ws-proposal-status.feature` exercise the round trip through pglite + a real Fastify instance: after a vote, the second subscribed client receives the `proposal-status` envelope reflecting the post-vote per-facet state; after a commit, both clients receive a broadcast with `committed` status; a client subscribed to a different session does NOT receive.
- `make test` is green end-to-end.

## Status

- [x] Refinement document landed.
- [x] `'proposal-status'` type appended to Group A; vocabulary pin extended.
- [x] `buildProposalStatusBroadcastListener` + `wsProposalStatusBroadcastPlugin` implemented.
- [x] Subscriber registered in `server.ts` after `wsEventAppliedBroadcastPlugin`.
- [x] Vitest unit suite (`apps/server/src/ws/broadcast/proposal-status.test.ts`) covers the filter set, the four trigger kinds, multi-subscriber fan-out, cross-session isolation, and per-connection error isolation.
- [x] Cucumber feature + step defs cover the end-to-end round trip.
- [x] `complete 100` in `tasks/20-backend.tji` with refinement note.
- [x] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.

**Code landed across commits**: `596e1d8` (production code, tests, cucumber — accidentally co-authored with `ws_diagnostic_broadcast` when the two parallel sub-agents collided during their final commit window) and the follow-up commit that adds this refinement file + the tji `complete 100`.
