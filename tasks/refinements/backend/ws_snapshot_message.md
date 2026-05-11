# Snapshot message: client → server (state query)

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.websocket_protocol.ws_snapshot_message`
**Effort estimate**: 0.5d
**Inherited dependencies**: `backend.websocket_protocol.ws_message_envelope` (settled — closed `WsMessageType` enum + `WsDispatcher`), `backend.websocket_protocol.ws_auth_on_connect` (settled — `connection.user` populated by the upgrade gate), `backend.websocket_protocol.ws_subscribe_to_session` (settled — `app.wsSubscriptions.connectionsForSession(sessionId)` snapshot lookup), `backend.websocket_protocol.ws_error_message` (settled — canonical wire `error` envelope + `onHandlerError` echoes `ApiError`-shaped throws), `data_and_methodology.projection.*` (settled — `projectFromLog` + `Projection` storage class with its public iterator + getter surface).

## What this task is

Land the **last** of the WS request-shaped client→server methodology surface — the read-only `snapshot` envelope. The handler:

1. Validates that the client is **subscribed** to the target session (subscribe-before-act gate — reused from propose/vote/commit/meta).
2. Re-checks `canSeeSession(pool, sessionId, userId)` — same existence-non-leak rule the rest of the WS surface inherits.
3. Loads the session's event log + builds the projection via `projectFromLog(events, sessionId)`.
4. **Serializes** the projection to a JSON-safe shape (the in-memory `Projection` class holds `Map`s and is not directly stringifiable).
5. Sends a `snapshot-state` envelope to the originating client (`inResponseTo` correlated to the request's `id`). Payload carries `{ sessionId, sequence, projection }` — the full state snapshot at the current `lastAppliedSequence`.

No event append, no broadcast, no transaction. The handler is a **read-side query** layered on the same gate stack as the write handlers. Rejections at any gate (subscribe, visibility) throw `ApiError`-shaped values; the dispatcher's `onHandlerError` seam echoes them as typed wire `error` envelopes (per `ws_error_message`).

## Why it needs to be done

The four write-shaped WS handlers (propose / vote / commit / meta-disagreement) all assume the client already has the projection in hand so it can compute `expectedSequence` and so the broadcast `event-applied` deltas have something to apply against. Without a `snapshot` request, the only way for a freshly-connected client to get the current state is either:

- **Replay every event from the server's HTTP event-log endpoint** — duplicative; the projection-replay logic runs both sides; bandwidth scales with the session's full event history even if the client only needs the current state. That path also forces a dual transport surface on the live UIs (HTTP for initial state, WS for deltas).
- **Wait for an `event-applied` broadcast to accidentally reveal the state** — broken; the broadcast only carries the *delta*, not the prior state. A subscriber that joined mid-session has no way to anchor the deltas without a baseline.

The `snapshot` envelope closes that gap. After a successful `subscribe` ack the client sends `snapshot`, receives `snapshot-state` with the projection-as-of-current-sequence, and then applies every subsequent `event-applied` frame as a delta on top. This is the **catch-up pattern** every long-lived projection-on-the-wire surface eventually needs; getting it in place now means the participant tablet and moderator console can run the "subscribe → snapshot → react-to-deltas" loop without a dual-transport workaround.

Downstream consumers:

- `participant_ui` and `moderator_ui` issue `snapshot` after `subscribe` to anchor their local projection cache.
- `frontend-realtime-projection-projection_sync` (the live-projection-sync surface, when it lands) will mint the same envelope from the reconnection / reconciliation paths.
- The future `ws_reconnection_handling` task may augment this with a `since` parameter for incremental catch-up — out of scope here; the v1 wire shape carries `{ sessionId, at? }` (with `at` documented as a future extension; not implemented in v1, see Decisions).

## Inputs / context

From [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts):

- `projectFromLog(events, sessionId)` builds a `Projection` from an in-order event list — same primitive the propose/vote/commit/meta handlers use. The handler reuses it verbatim.

From [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts):

- `Projection` is a class with private `Map`s + public iterator/getter methods. `JSON.stringify` would emit `{}` for the Maps. The handler therefore **serializes** the projection through a deterministic helper (`serializeProjectionForWire`) that walks the public iterators and emits a JSON-safe object shape.

From [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts):

- `ParticipantRecord`, `ProjectedNode`, `ProjectedEdge`, `ProjectedAnnotation`, `PendingProposal`, `CommittedProposalRecord`, `SnapshotRecord`, `UnresolvedMetaDisagreement`, `FacetState<T>` — these define the projection's data shapes. `FacetState.perParticipant` is a `Map<string, PerParticipantFacetState>`; `ProjectedNode.axiomMarks` is a `Map<string, AxiomMarkRecord>`. Both are flattened to plain objects keyed by userId in the wire shape.

From [`apps/server/src/ws/handlers/meta-disagreement.ts`](../../../apps/server/src/ws/handlers/meta-disagreement.ts) (most-recent sibling — the structural template for the gate stack + the per-row mapper + the response-envelope mint):

- The two gates (subscribe-before-act + visibility) are identical to this handler's gates; the event-log SELECT + `projectFromLog` call is identical. The differences are: (1) no transaction (read-only), (2) no FOR UPDATE / MAX(sequence) / append / broadcast — just the SELECT and the response.

From [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts):

- The closed `WsMessageType` enum + the three-group layout convention. This task appends `'snapshot'` to Group B's tail and `'snapshot-state'` to Group C's tail. The vocabulary test pin in `ws-envelope.test.ts` widens by one entry per group.

From [`apps/server/src/ws/handlers/propose.ts`](../../../apps/server/src/ws/handlers/propose.ts):

- The `rowToEvent` mapper that converts a `session_events` row to the canonical `Event` envelope shape. Duplicated here (same module-self-contained reason the four sibling handlers duplicate it).

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): pure-logic builder behaviour → Vitest; wire-path behaviour against pglite → Cucumber. No ad-hoc verifications.

## Constraints / requirements

- **Read-only**: the handler MUST NOT append an event, MUST NOT emit a broadcast, MUST NOT open a write transaction. It runs a single read query (`SELECT ... FROM session_events ORDER BY sequence ASC`), builds the projection, and responds.
- **Subscribe-before-act gate** is the first check. Same `'forbidden'` wire code the write handlers use. (Rationale: even a read of session state is gated by subscription — the same protocol-layer invariant; a client that has not subscribed has no business asking for the state. See Decisions.)
- **Visibility re-check** runs AFTER subscribe. Same `'not-found'` existence-non-leak the rest of the WS surface inherits.
- **Single projection primitive**: `projectFromLog`. NO parallel state-derivation logic.
- **Serialization helper** lives in `apps/server/src/ws/handlers/snapshot.ts` (private to this module). It walks the projection's public surface and emits a JSON-safe object. The shape is documented in the handler's docblock + pinned by the unit tests so the wire contract is reviewable.
- **No HTTP body weight**: the response is a single `snapshot-state` envelope. Larger projections produce larger frames; pagination / chunking is out of scope (sessions are bounded by a single show's event count, well below frame-size concerns in v1).
- **Closed-union extension** (`packages/shared-types/src/ws-envelope.ts`): two new entries — `'snapshot'` (C→S request) and `'snapshot-state'` (S→C response). The vocabulary test pin in `ws-envelope.test.ts` widens by one entry per group.
- **Throws, doesn't `sendWsError`**: every rejection throws an `ApiError`-shaped value; the dispatcher's `onHandlerError` echoes it.
- **No `expectedSequence`**: this is a read, not a write; there's no optimistic-concurrency token. The response payload's `sequence` field is what the client uses to anchor its local projection state.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm --filter @a-conversa/shared-types run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; baseline 968 tests still pass plus the new handler tests + the vocabulary pin update.
- `pnpm run test:behavior:smoke` (Cucumber) green; baseline 206 scenarios still pass plus the new snapshot feature.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

## Decisions

- **HEADLINE — Interpretation A (state query), NOT Interpretation B (label-creation).** The WBS task description "Snapshot message" is ambiguous. Two reasonable shapes are in play: **(A)** the wire `snapshot` envelope is a state-query — client asks "send me the current projection for this session" and the server replies with a `snapshot-state` carrying the full state. **(B)** the wire `snapshot` envelope is a moderator action that creates a labeled checkpoint event (`snapshot-created`) in the session log, mirroring propose/commit/meta.

  Investigation findings (recorded for the record):

  - **Both worlds partially exist.** The `snapshot-created` event kind is defined in `packages/shared-types/src/events.ts` (R29 — payload schema is in place); the projection's `addSnapshot` / `snapshots()` / `snapshotCount()` surface populates from those events; `docs/moderator-ui.md` F10 describes the moderator triggering a snapshot via the UI. So Interpretation B has an event shape ready in the data layer.
  - **But no methodology handler exists.** `apps/server/src/methodology/handlers/` contains `propose.ts`, `vote.ts`, `commit.ts`, `markMetaDisagreement.ts` — NO `createSnapshot.ts` or `labelSnapshot.ts`. The engine would need a new action variant + handler before a WS snapshot-create handler could call through it. Building that here would couple two concerns into one task.
  - **The projection-retrieval surface IS in place.** `projectFromLog(events, sessionId)` + `Projection` are clean primitives the write handlers already reuse. Interpretation A is a thin wrapper over existing infrastructure.
  - **The catch-up pattern is the bigger missing piece RIGHT NOW.** Once `ws_propose_message` / `ws_vote_message` / `ws_commit_message` / `ws_meta_disagreement_message` shipped, the live UIs gained the deltas (`event-applied` broadcasts) — but they have no way to anchor those deltas against an initial state without a snapshot query. The `subscribe → snapshot → react-to-deltas` loop is what makes the four write handlers useful end-to-end.

  Decision: **Interpretation A**. The catch-up state-query pattern is the bigger user-facing win at this stage; the labeled-checkpoint pattern (B) can be added later as a *sibling* task — it would need a methodology engine handler (`createSnapshot.ts`) AND its own WS handler (`ws_label_snapshot_message.md`, or similar). That work is **not in scope here**; the refinement explicitly defers it to a future task. Today's HTTP `list_snapshots` / `get_snapshot` endpoints (queued separately in `tasks/20-backend.tji` lines 273–280) handle the labeled-checkpoint retrieval side; when their write-side counterpart lands, the WS surface and HTTP surface will use a shared methodology-engine handler.

- **`at` parameter — documented as a future extension; NOT implemented in v1.** The handler contract sketch in the task brief mentions an optional `at: sequence` parameter that would let a client request the projection state as-of an earlier point in the event log. The v1 schema **accepts only `{ sessionId }`**; the `at` field is reserved by being documented in the schema's docblock but is not added to the Zod object. Rationale:
  1. The use cases for "snapshot at a past sequence" are (i) test-mode replay scrubbing and (ii) audience-surface chapter navigation — both are future deliverables, not v1 surface.
  2. Adding it would require either (a) reading only a prefix of `session_events` (`WHERE sequence <= $2 ORDER BY sequence ASC`) — minor SQL change, but doubles the test matrix — or (b) caching a sequence-indexed projection map (heavy, premature).
  3. Future-extension safety: the wire schema is permissive of additional fields (Zod's default is to strip unknown keys — the client can send `at` today and the server will ignore it). When the feature lands, the schema is widened in a backward-compatible way.
  Pinned by a unit test that confirms the schema rejects only well-known violations (e.g. missing `sessionId`) and that the handler ignores any `at` field on the payload today.

- **Subscribe-before-act gate** reuses the same `'forbidden'` wire code the four write handlers use. A client that asks for a snapshot without first subscribing is treated identically to one that proposes / votes / commits / marks without subscribing — uniform protocol-layer invariant. Rationale for the same gate on a read:
  1. The subscription is the client's commitment to receive the subsequent broadcast stream. A `snapshot` outside that commitment is a request for a stale-on-arrival state — the client receives the projection but has no live channel to keep it current. The gate forbids that by construction; the only legitimate flow is "subscribe first, then snapshot, then react to deltas."
  2. Uniformity with the write handlers keeps the dispatcher's gating-ladder shape consistent across every C→S request type. A reader of `apps/server/src/ws/handlers/` sees the same opening two gates on every handler.
  3. The HTTP `event-log` endpoint (when it lands) is the surface for callers who want the state without subscribing to live deltas — they're different transports for different needs.

- **Visibility re-check** runs AFTER subscribe — same existence-non-leak rule. A session that became invisible between subscribe and snapshot surfaces as `not-found`.

- **`snapshot-state` is the response envelope name.** Mirrors the past-participle-ish convention the four write handlers use (`proposed` / `voted` / `committed` / `meta-disagreement-marked`) but with a more explicit `snapshot-state` to leave room for the future B-shaped `snapshot-labeled` ack without name collision. Naming a future task can pick `'snapshot-labeled'` (matching `snapshot-created` event kind, but past-participle for the ack) or `'snapshot-marked'`; **this task pre-emptively reserves `'snapshot-state'` for the state-query response** so the namespace stays clean.

- **Projection serialization shape — explicit but loose.** The wire payload's `projection` field is a structured object with these top-level keys (matching the `Projection` class's public surface):

  ```ts
  {
    sessionState: 'open' | 'ended',
    lastAppliedSequence: number,
    participants: Array<{ userId, role, screenName, joinedAt, leftAt }>,
    nodes: Array<{ id, wording, createdBy, createdAt, visible, wordingFacet, classificationFacet, substanceFacet, axiomMarks }>,
    edges: Array<{ id, role, sourceNodeId, targetNodeId, createdBy, createdAt, visible, substanceFacet }>,
    annotations: Array<{ id, kind, content, targetNodeId, targetEdgeId, createdBy, createdAt, visible, wordingFacet, substanceFacet }>,
    pendingProposals: Array<{ proposalEventId, payload, proposer, proposedAt }>,
    committedProposals: Array<{ proposalEventId, payload, committedAt, moderator }>,
    snapshots: Array<{ snapshotId, label, logPosition, createdAt }>,
    unresolvedMetaDisagreements: Array<{ proposalEventId, payload, proposer, proposedAt, markedBy, markedAt }>
  }
  ```

  Each `FacetState` flattens its `perParticipant` Map to a plain object `{ [userId]: { vote, proposalEventId, votedAt } }`. Each `ProjectedNode`'s `axiomMarks` Map similarly flattens to `{ [userId]: { proposalEventId, markedAt } }`. The wire schema validates the OUTER container (`sessionState` + arrays of records with the right top-level keys) but uses `z.unknown()` for the FacetState / axiomMarks objects' nested record values. Rationale:

  - The projection types are already locked by the `projection` work-stream's refinements; widening the wire schema to enforce every nested key would tightly couple the WS module to those types and produce a maintenance burden every time a new facet field lands.
  - Schema-on-write is enforced at the EVENT layer (ADR 0021) — every event that produced a state mutation was structurally validated when it was appended. The projection built from those events is, by construction, a deterministic function of validated input. Re-validating the OUTPUT of a pure function over validated inputs is defensive but redundant.
  - The serialization helper's UNIT TESTS are what pin the wire shape; the schema's job is to keep the OUTER envelope honest (no `null` projection, no missing `sessionId`, etc.).

  The serialization helper itself is small (one function, ~80 lines) and lives in `apps/server/src/ws/handlers/snapshot.ts` next to the handler. If/when a future task moves it to a shared module (e.g. for the audience-surface chapter-replay payload), the move is a single export change.

- **No transaction.** The handler issues one `SELECT ... ORDER BY sequence ASC` and that's all. The MAX(sequence) read the write handlers do under FOR UPDATE is unnecessary here — the response carries the `lastAppliedSequence` derived from `projection.lastAppliedSequence`, which is the sequence of the most recent event the SELECT returned. A `propose` that lands milliseconds later does NOT race with this read: the client will receive the new event as an `event-applied` broadcast and apply it as a delta on top of the snapshot. (If the broadcast happens to arrive on the wire BEFORE the snapshot response — possible if the read takes longer than a propose — the client deduplicates by sequence: any broadcast at `sequence <= snapshot.sequence` is a no-op.)

- **Handler builder closure**, mirroring the four write handlers: `buildSnapshotHandler({ pool, registry, log })` returns the handler. No `broadcast` (read-only, no emit); no `now` (no event constructed). Builder shape kept minimal.

- **The handler does NOT use the `ProjectionCache`** for the same reason the write handlers don't: the v1 cache wiring is its own future task. Replay-per-request is the consistent choice across the WS handler surface; both surfaces (read + write) flip together when the cache lands.

- **Test coverage layered per ADR 0022:**
  - Pure-logic handler-builder behaviour (subscribe gate, visibility gate, successful snapshot of fresh empty session, successful snapshot reflecting prior events, payload shape pin) → Vitest in `apps/server/src/ws/handlers/snapshot.test.ts`. Uses the same `__buildTestWsApp` + memory-pool pattern as the four write handler tests. Pool shim recognizes the auth-SELECT + visibility-SELECT + event-log SELECT (no BEGIN/COMMIT/FOR UPDATE/MAX/INSERT — those are unused on this surface).
  - Wire-path behaviour against pglite → Cucumber in `tests/behavior/backend/ws-snapshot.feature` (3 scenarios). Reuses the existing WS-test infrastructure (auth-gated app + cookie + client lifecycle) from `backend-ws-auth.steps.ts` / `backend-ws-connection.steps.ts` / `backend-ws-subscribe.steps.ts`. Includes a regression-pin: a snapshot taken after a propose+vote+commit sequence carries the committed proposal in the response (confirms the snapshot reflects events appended via the write handlers).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- Shared types: [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) — `'snapshot'` + `'snapshot-state'` added to `wsMessageTypes` (Group-B / Group-C respectively per the documented union-layout convention) + matching payload schemas + `WsMessagePayloadMap` entries; the file's comment block updated to record the two new entries at the documented group tails.
- Server (handler): [`apps/server/src/ws/handlers/snapshot.ts`](../../../apps/server/src/ws/handlers/snapshot.ts) — `buildSnapshotHandler` + `registerSnapshotHandlers` + the subscribe-before-act gate + the visibility re-check + the event-log SELECT + the `projectFromLog` call + the `serializeProjectionForWire` helper + the `snapshot-state` response. Read-only — no transaction, no event append, no broadcast.
- Server (registration): [`apps/server/src/ws/handlers/index.ts`](../../../apps/server/src/ws/handlers/index.ts) — `wsHandlersPlugin` extended to register `buildSnapshotHandler` alongside the four write handlers. The exports list re-exports `serializeProjectionForWire` for downstream consumers (the future audience-surface / participant-tablet / moderator-console projection-on-the-wire surfaces).
- Tests (Vitest): [`apps/server/src/ws/handlers/snapshot.test.ts`](../../../apps/server/src/ws/handlers/snapshot.test.ts) (handler integration cases + pure-logic wire-shape pins for `serializeProjectionForWire`) + a vocabulary-pin update in [`packages/shared-types/src/ws-envelope.test.ts`](../../../packages/shared-types/src/ws-envelope.test.ts).
- Tests (Cucumber): [`tests/behavior/backend/ws-snapshot.feature`](../../backend/ws-snapshot.feature) + [`tests/behavior/steps/backend-ws-snapshot.steps.ts`](../../backend/steps/backend-ws-snapshot.steps.ts).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
