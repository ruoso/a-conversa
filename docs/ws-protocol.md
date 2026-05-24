# WebSocket protocol

Canonical reference for the `a-conversa` WebSocket protocol. Covers every wire envelope, every message-handler contract, the gate stacks, the error vocabulary, the ordering invariants, and the reconnection/catch-up flow.

This is a **reference**, not a tutorial. Examples are short; rationale links out to the per-task refinements under [`tasks/refinements/backend/ws_*.md`](../tasks/refinements/backend/). The wire schema's source of truth is [`packages/shared-types/src/ws-envelope.ts`](../packages/shared-types/src/ws-envelope.ts); server-side handlers, broadcasts, and the dispatcher live under [`apps/server/src/ws/`](../apps/server/src/ws/).

Aim: read end-to-end in 10–15 minutes.

## Overview

- **Endpoint**: `GET /ws`. Single WebSocket route. Same-origin in production; the browser's `new WebSocket(...)` API sends the platform session cookie on upgrade automatically. The route is marked `hide: true` in OpenAPI — this document is the user-facing spec.
- **Auth**: a Fastify `preValidation` hook on `GET /ws` reads the `aconversa-session` cookie and verifies it via the same `authenticateRequest(cookieHeader, pool, secret, now?)` primitive HTTP routes use. Failure throws `ApiError(401, 'auth-required', …)` BEFORE the handshake completes; the client's `WebSocket` (or `app.injectWS`) sees a non-101 response. No `connectionId` is minted on rejection. Success populates `request.authUser = { id, screenName }` which the connection handler copies onto the per-connection `WsConnectionContext.user`. See [`ws_auth_on_connect.md`](../tasks/refinements/backend/ws_auth_on_connect.md).
- **Connection lifecycle**: on accept, the server mints a v4 UUID `connectionId`, registers per-connection senders + subscription bookkeeping, and emits a server-originated [`hello`](#hello) envelope as the first frame. On close, every subscription this connection held is dropped from the registry and the per-connection sender is unregistered. The server emits close code **1001 GOING_AWAY** during shutdown (each open socket gets `socket.close(1001, 'server-shutting-down')`) and **1011 INTERNAL_ERROR** if the WS handler throws synchronously / rejects. See [`ws_connection_handling.md`](../tasks/refinements/backend/ws_connection_handling.md).

## Envelope shape

Every WS frame in either direction is a JSON-encoded UTF-8 text frame whose decoded value matches:

```ts
interface WsEnvelope<T extends WsMessageType> {
  type: T;                 // closed-enum discriminator (see catalog below)
  id: string;              // RFC 4122 v4 UUID, sender-minted, required
  inResponseTo?: string;   // present on responses correlated to a prior request
  payload: WsPayloadFor<T>; // per-type shape from the discriminated-union variant
}
```

Two-stage parse (outer envelope first, then per-`type` payload from the [`wsMessagePayloadSchemas`](../packages/shared-types/src/ws-envelope.ts) registry) produces clearer error messages than a single `z.discriminatedUnion`. A type-mismatch surfaces at the envelope level; a payload-shape error surfaces tagged with the offending `type`. The closed-union pattern mirrors the event-log envelope (see [ADR 0021](adr/0021-event-envelope-discriminated-union-with-zod.md) and [`ws_message_envelope.md`](../tasks/refinements/backend/ws_message_envelope.md)).

`serializeWsEnvelope` re-validates every outgoing frame so a server-side construction bug surfaces at the server, not silently on the wire (schema-on-write).

Correlation: the client mints `id` on every envelope it originates; the server mints `id` on every envelope IT originates. The server echoes the client's `id` via `inResponseTo` on ack/result/error envelopes correlated to a specific request. Unsolicited server-emitted envelopes (`hello`, broadcasts) carry their own `id` and no `inResponseTo`.

Binary WebSocket frames are not part of the protocol — the receive loop converts `Buffer` / `ArrayBuffer` / fragmented `Buffer[]` to UTF-8 before `JSON.parse`; non-UTF-8-JSON content fails the parse and routes through the [`malformed-envelope`](#malformed-envelope-errors) path.

### Per-field length caps

User-authored text fields in the proposal / event vocabulary are capped at the schema layer. A payload that exceeds the cap fails the per-type Zod parse and routes through the [`malformed-envelope`](#malformed-envelope-errors) path (HTTP-side: 400 `validation-failed`). The cap constants live in [`packages/shared-types/src/limits.ts`](../packages/shared-types/src/limits.ts).

| Field(s) | Cap | Constant |
| --- | --- | --- |
| Node `wording`, annotation `content`, `edit-wording.new_wording` (reword + restructure), `decompose.components[].wording`, `interpretive-split.readings[].wording`, `meta-move.content`, `amend-node.new_content`, `annotate.content` | 10 000 chars | `MAX_METHODOLOGY_TEXT_LENGTH` |
| Session `topic` | 256 chars | `MAX_TOPIC_LENGTH` |
| Snapshot `label` | 128 chars | `MAX_SNAPSHOT_LABEL_LENGTH` |
| Participant `screen_name` | 64 chars | `MAX_SCREEN_NAME_LENGTH` |

The methodology-text cap is generous on purpose (a few paragraphs of nuanced text), while comfortably under the 64 KiB frame ceiling enforced at the transport layer.

## Message-type catalog

The closed [`WsMessageType`](../packages/shared-types/src/ws-envelope.ts) enum has 21 entries today, grouped by direction:

- **C→S requests**: [`subscribe`](#subscribe) / [`unsubscribe`](#unsubscribe) / [`propose`](#propose) / [`vote`](#vote) / [`commit`](#commit) / [`mark-meta-disagreement`](#mark-meta-disagreement) / [`snapshot`](#snapshot) / [`catch-up`](#catch-up).
- **S→C acks/results** (correlated via `inResponseTo`): [`subscribed`](#subscribed) / [`unsubscribed`](#unsubscribed) / [`proposed`](#proposed) / [`voted`](#voted) / [`committed`](#committed) / [`meta-disagreement-marked`](#meta-disagreement-marked) / [`snapshot-state`](#snapshot-state) / [`caught-up`](#caught-up).
- **S→C unsolicited**: [`hello`](#hello) / [`event-applied`](#event-applied) / [`proposal-status`](#proposal-status) / [`diagnostic`](#diagnostic) / [`error`](#error).

### `hello`

- **Direction**: S→C unsolicited.
- **Payload schema**: `helloPayloadSchema` — `{ connectionId: uuid }`.
- **When**: first frame on every accepted connection, immediately after the upgrade completes.
- **Correlation**: server-minted `id`; no `inResponseTo`.
- **Owner**: [`apps/server/src/ws/connection.ts`](../apps/server/src/ws/connection.ts) (via `buildHelloEnvelope` in [`envelope.ts`](../apps/server/src/ws/envelope.ts)).

```json
{ "type": "hello", "id": "…", "payload": { "connectionId": "…" } }
```

The `connectionId` is stable for the connection's lifetime and is used in server logs as the sender id on broadcasts. It is NOT a user id; the authenticated user is attached server-side to `WsConnectionContext.user` and is not echoed on `hello`.

### `subscribe`

- **Direction**: C→S request.
- **Payload schema**: `subscribePayloadSchema` — `{ sessionId: uuid }`.
- **When**: the client asks the server to start streaming events for `sessionId`. Idempotent — re-subscribing is a no-op and still produces the ack.
- **Correlation**: ack via [`subscribed`](#subscribed) carries `inResponseTo: <subscribe.id>`. Failure → [`error`](#error) — `code: 'not-found'` for an invisible session, `code: 'too-many-subscriptions'` when the per-connection cap is reached (see [Error envelope reference](#error-envelope-reference)), `inResponseTo: <subscribe.id>` on every error path.
- **Owner**: [`apps/server/src/ws/handlers/subscribe.ts`](../apps/server/src/ws/handlers/subscribe.ts) (registered via [`handlers/index.ts`](../apps/server/src/ws/handlers/index.ts)).

```json
{ "type": "subscribe", "id": "…", "payload": { "sessionId": "…" } }
```

The handler runs `canSeeSession(pool, sessionId, userId)` — the same visibility predicate HTTP routes use. Invisible sessions surface as `not-found` (NOT `forbidden`) per the existence-non-leak rule documented in `sessions/visibility.ts`. On success the (connection, session) tuple is added to the per-instance [`WsSubscriptionRegistry`](../apps/server/src/ws/subscriptions.ts). The registry enforces a per-connection cap (`MAX_SUBSCRIPTIONS_PER_CONNECTION`, default 32, env override `WS_MAX_SUBSCRIPTIONS_PER_CONNECTION`); a fresh subscribe that would exceed the cap is rejected with `code: 'too-many-subscriptions'` while re-subscribing to a session the connection already holds remains idempotent. See [`ws_subscribe_to_session.md`](../tasks/refinements/backend/ws_subscribe_to_session.md) and [`subscription_cap_per_connection.md`](../tasks/refinements/backend-hardening/subscription_cap_per_connection.md).

### `unsubscribe`

- **Direction**: C→S request.
- **Payload schema**: `unsubscribePayloadSchema` — `{ sessionId: uuid }`.
- **When**: the client asks the server to stop streaming events for `sessionId`. Idempotent — unsubscribing from a session you weren't subscribed to still produces the ack.
- **Correlation**: ack via [`unsubscribed`](#unsubscribed). No error path — the contract is "after the ack, no more broadcasts for this session over this connection," trivially true when no subscription existed.
- **Owner**: [`apps/server/src/ws/handlers/subscribe.ts`](../apps/server/src/ws/handlers/subscribe.ts).

```json
{ "type": "unsubscribe", "id": "…", "payload": { "sessionId": "…" } }
```

On connection close, every still-held subscription is dropped server-side via `WsSubscriptionRegistry.removeConnection`; clients don't need to send a flurry of `unsubscribe` envelopes on teardown.

### `propose`

- **Direction**: C→S request.
- **Payload schema**: `proposePayloadSchema` — `{ sessionId, expectedSequence, proposal: ProposalPayload }`.
- **When**: the client asks the server to apply a `proposal` event. Must be preceded by a successful `subscribe` for the same session.
- **Correlation**: dual signal on success — [`proposed`](#proposed) ack (request-response, correlated) AND [`event-applied`](#event-applied) broadcast (unsolicited, fanned out to every subscriber including the proposer). Failure → [`error`](#error) with the relevant `code` (see [Error envelope reference](#error-envelope-reference)).
- **Owner**: [`apps/server/src/ws/handlers/propose.ts`](../apps/server/src/ws/handlers/propose.ts).

```json
{ "type": "propose", "id": "…",
  "payload": { "sessionId": "…", "expectedSequence": 12,
               "proposal": { "kind": "classify-node", "node_id": "…", "classification": "claim" } } }
```

`expectedSequence` is the client's view of `MAX(sequence)` for the session. A mismatch surfaces as `code: 'sequence-mismatch'`. The proposer identity comes from `connection.user.id` — no `proposerId` field on the payload. See [`ws_propose_message.md`](../tasks/refinements/backend/ws_propose_message.md).

### `vote`

- **Direction**: C→S request.
- **Payload schema**: `wsVotePayloadSchema` — `{ sessionId, expectedSequence, proposalId, choice: 'agree' | 'dispute' | 'withdraw' }`.
- **When**: the client asks the server to apply a `vote` event against a pending proposal. Must be preceded by a successful `subscribe`.
- **Correlation**: dual signal — [`voted`](#voted) ack + [`event-applied`](#event-applied) broadcast. Failure → [`error`](#error).
- **Owner**: [`apps/server/src/ws/handlers/vote.ts`](../apps/server/src/ws/handlers/vote.ts).

```json
{ "type": "vote", "id": "…",
  "payload": { "sessionId": "…", "expectedSequence": 13,
               "proposalId": "…", "choice": "agree" } }
```

Withdraw is a vote variant, not a separate envelope type. Voter identity comes from `connection.user.id`. The payload's `choice` field maps internally to the action / event payload's `vote` field (the wire name avoids the self-referential `{ type: 'vote', payload: { vote: ... } }` shape). See [`ws_vote_message.md`](../tasks/refinements/backend/ws_vote_message.md).

### `commit`

- **Direction**: C→S request.
- **Payload schema**: `wsCommitPayloadSchema` — `{ sessionId, expectedSequence, proposalId }`.
- **When**: the moderator commits a pending proposal whose facet has reached unanimous-agree. Must be preceded by a successful `subscribe`.
- **Correlation**: dual signal — [`committed`](#committed) ack + [`event-applied`](#event-applied) broadcast. Failure → [`error`](#error) with `code: 'not-a-moderator'` for non-moderators (headline gate), or other engine-rejection codes.
- **Owner**: [`apps/server/src/ws/handlers/commit.ts`](../apps/server/src/ws/handlers/commit.ts).

```json
{ "type": "commit", "id": "…",
  "payload": { "sessionId": "…", "expectedSequence": 14, "proposalId": "…" } }
```

Moderator identity comes from `connection.user.id`; no `moderatorId` on the payload. Engine rejections include `proposal-not-found`, `proposal-already-committed`, `proposal-already-meta-disagreement`, `unanimous-agree-required`, `methodology-not-exhausted`, `illegal-state-transition`. See [`ws_commit_message.md`](../tasks/refinements/backend/ws_commit_message.md).

### `mark-meta-disagreement`

- **Direction**: C→S request.
- **Payload schema**: `wsMarkMetaDisagreementPayloadSchema` — `{ sessionId, expectedSequence, proposalId }`.
- **When**: the moderator marks a pending proposal as meta-disagreement after diagnostic + decomposition have failed to resolve it. Must be preceded by a successful `subscribe`.
- **Correlation**: dual signal — [`meta-disagreement-marked`](#meta-disagreement-marked) ack + [`event-applied`](#event-applied) broadcast. Failure → [`error`](#error).
- **Owner**: [`apps/server/src/ws/handlers/meta-disagreement.ts`](../apps/server/src/ws/handlers/meta-disagreement.ts).

```json
{ "type": "mark-meta-disagreement", "id": "…",
  "payload": { "sessionId": "…", "expectedSequence": 15, "proposalId": "…" } }
```

Moderator-only; same identity-from-connection rule as `commit`. See [`ws_meta_disagreement_message.md`](../tasks/refinements/backend/ws_meta_disagreement_message.md).

### `snapshot`

- **Direction**: C→S request.
- **Payload schema**: `snapshotPayloadSchema` — `{ sessionId }`.
- **When**: the client asks for the current projection state. Must be preceded by a successful `subscribe`. Read-only — no event-append, no broadcast.
- **Correlation**: response via [`snapshot-state`](#snapshot-state) (correlated). Failure → [`error`](#error).
- **Owner**: [`apps/server/src/ws/handlers/snapshot.ts`](../apps/server/src/ws/handlers/snapshot.ts).

```json
{ "type": "snapshot", "id": "…", "payload": { "sessionId": "…" } }
```

No `at: <sequence>` parameter in v1 — the historical-point query is documented as a future extension. The wire schema accepts only `{ sessionId }`. Use the [`catch-up`](#catch-up) envelope for reconnection delta replay; use `snapshot` for explicit state fetch (mid-session join, re-anchor after a long disconnect). See [`ws_snapshot_message.md`](../tasks/refinements/backend/ws_snapshot_message.md).

### `catch-up`

- **Direction**: C→S request.
- **Payload schema**: `catchUpPayloadSchema` — `{ sessionId, sinceSequence }`.
- **When**: after reconnect + re-subscribe, the client asks for every event missed since `sinceSequence` (exclusive). Must be preceded by a successful `subscribe`.
- **Correlation**: closes with [`caught-up`](#caught-up) ack (correlated). The handler picks one of two paths:
  - **Slice replay**: streams [`event-applied`](#event-applied) envelopes for `(sinceSequence, currentMaxSequence]` (NOT correlated — these are unsolicited replay frames) then sends `caught-up` with `fromSnapshot: false`.
  - **Snapshot fallback**: when `currentMaxSequence - sinceSequence > WS_CATCHUP_MAX_EVENTS` (default 500, env-configurable, hard-capped at 5000), sends one [`snapshot-state`](#snapshot-state) envelope then `caught-up` with `fromSnapshot: true`.
- **Rate limit**: per-connection cap of **10 envelopes per 60 s** (default; env-overridable via `WS_CATCH_UP_MAX_PER_MINUTE`). Excess envelopes are rejected with [`error`](#error) `code: 'too-many-catch-up-requests'`; the connection stays open and the cap window self-resets after 60 s. The bucket is per-connection state cleared on socket close. Closes [`docs/security/m3-review/inputs.md`](security/m3-review/inputs.md) F-004.
- **Bounded SELECT**: both internal SELECTs (slice replay and snapshot fallback) carry an explicit `LIMIT`. The slice's LIMIT is the resolved threshold (clamped to 5000); the snapshot's LIMIT is `MAX_CATCH_UP_EVENTS_CEILING = 5000` directly — decoupled from the threshold so a small slice threshold doesn't truncate the snapshot. A single catch-up request can never scan more than 5000 rows. Closes [F-004](security/m3-review/inputs.md) + [F-005](security/m3-review/inputs.md).
- **Owner**: [`apps/server/src/ws/handlers/catch-up.ts`](../apps/server/src/ws/handlers/catch-up.ts).

```json
{ "type": "catch-up", "id": "…", "payload": { "sessionId": "…", "sinceSequence": 7 } }
```

Clients MUST dedupe `event-applied` frames by `event.sequence` — the per-event `sequence` is the single source of truth for ordering across replay-vs-live. See [Reconnection / catch-up flow](#reconnection--catch-up-flow) and [`ws_reconnection_handling.md`](../tasks/refinements/backend/ws_reconnection_handling.md).

### `withdraw-proposal`

- **Direction**: C→S request.
- **Payload schema**: `wsWithdrawProposalPayloadSchema` — `{ sessionId, expectedSequence, proposalEventId }`.
- **When**: the original proposer asks the server to retract a pending proposal they made before it commits. Must be preceded by a successful `subscribe`.
- **Authority**: proposer-only — the handler enforces "only the original proposer may withdraw" by matching `connection.user.id` against the projection's `PendingProposal.proposer` field (derived from `event.actor` of the original `proposal` event at projection time). A subscribed non-proposer attempting withdraw receives [`error`](#error) with `code: 'forbidden'`. Per [ADR 0027](adr/0027-entity-and-facet-layers-strict-separation.md), the handler emits one `entity-removed` event per entity the propose-time fan-out minted (the INVERSE of `buildStructuralEventsForPropose`). The proposal envelope event itself is NOT retracted — history is replay-authoritative + immutable per ADR 0021 / ADR 0020. The proposer identity comes from the authenticated connection — the wire payload has NO `proposerId` field.
- **Correlation**: closes with [`proposal-withdrawn`](#proposal-withdrawn) ack (correlated) AND zero or more [`event-applied`](#event-applied) broadcasts (one per emitted `entity-removed` event — see ADR 0027 for the per-sub-kind mapping; today only free-floating `classify-node` emits anything at propose-time).
- **Engine-rejection wire codes**: [`proposal-not-found`](#methodology-rejectionreason-codes) (404), [`proposal-already-committed`](#methodology-rejectionreason-codes) (422), [`proposal-already-meta-disagreement`](#methodology-rejectionreason-codes) (422), [`sequence-mismatch`](#methodology-rejectionreason-codes) (409), [`forbidden`](#http-apierror-codes-kebab-case) (proposer-only authority gate, 403).
- **Owner**: [`apps/server/src/ws/handlers/withdraw.ts`](../apps/server/src/ws/handlers/withdraw.ts).

```json
{
  "type": "withdraw-proposal",
  "id": "…",
  "payload": { "sessionId": "…", "expectedSequence": 5, "proposalEventId": "…" }
}
```

### `withdraw-agreement`

- **Direction**: C→S request.
- **Payload schema**: `wsWithdrawAgreementPayloadSchema` — `{ sessionId, expectedSequence, entity_kind, entity_id, facet, participant }`.
- **When**: a participant rescinds a prior agreement on a previously-committed `(entity, facet)` pair. Per [ADR 0030 §3](adr/0030-per-facet-vote-keying-and-sequential-capture.md) + [`docs/methodology.md`](methodology.md) line 25 the gesture is the methodology's "withdraw agreement" — distinct from changing a still-pending vote (which uses the regular `vote` envelope with `choice: 'dispute'`). Must be preceded by a successful `subscribe`.
- **Authority**: actor-must-match-participant — `connection.user.id` must equal `payload.participant`; a participant only withdraws their OWN agreement. Mismatches reject with `code: 'forbidden'`.
- **Correlation**: closes with [`agreement-withdrawn`](#agreement-withdrawn) ack (correlated) AND one [`event-applied`](#event-applied) broadcast (the appended `withdraw-agreement` event). On the next `deriveFacetStatus` call against the affected `(entity, facet)`, the projection's rule-4 derivation surfaces `'withdrawn'`.
- **Engine-rejection wire codes**: [`not-a-participant`](#methodology-rejectionreason-codes) (403, the requester is not a current participant in the session), [`target-entity-not-found`](#methodology-rejectionreason-codes) (404, the `(entity_kind, entity_id, facet)` triple doesn't resolve), [`inapplicable-to-facet`](#methodology-rejectionreason-codes) (422, the facet has not been committed — withdraw is only meaningful against a committed facet per ADR 0030 §3), [`no-prior-agree`](#methodology-rejectionreason-codes) (409, the participant has no recorded `'agree'` vote on the facet), [`sequence-mismatch`](#methodology-rejectionreason-codes) (409), [`forbidden`](#http-apierror-codes-kebab-case) (actor-mismatch or unauth, 403).
- **Owner**: [`apps/server/src/ws/handlers/withdraw-agreement.ts`](../apps/server/src/ws/handlers/withdraw-agreement.ts).

```json
{
  "type": "withdraw-agreement",
  "id": "…",
  "payload": {
    "sessionId": "…", "expectedSequence": 12,
    "entity_kind": "node", "entity_id": "…",
    "facet": "classification", "participant": "…"
  }
}
```

### `subscribed`

- **Direction**: S→C ack.
- **Payload schema**: `subscribedPayloadSchema` — `{ sessionId }`.
- **When**: after the server adds `(connection, session)` to the subscription registry.
- **Correlation**: `inResponseTo` echoes the originating [`subscribe`](#subscribe)'s `id`.
- **Owner**: [`apps/server/src/ws/handlers/subscribe.ts`](../apps/server/src/ws/handlers/subscribe.ts).

```json
{ "type": "subscribed", "id": "…", "inResponseTo": "…", "payload": { "sessionId": "…" } }
```

The payload echoes `sessionId` for human debuggability; `inResponseTo` is the authoritative correlation field.

### `unsubscribed`

- **Direction**: S→C ack OR server-initiated push.
- **Payload schema**: `unsubscribedPayloadSchema` — `{ sessionId, reason?: 'privacy-flipped' }`. The `reason` field is optional; when present, the frame was emitted unsolicited by the server (not in response to a client request).
- **When (client-acked path)**: after the server removes the tuple in response to a client [`unsubscribe`](#unsubscribe). Always fires on that path, even when no subscription existed. `inResponseTo` echoes the originating request's `id`; `reason` is absent.
- **When (server-initiated path)**: the server has determined the recipient must lose their subscription stream — today, only when `PATCH /sessions/:id/privacy` flips the session to `'private'` and the recipient is no longer visible to the session per `canSeeSession`. `inResponseTo` is absent; `reason` is `'privacy-flipped'`. The pruner removes the registry entry too, so subsequent broadcasts won't reach the recipient. See [`privacy_flip_subscription_prune.md`](../tasks/refinements/backend-hardening/privacy_flip_subscription_prune.md) (closes `docs/security/m3-review/coverage.md` G-001).
- **Correlation**: `inResponseTo` echoes the originating [`unsubscribe`](#unsubscribe)'s `id` on the client-acked path; absent on the server-initiated path.
- **Owner**: [`apps/server/src/ws/handlers/subscribe.ts`](../apps/server/src/ws/handlers/subscribe.ts) (ack path); [`apps/server/src/ws/subscriptions.ts`](../apps/server/src/ws/subscriptions.ts)'s `pruneSubscribersForPrivateSession` (server-initiated path).

```jsonc
// Client-acked: in response to a client `unsubscribe`.
{ "type": "unsubscribed", "id": "…", "inResponseTo": "…", "payload": { "sessionId": "…" } }

// Server-initiated: the session went private and the recipient cannot see it anymore.
{ "type": "unsubscribed", "id": "…", "payload": { "sessionId": "…", "reason": "privacy-flipped" } }
```

The `reason` enum (`unsubscribedReasons` in [`packages/shared-types/src/ws-envelope.ts`](../packages/shared-types/src/ws-envelope.ts)) is deliberately closed; future server-initiated paths (e.g. `user_soft_delete_ws_close`, G-003) will extend the enum with additional values rather than minting new envelope types.

### `proposed`

- **Direction**: S→C ack.
- **Payload schema**: `proposedPayloadSchema` — `{ sessionId, sequence, eventId }`.
- **When**: after a successful `propose`, sent inline on the proposer's socket. The matching [`event-applied`](#event-applied) broadcast carries the full event verbatim (proposer + every other subscriber receives it).
- **Correlation**: `inResponseTo` echoes the originating [`propose`](#propose)'s `id`.
- **Owner**: [`apps/server/src/ws/handlers/propose.ts`](../apps/server/src/ws/handlers/propose.ts).

```json
{ "type": "proposed", "id": "…", "inResponseTo": "…",
  "payload": { "sessionId": "…", "sequence": 13, "eventId": "…" } }
```

### `voted`

- **Direction**: S→C ack.
- **Payload schema**: `votedPayloadSchema` — `{ sessionId, sequence, eventId }`.
- **When**: after a successful `vote`, sent on the voter's socket alongside the [`event-applied`](#event-applied) broadcast.
- **Correlation**: `inResponseTo` echoes the originating [`vote`](#vote)'s `id`.
- **Owner**: [`apps/server/src/ws/handlers/vote.ts`](../apps/server/src/ws/handlers/vote.ts).

```json
{ "type": "voted", "id": "…", "inResponseTo": "…",
  "payload": { "sessionId": "…", "sequence": 14, "eventId": "…" } }
```

### `committed`

- **Direction**: S→C ack.
- **Payload schema**: `committedPayloadSchema` — `{ sessionId, sequence, eventId }`.
- **When**: after a successful `commit`, sent on the moderator's socket alongside the [`event-applied`](#event-applied) broadcast.
- **Correlation**: `inResponseTo` echoes the originating [`commit`](#commit)'s `id`.
- **Owner**: [`apps/server/src/ws/handlers/commit.ts`](../apps/server/src/ws/handlers/commit.ts).

```json
{ "type": "committed", "id": "…", "inResponseTo": "…",
  "payload": { "sessionId": "…", "sequence": 15, "eventId": "…" } }
```

### `meta-disagreement-marked`

- **Direction**: S→C ack.
- **Payload schema**: `metaDisagreementMarkedAckPayloadSchema` — `{ sessionId, sequence, eventId }`.
- **When**: after a successful `mark-meta-disagreement`, sent on the moderator's socket alongside the [`event-applied`](#event-applied) broadcast.
- **Correlation**: `inResponseTo` echoes the originating [`mark-meta-disagreement`](#mark-meta-disagreement)'s `id`.
- **Owner**: [`apps/server/src/ws/handlers/meta-disagreement.ts`](../apps/server/src/ws/handlers/meta-disagreement.ts).

```json
{ "type": "meta-disagreement-marked", "id": "…", "inResponseTo": "…",
  "payload": { "sessionId": "…", "sequence": 16, "eventId": "…" } }
```

### `snapshot-state`

- **Direction**: S→C response.
- **Payload schema**: `snapshotStatePayloadSchema` — `{ sessionId, sequence, projection: unknown }`.
- **When**: in response to a [`snapshot`](#snapshot) request, OR as the snapshot-fallback path of a [`catch-up`](#catch-up).
- **Correlation**: `inResponseTo` echoes the originating request's `id` (either `snapshot` or `catch-up`).
- **Owner**: [`apps/server/src/ws/handlers/snapshot.ts`](../apps/server/src/ws/handlers/snapshot.ts) (the construction surface `serializeProjectionForWire` is reused by `catch-up.ts`).

```json
{ "type": "snapshot-state", "id": "…", "inResponseTo": "…",
  "payload": { "sessionId": "…", "sequence": 17, "projection": { … } } }
```

`projection` is typed `z.unknown()` at the wire schema; the structural shape mirrors `apps/server/src/projection/types.ts` (`sessionState`, `lastAppliedSequence`, `participants`, `nodes`, `edges`, `annotations`, `pendingProposals`, `committedProposals`, `snapshots`, `unresolvedMetaDisagreements`). The construction surface in `serializeProjectionForWire` is the type-checked seam. Receivers apply subsequent `event-applied` broadcasts at `sequence > snapshot.sequence` as deltas; broadcasts at `sequence <= snapshot.sequence` are no-ops (already reflected). See [`ws_snapshot_message.md`](../tasks/refinements/backend/ws_snapshot_message.md).

### `caught-up`

- **Direction**: S→C ack.
- **Payload schema**: `caughtUpPayloadSchema` — `{ sessionId, throughSequence, eventCount, fromSnapshot }`.
- **When**: emitted as the final frame of every [`catch-up`](#catch-up) flow.
- **Correlation**: `inResponseTo` echoes the originating `catch-up`'s `id`.
- **Owner**: [`apps/server/src/ws/handlers/catch-up.ts`](../apps/server/src/ws/handlers/catch-up.ts).

```json
{ "type": "caught-up", "id": "…", "inResponseTo": "…",
  "payload": { "sessionId": "…", "throughSequence": 17,
               "eventCount": 4, "fromSnapshot": false } }
```

`throughSequence` is the boundary: any `event-applied` with `sequence <= throughSequence` is part of the replay; anything `>` is live. `fromSnapshot: true` indicates the snapshot-fallback path ran (and `eventCount` will be `0`).

### `proposal-withdrawn`

- **Direction**: S→C ack.
- **Payload schema**: `proposalWithdrawnPayloadSchema` — `{ sessionId, proposalEventId, removedEventCount }`.
- **When**: after a successful [`withdraw-proposal`](#withdraw-proposal), sent on the proposer's socket alongside zero or more matching [`event-applied`](#event-applied) broadcasts (one per emitted `entity-removed` event).
- **Correlation**: `inResponseTo` echoes the originating [`withdraw-proposal`](#withdraw-proposal)'s `id`. `removedEventCount` is informational so the client can pair the ack against the matching broadcasts without polling — zero for sub-kinds that introduced no entities at propose-time; one for free-floating `classify-node` today (the per-sub-kind mapping grows in lockstep with the propose-time emission tech-debt — see [ADR 0027](adr/0027-entity-and-facet-layers-strict-separation.md)).
- **Owner**: [`apps/server/src/ws/handlers/withdraw.ts`](../apps/server/src/ws/handlers/withdraw.ts).

```json
{ "type": "proposal-withdrawn", "id": "…", "inResponseTo": "…",
  "payload": { "sessionId": "…", "proposalEventId": "…", "removedEventCount": 1 } }
```

### `agreement-withdrawn`

- **Direction**: S→C ack.
- **Payload schema**: `agreementWithdrawnPayloadSchema` — `{ sessionId, sequence, eventId }`.
- **When**: after a successful [`withdraw-agreement`](#withdraw-agreement), sent on the participant's socket alongside the matching [`event-applied`](#event-applied) broadcast carrying the appended `withdraw-agreement` event.
- **Correlation**: `inResponseTo` echoes the originating [`withdraw-agreement`](#withdraw-agreement)'s `id`.
- **Owner**: [`apps/server/src/ws/handlers/withdraw-agreement.ts`](../apps/server/src/ws/handlers/withdraw-agreement.ts).

```json
{ "type": "agreement-withdrawn", "id": "…", "inResponseTo": "…",
  "payload": { "sessionId": "…", "sequence": 18, "eventId": "…" } }
```

### `event-applied`

- **Direction**: S→C unsolicited.
- **Payload schema**: `eventAppliedPayloadSchema` — `{ event: Event }` (the appended event verbatim — same shape `packages/shared-types/src/events.ts` owns).
- **When**: emitted by the [broadcast surface](#broadcasts--ordering-invariants) AFTER a `session_events` INSERT commits, for every WS connection subscribed to the event's session. Also emitted (per-frame, on the requesting socket only) by the [`catch-up`](#catch-up) handler's slice-replay path.
- **Correlation**: server-minted `id`; no `inResponseTo` (broadcasts are unsolicited; replay frames are addressed to the catch-up requester but the per-frame `inResponseTo` is absent — the [`caught-up`](#caught-up) ack is the correlated frame).
- **Owner**: [`apps/server/src/ws/broadcast/event-applied.ts`](../apps/server/src/ws/broadcast/event-applied.ts) (live broadcast); [`apps/server/src/ws/handlers/catch-up.ts`](../apps/server/src/ws/handlers/catch-up.ts) (replay frames).

```json
{ "type": "event-applied", "id": "…",
  "payload": { "event": { "id": "…", "sessionId": "…", "sequence": 13,
                          "kind": "proposal", "actor": "…",
                          "payload": { … }, "createdAt": "…" } } }
```

Clients MUST dedupe by `event.sequence` (handles replay-vs-live overlap during catch-up). See [Broadcasts + ordering invariants](#broadcasts--ordering-invariants) and [`ws_event_broadcast.md`](../tasks/refinements/backend/ws_event_broadcast.md).

The wrapped `event.kind` discriminator is one of the values registered in [`packages/shared-types/src/events.ts`](../packages/shared-types/src/events.ts) (`eventKinds`); the per-kind payload schema lives in the same module's `eventPayloadSchemas` registry. Each `Event` envelope mirrors the canonical [SQL CHECK constraint](../apps/server/migrations/0010_session_events.sql) on the `session_events` table; widening the `kind` enum requires a forward-only migration ([ADR 0020](adr/0020-postgres-write-path-locking-and-event-ordering.md)) + a per-kind ADR. Notable additions beyond the v1 baseline:

- `'entity-removed'` — emitted by the [`withdraw-proposal`](#withdraw-proposal) handler per [ADR 0027](adr/0027-entity-and-facet-layers-strict-separation.md); one per entity the propose-time fan-out minted. Payload: `{ entity_kind: 'node' | 'edge' | 'annotation', entity_id, removed_by, removed_at }`.
- `'session-mode-changed'` — emitted by the host-only `POST /api/sessions/:id/start` HTTP endpoint per [ADR 0028](adr/0028-session-mode-changed-wire-event.md) when the moderator advances the session from `'lobby'` into `'operate'`. Payload: `{ previous_mode: 'lobby' | 'operate', new_mode: 'lobby' | 'operate', changed_by, changed_at }`. The participant lobby's auto-navigation `useEffect` consumes this event as its primary trigger for the lobby → operate handoff; the predecessor's first-content-event heuristic is retained as a defense-in-depth fallback (Decision §7 of [`part_session_start_handoff_dedicated_event.md`](../tasks/refinements/participant-ui/part_session_start_handoff_dedicated_event.md)).

### `proposal-status`

- **Direction**: S→C unsolicited (derived).
- **Payload schema**: `proposalStatusPayloadSchema` — `{ sessionId, proposalId, sequence, perFacetStatus: Record<FacetName, FacetStatus> }`.
- **When**: emitted by the derived broadcast subscriber AFTER the corresponding [`event-applied`](#event-applied) for any event kind in `{ proposal, vote, commit, meta-disagreement-marked }` that targets a facet-bearing proposal sub-kind. Structural sub-kinds (`axiom-mark`, `decompose`, `interpretive-split`, `meta-move`, `break-edge`, `amend-node`, `annotate`) do NOT produce a `proposal-status` frame.
- **Correlation**: server-minted `id`; no `inResponseTo`.
- **Owner**: [`apps/server/src/ws/broadcast/proposal-status.ts`](../apps/server/src/ws/broadcast/proposal-status.ts).

```json
{ "type": "proposal-status", "id": "…",
  "payload": { "sessionId": "…", "proposalId": "…", "sequence": 13,
               "perFacetStatus": { "substance": "proposed" } } }
```

`FacetName` is `'classification' | 'substance' | 'wording'`; `FacetStatus` is `'proposed' | 'agreed' | 'disputed' | 'committed' | 'withdrawn' | 'meta-disagreement'`. Only the facets the affected proposal targets appear. See [`ws_proposal_status_broadcast.md`](../tasks/refinements/backend/ws_proposal_status_broadcast.md).

### `diagnostic`

- **Direction**: S→C unsolicited (derived).
- **Payload schema**: `diagnosticPayloadSchema` — `{ sessionId, kind, severity, status, sequence, diagnostic: unknown }`.
- **When**: emitted by the diagnostic broadcast subscriber when a structural diagnostic fires or clears for a session — fanned out from the projection cache via `WsDiagnosticBroadcast.notifyForSession(sessionId, sequence, prev, next)` after `applyEvent` re-computes the diagnostic snapshot.
- **Correlation**: server-minted `id`; no `inResponseTo`.
- **Owner**: [`apps/server/src/ws/broadcast/diagnostic.ts`](../apps/server/src/ws/broadcast/diagnostic.ts).

```json
{ "type": "diagnostic", "id": "…",
  "payload": { "sessionId": "…", "kind": "cycle", "severity": "blocking",
               "status": "fired", "sequence": 18, "diagnostic": { … } } }
```

Closed enums: `kind ∈ { cycle, contradiction, multi-warrant, dangling-claim, coherency-hint }`; `severity ∈ { blocking, advisory }`; `status ∈ { fired, cleared }`. The inner `diagnostic` field carries the full `DiagnosticEntry` from `apps/server/src/diagnostics/event-emission.ts` verbatim. See [`ws_diagnostic_broadcast.md`](../tasks/refinements/backend/ws_diagnostic_broadcast.md).

### `error`

- **Direction**: S→C unsolicited or response.
- **Payload schema**: `errorPayloadSchema` — `{ code: string, message: string, details?: Record<string, unknown> }`. Mirrors HTTP `ApiError` body minus the status code.
- **When**: any time a client request fails (visibility, gate, engine rejection) or the server cannot process an inbound frame.
- **Correlation**: `inResponseTo` is **present** when the error responds to a specific client envelope (dispatcher seams echo the originating `id`; the subscribe handler's visibility rejection echoes the originating `subscribe.id`). **Absent** for `malformed-envelope` (the inbound frame failed to parse; the server cannot read an `id` off it).
- **Owner**: [`apps/server/src/ws/error-envelope.ts`](../apps/server/src/ws/error-envelope.ts) (`buildWsErrorEnvelope` + `sendWsError`).

```json
{ "type": "error", "id": "…", "inResponseTo": "…",
  "payload": { "code": "not-found", "message": "session not found" } }
```

See [Error envelope reference](#error-envelope-reference) and [`ws_error_message.md`](../tasks/refinements/backend/ws_error_message.md). The connection STAYS OPEN on every error path — per-frame failures are recoverable.

## Handler gate stack

Every C→S request (everything in Group B of the catalog) passes through a four-layer authority stack before reaching the methodology engine. Failure at any layer produces an [`error`](#error) envelope with the layer-specific `code`; the connection stays open.

1. **Connection authenticated**. Enforced by the `preValidation` hook on `GET /ws` BEFORE the handshake completes — every dispatcher invocation observes a non-undefined `connection.user`. A wiring bug that somehow let an unauthenticated upgrade through surfaces server-side as a generic `internal-error` via the dispatcher's `onHandlerError` no-leak fallback (the handler asserts `user !== undefined` and throws). Wire code on bypass: `internal-error`. See [`ws_auth_on_connect.md`](../tasks/refinements/backend/ws_auth_on_connect.md).
2. **Subscribed to session**. Every C→S request other than `subscribe` / `unsubscribe` requires `(connection, session)` to be in the [`WsSubscriptionRegistry`](../apps/server/src/ws/subscriptions.ts). Failure: `code: 'forbidden'` with `message: 'not subscribed to this session — send a subscribe envelope first'`. Subscribed-before-act is a uniform protocol-layer invariant — even read-only requests (`snapshot`, `catch-up`) are gated. See [`ws_subscribe_to_session.md`](../tasks/refinements/backend/ws_subscribe_to_session.md).
3. **Session visible**. Re-checked via `canSeeSession(pool, sessionId, userId)` even though `subscribe` already checked — visibility can change between subscribe and act. Failure: `code: 'not-found'` (NOT `forbidden`) per the existence-non-leak rule. The `subscribe` handler runs this check FIRST (before any registry write).
4. **Engine validation**. Inside the same transaction as the event append (per-session `FOR UPDATE` on `sessions`, MAX(sequence) read, optimistic-concurrency check, projection replay, `validateAction`). Failure routes through `rejectedToApiError(rejection)` so the wire `code` is the methodology engine's `RejectionReason` verbatim. See [Error envelope reference](#error-envelope-reference). Read-only handlers (`snapshot`, `catch-up`) skip step 4 entirely.

The connection-handler also has two pre-dispatch layers worth noting:

- **Envelope parse**. `parseWsEnvelopeJson` on every inbound frame. Failure: `code: 'malformed-envelope'`, no `inResponseTo`. The connection stays open. See [Error envelope reference](#error-envelope-reference).
- **Known message type**. The dispatcher's `onUnknownType` seam fires when an envelope's `type` is in the closed enum but no handler is registered (a deferred type, not a runtime bug). Failure: `code: 'unknown-message-type'`, `inResponseTo: <envelope.id>`.

## Error envelope reference

Every error rides the [`error`](#error) envelope. The `code` discriminator is the typed branch clients switch on. The vocabulary spans three sources:

### HTTP `ApiError` codes (kebab-case)

From [`apps/server/src/errors.ts`](../apps/server/src/errors.ts). Every code here is identical to the HTTP envelope's `error.code` value — a client that handles both transports through one dispatch layer gets one branch table.

| code | meaning | typical cause on the WS surface |
|------|---------|-----|
| `bad-request` | 400 — malformed at the transport/shape level. | Reserved for future use (envelope-level parse failures use `malformed-envelope`). |
| `unauthorized` | 401 — caller is not authenticated. | Pre-handshake reject (renders as HTTP 401 envelope, not a WS frame; the WS handshake never completes). |
| `forbidden` | 403 — authenticated but lacks the role / relationship. | Subscribe-before-act gate failure (every C→S request other than subscribe/unsubscribe). |
| `not-found` | 404 — referenced entity not found OR not visible. | `subscribe` to invisible session; visibility re-check failure on any write or read handler. |
| `conflict` | 409 — conflicts with current state. | Generic conflict (rare on the WS surface — most write conflicts surface as `sequence-mismatch`, which is a `RejectionReason`). |
| `unprocessable-entity` | 422 — well-formed but state forbids. | Generic 422 (rare — most state rejections are typed `RejectionReason` codes). |
| `internal-error` | 500 — server bug or non-`ApiError` throw. | Dispatcher's `onHandlerError` no-leak fallback for non-`ApiError` thrown values. The literal message is `'internal error'`; the underlying error is logged server-side only. |

### WS-specific codes

Codes that are not in the HTTP taxonomy because they describe transport-level failures unique to the WS surface.

| code | meaning |
|------|---------|
| `unknown-message-type` | The envelope's `type` is in the closed `WsMessageType` enum but no handler is registered. Emitted by the dispatcher's `onUnknownType` seam. |
| `malformed-envelope` | The inbound frame failed `parseWsEnvelopeJson` (bad JSON, binary frame that's not UTF-8 JSON, or schema-invalid envelope/payload). Emitted by the receive loop in [`connection.ts`](../apps/server/src/ws/connection.ts). `inResponseTo` is absent — the server cannot read an `id` off a frame that failed to parse. The connection stays open. |
| `too-many-subscriptions` | The connection has already subscribed to `MAX_SUBSCRIPTIONS_PER_CONNECTION` sessions (default 32, env-tunable via `WS_MAX_SUBSCRIPTIONS_PER_CONNECTION`) and is trying to add another. Re-subscribing to a session the connection already holds is idempotent (no error). `inResponseTo` correlates back to the originating `subscribe` envelope's `id`. Wire message intentionally carries no integers — the cap value is not leaked. Closes [`docs/security/m3-review/inputs.md`](security/m3-review/inputs.md) F-001. |
| `too-many-catch-up-requests` | The per-connection [`catch-up`](#catch-up) rate limit (default 10 envelopes per 60 s, env-overridable via `WS_CATCH_UP_MAX_PER_MINUTE`) rejected this envelope. Emitted by `apps/server/src/ws/handlers/catch-up.ts` as Gate 0; the connection stays open and the cap window self-resets after 60 s. Closes [`docs/security/m3-review/inputs.md`](security/m3-review/inputs.md) F-004. |

The constants are exported from [`error-envelope.ts`](../apps/server/src/ws/error-envelope.ts) as `WS_UNKNOWN_MESSAGE_TYPE_CODE` / `WS_MALFORMED_ENVELOPE_CODE`, from [`subscriptions.ts`](../apps/server/src/ws/subscriptions.ts) as `WS_TOO_MANY_SUBSCRIPTIONS_CODE`, and from [`handlers/catch-up.ts`](../apps/server/src/ws/handlers/catch-up.ts) as `WS_TOO_MANY_CATCH_UP_REQUESTS_CODE` for test + handler co-location.

### Methodology `RejectionReason` codes

From [`apps/server/src/methodology/types.ts`](../apps/server/src/methodology/types.ts). `rejectedToApiError(rejection)` maps each to an `ApiError` whose `code` is the rejection's `reason` verbatim, and the WS surface inherits the kebab string directly.

| code | group | typical handler |
|------|---|---|
| `not-a-participant` | universal | every C→S write |
| `sequence-mismatch` | universal (optimistic concurrency) | propose / vote / commit / mark-meta-disagreement |
| `session-mismatch` | universal | every C→S write |
| `not-a-moderator` | role-gated | commit / mark-meta-disagreement |
| `proposal-not-found` | proposal-reference | vote / commit / mark-meta-disagreement |
| `proposal-not-pending` | proposal-reference | vote |
| `proposal-already-committed` | proposal-reference | vote / commit / mark-meta-disagreement |
| `proposal-already-meta-disagreement` | proposal-reference | vote / commit / mark-meta-disagreement |
| `target-entity-not-found` | entity-reference | propose (sub-kinds that target an existing entity) |
| `already-voted` | vote-specific | vote |
| `no-prior-agree` | vote-specific | vote (`withdraw` arm) |
| `self-vote-not-allowed` | vote-specific | vote |
| `unanimous-agree-required` | vote-specific | commit |
| `axiom-mark-not-self` | propose-axiom-mark | propose (axiom-mark sub-kind) |
| `inapplicable-to-facet` | methodology-flow | propose / vote |
| `illegal-state-transition` | methodology-flow | commit / mark-meta-disagreement (structural sub-kinds) |
| `methodology-not-exhausted` | methodology-flow | commit / mark-meta-disagreement |
| `role-already-filled` | participant-assignment (HTTP, listed for completeness) | — |
| `user-already-joined` | participant-assignment (HTTP) | — |
| `user-not-found` | participant-assignment (HTTP) | — |
| `cannot-remove-moderator` | participant-assignment (HTTP) | — |
| `entity-not-referenceable` | entity-inclusion (HTTP) | — |
| `entity-already-included` | entity-inclusion (HTTP) | — |

The last six (`role-already-filled`, `user-already-joined`, `user-not-found`, `cannot-remove-moderator`, `entity-not-referenceable`, `entity-already-included`) are owned by HTTP endpoints; they appear in the `RejectionReason` union because the engine's mapper covers every reason, but no WS handler emits them today. They ride the wire envelope's `code` field through the same `rejectedToApiError` adapter if a future WS handler reaches for them.

The `code` field on the wire payload is typed `z.string().min(1)`, not a closed enum, because the `RejectionReason` union keeps widening as new methodology rules land. The discipline (every code is kebab-case + matches one of the three sets above) is enforced by the construction surface (`buildWsErrorEnvelope` accepts a `string` and callers reach for the documented values) and by [`apps/server/src/ws/protocol-docs.test.ts`](../apps/server/src/ws/protocol-docs.test.ts), which pins the audit invariant against doc-vs-code drift.

## Broadcasts + ordering invariants

Three server-emitted broadcast surfaces, all riding the same fan-out infrastructure:

- [`event-applied`](#event-applied) — primary broadcast; one envelope per appended `session_events` row, fanned out to every connection in `connectionsForSession(sessionId)`.
- [`proposal-status`](#proposal-status) — derived broadcast; one envelope per facet-targeting proposal-affecting event (`proposal` / `vote` / `commit` / `meta-disagreement-marked` on a facet-bearing sub-kind). Skipped for structural sub-kinds.
- [`diagnostic`](#diagnostic) — derived broadcast; one envelope per `DiagnosticEntry` `fired` / `cleared` delta.

### Post-commit-emit rule

The route's transaction allocates the sequence, validates the event, and INSERTs. AFTER the transaction's COMMIT, the route calls `app.wsBroadcast.emit({ event })`. Emitting before commit would let subscribers fan out a frame the DB later rolls back; the post-commit-emit invariant is what guarantees subscribed clients only ever see committed events. See [`broadcast/bus.ts`](../apps/server/src/ws/broadcast/bus.ts) and [`ws_event_broadcast.md`](../tasks/refinements/backend/ws_event_broadcast.md).

### Per-session FIFO ordering

Inside a session, every subscribed connection observes `event-applied` envelopes in strict per-session sequence order:

1. The session's transactional writes are serialised by `FOR UPDATE` on the `sessions` row ([ADR 0020](adr/0020-migrations-node-pg-migrate-forward-only.md)).
2. The bus dispatches synchronously to listeners in registration order; one bus emit produces a synchronous fan-out to every subscribed connection's sender.
3. The underlying `ws.WebSocket.send` queues frames in invocation order.

Cross-session ordering is NOT guaranteed — subscribers care about their own session's stream.

### Synchronous-bus event-applied-before-derived rule

The `WsBroadcastBus` dispatches synchronously to listeners in registration order. `wsEventAppliedBroadcastPlugin` registers first; `wsProposalStatusBroadcastPlugin` and `wsDiagnosticBroadcastPlugin` register after (composed via `server.ts` / `__buildTestWsApp`). Therefore, for any given event:

- The `event-applied` listener completes its synchronous fan-out (every subscribed connection has the frame queued on its socket) BEFORE the derived listeners run.
- The `proposal-status` listener kicks off an async tail (DB load + projection replay) that resolves after the synchronous prefix returns — the actual `proposal-status` frame reaches the wire after `event-applied`.
- The `diagnostic` listener runs synchronously off the `DiagnosticBus`, but `WsDiagnosticBroadcast.notifyForSession` is called by the projection-cache wiring AFTER the `event-applied` bus emit completes — so receivers see `event-applied(N)` before any `diagnostic` envelope derived from the post-N projection.

Within the dual-signal contract of a write request (e.g. [`propose`](#propose)): the handler emits the `event-applied` broadcast first, then sends the ack ([`proposed`](#proposed) / etc.) on the proposer's socket. Both frames reach the wire in fast succession; the proposer's client may observe them in either order depending on socket-buffer flush timing. Clients MUST handle them as independent signals correlated by `event.sequence` + `proposed.sequence` carrying the same value.

### In-process / per-instance fan-out

The subscription registry, the connection-sender registry, and the broadcast bus are all per-`createServer()` instance. Multi-instance fan-out is **out of scope for v1** — see [Future / out-of-scope](#future--out-of-scope).

### Per-connection error isolation

Each broadcast surface wraps the per-connection `send` in a try/catch. A failed send logs at warn level (`{ err, connectionId, sessionId, messageId, … }`) and CONTINUES the iteration. One bad socket cannot suppress the fan-out to other subscribers. The same invariant applies to the dispatcher's `onUnknownType` / `onHandlerError` seams — a torn-down socket that throws on `send` is logged and ignored; the receive loop keeps reading.

## Reconnection / catch-up flow

Reconnection is orchestrated by the client; the server provides four primitives ([`subscribe`](#subscribe), [`snapshot`](#snapshot), [`catch-up`](#catch-up), and the live [`event-applied`](#event-applied) stream) the client composes.

### Typical sequence after a disconnect

```
client                                                  server
------                                                  ------
new WebSocket('/ws')  (cookie sent on upgrade)  --->    [auth gate: 401 if cookie invalid]
                                                <---    [accept; emit `hello`]
{ type: 'subscribe', payload: { sessionId } }   --->    [visibility check; registry.subscribe]
                                                <---    { type: 'subscribed', inResponseTo }
{ type: 'catch-up',
  payload: { sessionId, sinceSequence: N } }    --->    [slice or snapshot path]
                                                <---    [stream of `event-applied` frames OR
                                                         one `snapshot-state` frame]
                                                <---    { type: 'caught-up', inResponseTo,
                                                          throughSequence, eventCount,
                                                          fromSnapshot }
                                                <---    [live `event-applied` deltas resume]
```

- Repeat the `subscribe` + `catch-up` pair for each session the client was previously tracking.
- The client supplies `sinceSequence` from its local high-water mark — the server does NOT track a per-connection `lastSentSequence`.

### Slice replay vs. snapshot fallback

The catch-up handler compares `currentMaxSequence - sinceSequence` to the threshold `WS_CATCHUP_MAX_EVENTS`:

- **Gap ≤ threshold** (default 500): the handler SELECTs `(sinceSequence, currentMaxSequence]` from `session_events`, emits one [`event-applied`](#event-applied) frame per row on the requesting socket, and closes with [`caught-up`](#caught-up) `{ fromSnapshot: false, eventCount: N }`.
- **Gap > threshold**: the handler builds the projection via `projectFromLog` (same primitive the [`snapshot`](#snapshot) handler uses) and sends one [`snapshot-state`](#snapshot-state) frame, then [`caught-up`](#caught-up) `{ fromSnapshot: true, eventCount: 0 }`.
- **Gap = 0** (client at head): single [`caught-up`](#caught-up) ack, `eventCount: 0`, `fromSnapshot: false`.
- **`sinceSequence > currentMaxSequence`** (client ahead — defensive): single `caught-up` ack, `throughSequence: currentMaxSequence`, `eventCount: 0`. Server logs a warn but does NOT error.

The threshold is read from `process.env.WS_CATCHUP_MAX_EVENTS` once at registration time via `resolveCatchUpMaxEvents(env)` (default 500, hard-capped at `MAX_CATCH_UP_EVENTS_CEILING = 5000` per [F-005](security/m3-review/inputs.md)). Tests inject small values directly via handler options to exercise both branches deterministically. Both SELECTs carry an explicit `LIMIT` equal to the resolved threshold, and a per-connection rate limit caps `catch-up` envelopes at 10/min by default (env-overridable via `WS_CATCH_UP_MAX_PER_MINUTE`; closes [F-004](security/m3-review/inputs.md)). See [`ws_reconnection_handling.md`](../tasks/refinements/backend/ws_reconnection_handling.md) and [`catch_up_event_limit.md`](../tasks/refinements/backend-hardening/catch_up_event_limit.md).

### Client-side dedup contract

Clients MUST dedupe [`event-applied`](#event-applied) frames by `event.sequence`. The catch-up handler reads its slice synchronously, but the bus may dispatch a NEW live `event-applied` between the SELECT and the per-frame send. Receivers handle both inputs through one reducer keyed by `event.sequence`; the `caught-up` ack's `throughSequence` is the boundary marker for "replay done; everything after is live."

## Future / out-of-scope

Deliberately deferred. Out of scope for v1; the protocol's shape leaves room to add each without breaking existing clients.

- **Labeled-checkpoint snapshots (Interpretation B of `ws_snapshot_message`)**. Today's `snapshot` envelope is a pure state-query (Interpretation A). The methodology engine does not yet have a snapshot-create handler; once it does, a separate sibling task introduces the wire vocabulary for creating named checkpoints. The current schema's `{ sessionId }` shape is forward-compatible: a future widening to add `at: <sequence>` or `label: <string>` is backward-compatible per Zod's default-strip behaviour. See [`ws_snapshot_message.md`](../tasks/refinements/backend/ws_snapshot_message.md) Decisions.
- **Multi-instance fan-out / clustering**. The `WsSubscriptionRegistry`, the `WsConnectionSenderRegistry`, and the `WsBroadcastBus` are all per-app-instance. A horizontally-scaled deployment (multiple `apps/server` instances behind a load-balancer) would NOT see broadcasts emitted on one instance reach subscribers on another. Two future paths recover the property:
  1. The reconnection flow lets a client re-attach to any instance and replay state from the data model; the new instance reconstructs the subscription locally.
  2. A future cluster-fanout layer would publish broadcasts to a message bus every instance subscribes to. The registry's shape doesn't change; the broadcast surface does. See [`ws_subscribe_to_session.md`](../tasks/refinements/backend/ws_subscribe_to_session.md) Decisions.
- **Client retry / backoff / re-auth / re-subscribe orchestration**. The server endpoint is described above. The client-side state machine (when to retry, backoff curve, when to re-fetch a snapshot vs. catch-up, how to surface a "connection lost" UI signal) is owned by the participant / moderator / audience workspaces in future tasks. See [`ws_reconnection_handling.md`](../tasks/refinements/backend/ws_reconnection_handling.md).
- **Historical-point query on `snapshot`**. The `{ sessionId, at: <sequence> }` form for time-travel into a session's state (test-mode scrubbing; audience-surface chapter navigation) is documented as a future extension. The v1 wire schema is `{ sessionId }`-only.
- **Binary wire format**. JSON-text-only today; binary frames are rejected via the [`malformed-envelope`](#error-envelope-reference) path. A future binary message type could be introduced if a profiler shows a real cost; current message sizes don't justify it. See [`ws_message_envelope.md`](../tasks/refinements/backend/ws_message_envelope.md) Decisions.
- **Cross-origin audience surface auth**. The same-origin cookie-on-upgrade contract is what the current `preValidation` hook relies on. Any future cross-origin audience surface MUST carry a different auth primitive (e.g. a short-lived query-string ticket from an authenticated HTTP exchange). See [`ws_auth_on_connect.md`](../tasks/refinements/backend/ws_auth_on_connect.md) for the loud reminder.
