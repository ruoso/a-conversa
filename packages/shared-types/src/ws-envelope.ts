// WebSocket message envelope — cross-workspace contract.
//
// Refinement: tasks/refinements/backend/ws_message_envelope.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_message_envelope
//
// This module defines the canonical envelope shape for every WS message
// that flows between server and client (both directions), the
// per-`type` payload schema registry that downstream message-type tasks
// fill in, and `parseWsEnvelope` / `serializeWsEnvelope` —  the
// two-stage parse + serialize entry points the server's `ws/envelope.ts`
// helpers wrap. Owned here (not in `apps/server`) so the participant /
// moderator / audience apps can import the same schema and types when
// they land.
//
// **Design parallel to `events.ts`.** The event-envelope module
// (`./events.ts`, ADR 0021) settled the discriminated-union + Zod
// pattern for the **persisted event log**. This module mirrors that
// shape for the **WebSocket wire** — same library (Zod), same two-stage
// parse (outer envelope first, per-`type` payload second), same
// registry pattern (`Record<WsMessageType, z.ZodTypeAny>` so adding a
// new type is a compile-time obligation). The two envelopes are
// distinct because a WS message is not always an event (e.g. votes
// before commit, error responses, server-emitted snapshots) and the
// fields each carries differ (`id` + `inResponseTo` for the WS
// envelope; `sessionId` + `sequence` for the event envelope).
//
// **Today's task delivers the building blocks.** The discriminator
// vocabulary is opened with one entry — `hello` — replacing the
// placeholder `{ type: 'hello', connectionId }` the
// `ws_connection_handling` task shipped. Each of the six downstream
// message-type tasks (propose / vote / commit / meta-disagreement /
// snapshot / error) adds its own entry to `wsMessageTypes` and its
// schema to `wsMessagePayloadSchemas`.
//
// **Closed discriminated union.** `wsEnvelopeSchema` is built via the
// two-stage parse (outer + registry) rather than as a single
// `z.discriminatedUnion`. The trade-off matches the event-envelope
// reasoning in ADR 0021: a type-mismatch surfaces at the envelope
// level, a payload-shape error surfaces tagged with the offending type.
// Both forms reject unknown types at runtime; the two-stage form
// produces materially clearer error messages.
//
// **Wire format: JSON.** See the refinement's Decisions section for
// the rationale against msgpack and other binary formats.
//
// **Correlation: `id` is required on every envelope; `inResponseTo` is
// optional.** A client generates a v4 UUID per message; the server
// echoes that id back via `inResponseTo` on the matching response
// (today only the future error-envelope; downstream tasks add ack and
// commit-result envelopes). This lets a client multiplex request /
// response over the single duplex pipe.

import { z } from 'zod';

import {
  eventEnvelopeSchema,
  proposalPayloadSchema,
  type Event,
  type ProposalPayload,
} from './events.js';

// -- Message-type vocabulary ----------------------------------------
//
// The closed list of `type` discriminator values. Each downstream
// message-type task (`ws_propose_message`, `ws_vote_message`,
// `ws_commit_message`, `ws_meta_disagreement_message`,
// `ws_snapshot_message`, `ws_error_message`) extends this list and the
// matching `wsMessagePayloadSchemas` entry.
//
// **Union-extension layout convention** (owned by `ws_propose_message`,
// landed when the second wave of message-type tasks began). The
// vocabulary is organised into three groups so the four remaining
// message-type tasks (`ws_vote_message`, `ws_commit_message`,
// `ws_meta_disagreement_message`, `ws_snapshot_message`) can each
// extend the union by appending to a stable tail rather than editing
// the middle of an array — minimising merge-conflict surface across
// concurrent task branches.
//
//   - **Group B — client → server request types**: `'subscribe'`,
//     `'unsubscribe'`, `'propose'`, `'vote'`, `'commit'`,
//     `'mark-meta-disagreement'`, `'snapshot'`. Future sibling tasks
//     append their request type at this group's tail.
//   - **Group C — server → client ack/result types** correlated via
//     `inResponseTo`: `'subscribed'`, `'unsubscribed'`, `'proposed'`,
//     `'voted'`, `'committed'`, `'meta-disagreement-marked'`,
//     `'snapshot-state'`. Future sibling tasks append their
//     ack/result type at this group's tail.
//   - **Group A — server-emitted unsolicited frames**: `'hello'`,
//     `'event-applied'`, `'error'`. The server originates these;
//     `inResponseTo` is absent on `hello`/`event-applied`, optional on
//     `error` (present when the error responds to a specific client
//     envelope; absent for `'malformed-envelope'`).
//
// Today's enum is laid out in the order the tasks landed (hello first,
// then the subscribe pair, then propose, then broadcast + error). The
// `WsMessagePayloadMap` interface, the `wsMessagePayloadSchemas`
// registry, and the per-payload schemas below follow the same order so
// every place a future task touches stays grouped + appended.
//
// The list is declared `as const` so the `WsMessageType` union narrows
// to the literal-string union. Zod's `z.enum(wsMessageTypes)` checks
// the wire value against this list at parse time.

export const wsMessageTypes = [
  // Group A — server-emitted unsolicited frame (first message every
  // connection sees).
  'hello',
  // Group B — client → server request types. Append future sibling
  // request types (`'snapshot'`) at this group's tail.
  'subscribe',
  'unsubscribe',
  'propose',
  'vote',
  'commit',
  'mark-meta-disagreement',
  'snapshot',
  // Group C — server → client ack / result types correlated via
  // `inResponseTo`. Append future sibling ack/result types at this
  // group's tail.
  'subscribed',
  'unsubscribed',
  'proposed',
  'voted',
  'committed',
  'meta-disagreement-marked',
  'snapshot-state',
  // Group A — server-emitted unsolicited broadcast + the canonical
  // error envelope (which `inResponseTo` echoes when correlated).
  'event-applied',
  'error',
] as const;

export type WsMessageType = (typeof wsMessageTypes)[number];

export const wsMessageTypeSchema = z.enum(wsMessageTypes);

// -- Per-type payload schemas --------------------------------------
//
// `hello` payload owned by this task. Each downstream message-type
// task replaces its own entry in `wsMessagePayloadSchemas`.

/**
 * Server → client first frame on every connection. Replaces the
 * placeholder `{ type: 'hello', connectionId }` that
 * `ws_connection_handling` shipped — the canonical form is now
 * envelope-shaped: `{ type: 'hello', id, payload: { connectionId } }`.
 *
 * The `connectionId` is a v4 UUID stable for the connection's
 * lifetime — used in server logs and (after `ws_subscribe_to_session`
 * lands) as the sender id on broadcasts. NOT a user id; that arrives
 * via `ws_auth_on_connect`'s separate auth handshake.
 */
export const helloPayloadSchema = z.object({
  connectionId: z.string().uuid(),
});

export type HelloPayload = z.infer<typeof helloPayloadSchema>;

// -- subscribe / unsubscribe payloads ------------------------------
//
// `subscribe` / `unsubscribe` (client → server): the client asks the
// server to add (resp. remove) a (connection, session) tuple to the
// per-server-instance subscription registry. The server replies with a
// `subscribed` / `unsubscribed` ack envelope whose `inResponseTo`
// echoes the request envelope's `id` — giving the client a
// deterministic point at which to start counting on the broadcast
// stream (the future `ws_event_broadcast` task ties into this: the
// client is guaranteed that all event broadcasts emitted AFTER the
// `subscribed` ack reach the client over the same socket).
//
// **Owned by `ws_subscribe_to_session`.** Adding `subscribe`,
// `unsubscribe`, `subscribed`, and `unsubscribed` to the closed
// discriminator enum is this task's contribution; the registry +
// handler implementation lives server-side in
// `apps/server/src/ws/subscriptions.ts` and `apps/server/src/ws/handlers/`.

/**
 * Client → server. Asks the server to start streaming events for
 * `sessionId` over this connection. Idempotent on the server side —
 * re-subscribing is a no-op (no error envelope, the ack still fires so
 * the client's request-response correlation is consistent).
 *
 * The server gates this request via the canonical `canSeeSession`
 * predicate (same primitive the HTTP routes use). A client that asks
 * to subscribe to a session they cannot see receives an error envelope
 * (owned by `ws_error_message` — see the placeholder error path in the
 * handler).
 */
export const subscribePayloadSchema = z.object({
  sessionId: z.string().uuid(),
});

export type SubscribePayload = z.infer<typeof subscribePayloadSchema>;

/**
 * Client → server. Asks the server to stop streaming events for
 * `sessionId` over this connection. Idempotent — unsubscribing from a
 * session the client wasn't subscribed to still produces an
 * `unsubscribed` ack (no error). On WS close every still-open
 * subscription is dropped server-side via
 * `WsSubscriptionRegistry.removeConnection` — the client doesn't need
 * to send a flurry of `unsubscribe`s on teardown.
 */
export const unsubscribePayloadSchema = z.object({
  sessionId: z.string().uuid(),
});

export type UnsubscribePayload = z.infer<typeof unsubscribePayloadSchema>;

/**
 * Server → client ack. Echoes the originating `subscribe` envelope's
 * `id` via `inResponseTo` so the client can correlate the ack with
 * its in-flight request and stop waiting. The payload carries the
 * `sessionId` so a client that multiplexes subscriptions over a
 * single socket can route the ack without keeping a request-id table
 * (the `inResponseTo` field is still authoritative — the `sessionId`
 * echo is for human debuggability).
 */
export const subscribedPayloadSchema = z.object({
  sessionId: z.string().uuid(),
});

export type SubscribedPayload = z.infer<typeof subscribedPayloadSchema>;

/**
 * Server → client ack. Same shape as `subscribed` but emitted in
 * response to an `unsubscribe` request.
 */
export const unsubscribedPayloadSchema = z.object({
  sessionId: z.string().uuid(),
});

export type UnsubscribedPayload = z.infer<typeof unsubscribedPayloadSchema>;

// -- propose / proposed payloads -----------------------------------
//
// `propose` (client → server): the client asks the server to apply a
// new `proposal` event for a session it is **subscribed to** (the
// subscribe-before-act gate is enforced on the server). The payload
// carries the canonical `ProposalPayload` discriminated union (the
// same shape that ends up inside the persisted `proposal` event's
// `payload.proposal` field) plus an `expectedSequence` optimistic-
// concurrency token.
//
// **Owned by `ws_propose_message`.** This task adds `propose` to
// Group B and `proposed` to Group C of the union-extension convention
// documented in `wsMessageTypes` above. The four future sibling tasks
// (`ws_vote_message`, `ws_commit_message`,
// `ws_meta_disagreement_message`, `ws_snapshot_message`) follow the
// same shape — a request type in Group B + a matching ack/result type
// in Group C — and the same handler skeleton + dispatcher-seam error
// path.
//
// **`expectedSequence`.** The client's view of the most-recently-
// applied sequence number for this session. The server reads
// `MAX(sequence)` under a `FOR UPDATE` row-lock on `sessions` inside
// the transaction; a mismatch surfaces as a wire `error` envelope
// with `code: 'sequence-mismatch'` (the methodology-engine's
// `RejectionReason` of the same name, mapped to HTTP 409 by the
// shared `rejectedToApiError` helper). The optimistic-concurrency
// token lets a tablet with stale projection state detect the race
// without bouncing through the engine's universal check.

/**
 * Client → server. Asks the server to apply a `proposal` event for
 * `sessionId`. The client must have already sent a successful
 * `subscribe` for the same session (the server enforces); otherwise
 * the wire response is an `error` envelope with `code: 'forbidden'`.
 *
 * On success the server sends two server-emitted envelopes to the
 * proposer:
 *
 *   1. A `proposed` ack (this envelope's request-response pair),
 *      correlated via `inResponseTo`. Carries `{ sessionId,
 *      sequence, eventId }` so the client clears its in-flight
 *      propose state.
 *   2. The standard `event-applied` broadcast (carrying the appended
 *      event verbatim). Every connection in
 *      `connectionsForSession(sessionId)` — including the proposer —
 *      receives this. The broadcast is the projection-update signal;
 *      `proposed` is the request-correlation signal.
 *
 * On any rejection (visibility loss, methodology rejection, sequence
 * mismatch), the server sends an `error` envelope with the
 * corresponding `code` (via the dispatcher's `onHandlerError` seam +
 * `rejectedToApiError(rejection)`).
 */
export const proposePayloadSchema = z.object({
  sessionId: z.string().uuid(),
  expectedSequence: z.number().int().nonnegative(),
  proposal: proposalPayloadSchema,
});

export type ProposePayload = {
  sessionId: string;
  expectedSequence: number;
  proposal: ProposalPayload;
};

/**
 * Server → client ack. Echoes the originating `propose` envelope's
 * `id` via `inResponseTo`. Payload carries the appended event's
 * `sequence` + `eventId` + `sessionId` so the client can correlate
 * the ack against its in-flight propose request and update local
 * sequence tracking before the matching `event-applied` broadcast
 * arrives (the broadcast's `payload.event.sequence` carries the same
 * value; `proposed` arrives slightly earlier on the proposer's
 * socket because the ack is sent inline by the handler whereas the
 * broadcast fires the bus subscriber).
 */
export const proposedPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  sequence: z.number().int().positive(),
  eventId: z.string().uuid(),
});

export type ProposedPayload = z.infer<typeof proposedPayloadSchema>;

// -- vote / voted payloads -----------------------------------------
//
// `vote` (client → server): the client asks the server to apply a new
// `vote` event for a session it is **subscribed to** (the
// subscribe-before-act gate is enforced on the server). The payload
// carries the target `proposalId`, the vote arm (`choice`, one of
// `'agree' | 'dispute' | 'withdraw'`), and the optimistic-concurrency
// token `expectedSequence`.
//
// **Owned by `ws_vote_message`.** This task adds `vote` to Group B and
// `voted` to Group C of the union-extension convention documented in
// `wsMessageTypes` above. Mirrors the propose/proposed shape — the
// handler skeleton + dispatcher-seam error path + dual-signal contract
// are identical (only the engine call and the constructed action
// variant differ).
//
// **Voter identity comes from the connection, not the payload.** The
// server reads `connection.user.id` and uses it as both the
// methodology requester AND the event actor. There is NO `voterId`
// field on the payload — a client cannot vote on behalf of someone
// else. Symmetric with `propose` (no `proposerId` field).
//
// **Withdraw is a vote variant, not a separate message type.** The
// engine's `voteHandler` switches on the vote arm; the wire vocabulary
// stays at one request type + one ack type. Per-arm rejections
// (`no-prior-agree` for an illegal withdraw, `already-voted` for a
// duplicate, `proposal-already-committed` for an agree on a committed
// proposal, etc.) all surface via the wire `error` envelope with
// `payload.code` set to the engine's rejection reason.
//
// **`choice` (request) vs. `vote` (action / event payload).** The
// request payload calls the arm `choice` to avoid the confusingly
// self-referential `{ type: 'vote', payload: { vote: ... } }` shape;
// the handler maps `choice` → `action.vote` → `event.payload.vote` —
// internal naming stays `vote`. See `ws_vote_message.md` Decisions.

/**
 * Client → server. Asks the server to apply a `vote` event for
 * `sessionId` against `proposalId` with the named `choice`. The
 * client must have already sent a successful `subscribe` for the
 * same session (the server enforces); otherwise the wire response is
 * an `error` envelope with `code: 'forbidden'`.
 *
 * On success the server sends two server-emitted envelopes to the
 * voter:
 *
 *   1. A `voted` ack (this envelope's request-response pair),
 *      correlated via `inResponseTo`. Carries `{ sessionId,
 *      sequence, eventId }` so the client clears its in-flight vote
 *      state.
 *   2. The standard `event-applied` broadcast (carrying the
 *      appended event verbatim). Every connection in
 *      `connectionsForSession(sessionId)` — including the voter —
 *      receives this.
 *
 * On any rejection (visibility loss, methodology rejection — e.g.
 * `no-prior-agree`, `already-voted`, `proposal-already-committed` —
 * sequence mismatch), the server sends an `error` envelope with the
 * corresponding `code` via the dispatcher's `onHandlerError` seam +
 * `rejectedToApiError(rejection)`.
 */
// Named `wsVotePayloadSchema` (not `votePayloadSchema`) to avoid a
// collision with `votePayloadSchema` in `./events.ts` (the event-side
// vote payload, with a different shape — `{ proposal_id, participant,
// vote, voted_at }`). The two payloads are intentionally distinct —
// the wire request carries client-facing field names + the optimistic-
// concurrency token; the event payload carries the canonical
// snake-case audit-log shape — but exporting both under the same
// symbol from `@a-conversa/shared-types` would force re-export
// gymnastics in `index.ts`. The `Ws` prefix is the same convention
// `WsEnvelope` and `WsMessageType` use.
export const wsVotePayloadSchema = z.object({
  sessionId: z.string().uuid(),
  expectedSequence: z.number().int().nonnegative(),
  proposalId: z.string().uuid(),
  choice: z.enum(['agree', 'dispute', 'withdraw']),
});

export type WsVotePayload = z.infer<typeof wsVotePayloadSchema>;

/**
 * Server → client ack. Echoes the originating `vote` envelope's `id`
 * via `inResponseTo`. Payload carries the appended event's
 * `sequence` + `eventId` + `sessionId` so the client can correlate
 * the ack against its in-flight vote request and update local
 * sequence tracking before the matching `event-applied` broadcast
 * arrives.
 */
export const votedPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  sequence: z.number().int().positive(),
  eventId: z.string().uuid(),
});

export type VotedPayload = z.infer<typeof votedPayloadSchema>;

// -- commit / committed payloads -----------------------------------
//
// `commit` (client → server): the moderator asks the server to commit
// a pending proposal whose facet has reached unanimous-agree across
// all current participants. The payload carries the target
// `proposalId` and the optimistic-concurrency token `expectedSequence`.
//
// **Owned by `ws_commit_message`.** This task adds `commit` to Group
// B and `committed` to Group C of the union-extension convention
// documented in `wsMessageTypes` above. Mirrors the propose/proposed
// + vote/voted shapes — the handler skeleton + dispatcher-seam error
// path + dual-signal contract are identical (only the engine call
// and the constructed action variant differ).
//
// **Moderator-only authority.** The methodology engine's `commitHandler`
// enforces a `not-a-moderator` rejection when the requester is not the
// session's moderator. The WS handler surfaces this as a wire `error`
// envelope with `code: 'not-a-moderator'` via `rejectedToApiError`
// (status 403 on the HTTP surface; the kebab `code` rides through to
// the wire). The headline gate for this task — a debater who tries to
// commit a proposal receives the typed 403 even though they passed the
// subscribe-before-act gate.
//
// **Moderator identity comes from the connection, not the payload.**
// The server reads `connection.user.id` and uses it as both the
// methodology requester AND the event actor. There is NO `moderatorId`
// field on the payload — a client cannot commit on behalf of someone
// else. Symmetric with `propose` (no `proposerId`) and `vote` (no
// `voterId`).

/**
 * Client → server. Asks the server to commit the pending `proposalId`
 * for `sessionId`. The client must have already sent a successful
 * `subscribe` for the same session (the server enforces); otherwise
 * the wire response is an `error` envelope with `code: 'forbidden'`.
 *
 * The methodology engine enforces moderator-only authority via the
 * `commitHandler`'s rule-1 `not-a-moderator` gate — a non-moderator
 * subscribed participant who sends this envelope receives an `error`
 * envelope with `code: 'not-a-moderator'`. Additional engine
 * rejections (`proposal-not-found` / `proposal-already-committed` /
 * `proposal-already-meta-disagreement` / `unanimous-agree-required`
 * / `methodology-not-exhausted` / `illegal-state-transition` for a
 * structural-sub-kind commit) all surface through the same wire
 * `error` envelope with the engine's kebab `code`.
 *
 * On success the server sends two server-emitted envelopes to the
 * moderator:
 *
 *   1. A `committed` ack (this envelope's request-response pair),
 *      correlated via `inResponseTo`. Carries `{ sessionId,
 *      sequence, eventId }` so the client clears its in-flight
 *      commit state.
 *   2. The standard `event-applied` broadcast (carrying the
 *      appended `commit` event verbatim). Every connection in
 *      `connectionsForSession(sessionId)` — including the moderator —
 *      receives this.
 *
 * The commit handler emits exactly one `commit` event (the engine's
 * `commitHandler` returns `events: [commitEvent]`). The downstream
 * read-side projection (`handleCommit` in `replay.ts`) marks the
 * affected facet `agreed` + moves the proposal from
 * `pendingProposals` to `committedProposals`; that read-side update
 * is driven by every subscriber's local incremental `applyEvent`
 * call on the broadcast — no additional wire frames are required.
 */
export const wsCommitPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  expectedSequence: z.number().int().nonnegative(),
  proposalId: z.string().uuid(),
});

export type WsCommitPayload = z.infer<typeof wsCommitPayloadSchema>;

/**
 * Server → client ack. Echoes the originating `commit` envelope's
 * `id` via `inResponseTo`. Payload carries the appended `commit`
 * event's `sequence` + `eventId` + `sessionId` so the client can
 * correlate the ack against its in-flight commit request and update
 * local sequence tracking before the matching `event-applied`
 * broadcast arrives.
 */
export const committedPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  sequence: z.number().int().positive(),
  eventId: z.string().uuid(),
});

export type CommittedPayload = z.infer<typeof committedPayloadSchema>;

// -- mark-meta-disagreement / meta-disagreement-marked payloads ----
//
// `mark-meta-disagreement` (client → server): the moderator asks the
// server to mark a pending proposal as meta-disagreement — the
// methodology's last-resort terminal state for a facet-level dispute
// the diagnostic tests + decomposition have failed to resolve (per
// `docs/methodology.md` lines 203–212). The payload carries the
// target `proposalId` and the optimistic-concurrency token
// `expectedSequence`.
//
// **Owned by `ws_meta_disagreement_message`.** This task adds
// `mark-meta-disagreement` to Group B and `meta-disagreement-marked`
// to Group C of the union-extension convention documented in
// `wsMessageTypes` above. Mirrors the propose / vote / commit shapes
// — the handler skeleton + dispatcher-seam error path + dual-signal
// contract are identical (only the engine call, the constructed
// action variant, and the ack envelope type differ).
//
// **Moderator-only authority.** The methodology engine's
// `markMetaDisagreementHandler` enforces a `not-a-moderator`
// rejection when the requester is not the session's moderator. The
// WS handler surfaces this as a wire `error` envelope with
// `code: 'not-a-moderator'` via `rejectedToApiError` — same shape as
// commit's headline gate.
//
// **Moderator identity comes from the connection, not the payload.**
// The server reads `connection.user.id` and uses it as both the
// methodology requester AND the event actor. There is NO
// `moderatorId` field on the payload — a client cannot mark on
// behalf of someone else. Symmetric with `propose` (no `proposerId`),
// `vote` (no `voterId`), and `commit` (no `moderatorId`).
//
// **Wire-type naming.** The methodology engine's action kind is
// itself `'mark-meta-disagreement'` (kebab-case throughout the wire
// vocabulary; the engine uses `markMetaDisagreement` camelCase
// internally). The ack `'meta-disagreement-marked'` mirrors the
// `event.kind` of the emitted event (the past-participle convention
// `proposed` / `voted` / `committed` follow).

/**
 * Client → server. Asks the server to mark the pending `proposalId`
 * for `sessionId` as meta-disagreement. The client must have already
 * sent a successful `subscribe` for the same session (the server
 * enforces); otherwise the wire response is an `error` envelope with
 * `code: 'forbidden'`.
 *
 * The methodology engine enforces moderator-only authority via the
 * `markMetaDisagreementHandler`'s rule-1 `not-a-moderator` gate — a
 * non-moderator subscribed participant who sends this envelope
 * receives an `error` envelope with `code: 'not-a-moderator'`.
 * Additional engine rejections (`proposal-not-found` /
 * `proposal-already-committed` /
 * `proposal-already-meta-disagreement` / `methodology-not-exhausted`
 * / `illegal-state-transition` for a structural-sub-kind mark) all
 * surface through the same wire `error` envelope with the engine's
 * kebab `code`.
 *
 * On success the server sends two server-emitted envelopes to the
 * moderator:
 *
 *   1. A `meta-disagreement-marked` ack (this envelope's request-
 *      response pair), correlated via `inResponseTo`. Carries
 *      `{ sessionId, sequence, eventId }` so the client clears its
 *      in-flight mark state.
 *   2. The standard `event-applied` broadcast (carrying the
 *      appended `meta-disagreement-marked` event verbatim). Every
 *      connection in `connectionsForSession(sessionId)` — including
 *      the moderator — receives this.
 *
 * The mark-meta-disagreement handler emits exactly one
 * `meta-disagreement-marked` event (the engine's
 * `markMetaDisagreementHandler` returns `events: [markEvent]`). The
 * downstream read-side projection (`handleMetaDisagreementMarked` in
 * `replay.ts`) transitions the affected facet to status
 * `meta-disagreement` + moves the proposal from `pendingProposals`
 * to `unresolvedMetaDisagreements`; that read-side update is driven
 * by every subscriber's local incremental `applyEvent` call on the
 * broadcast — no additional wire frames are required.
 */
export const wsMarkMetaDisagreementPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  expectedSequence: z.number().int().nonnegative(),
  proposalId: z.string().uuid(),
});

export type WsMarkMetaDisagreementPayload = z.infer<typeof wsMarkMetaDisagreementPayloadSchema>;

/**
 * Server → client ack. Echoes the originating `mark-meta-disagreement`
 * envelope's `id` via `inResponseTo`. Payload carries the appended
 * `meta-disagreement-marked` event's `sequence` + `eventId` +
 * `sessionId` so the client can correlate the ack against its
 * in-flight mark request and update local sequence tracking before
 * the matching `event-applied` broadcast arrives.
 */
export const metaDisagreementMarkedAckPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  sequence: z.number().int().positive(),
  eventId: z.string().uuid(),
});

export type MetaDisagreementMarkedAckPayload = z.infer<
  typeof metaDisagreementMarkedAckPayloadSchema
>;

// -- snapshot / snapshot-state payloads ----------------------------
//
// `snapshot` (client → server): the client asks the server to send
// the current projection state for a session it is **subscribed to**
// (the subscribe-before-act gate is enforced on the server). The
// payload carries only the target `sessionId` — there is NO
// `expectedSequence` (this is a read, not a write) and NO `at: <seq>`
// in v1 (the historical-point query is documented as a future
// extension; the v1 schema does not declare an `at` field, so a
// client that sends one has it silently stripped by Zod's default
// behaviour — when the feature lands, the schema is widened in a
// backward-compatible way).
//
// **Owned by `ws_snapshot_message`.** This task adds `snapshot` to
// Group B and `snapshot-state` to Group C of the union-extension
// convention documented in `wsMessageTypes` above. Unlike its four
// siblings (propose / vote / commit / mark-meta-disagreement) this
// is a **read-only** request — no event-append, no broadcast, no
// transaction. The handler runs the subscribe-before-act gate + the
// visibility re-check + a projection replay-from-log, then sends a
// `snapshot-state` envelope to the originating client.
//
// **Catch-up pattern.** A freshly-connected client follows the
// `subscribe → snapshot → react-to-deltas` loop:
//
//   1. `subscribe` to the session — registers for live broadcasts.
//   2. `snapshot` to fetch the current projection state at the
//      server's `lastAppliedSequence`.
//   3. Apply every subsequent `event-applied` broadcast as a delta on
//      top of the snapshot — the local projection stays in sync with
//      the server's view.
//
// Without this envelope, a mid-session subscriber receives only the
// deltas with no baseline to apply them against. See refinement
// Decisions for the rationale of choosing this state-query shape
// (Interpretation A) over the label-creation shape (Interpretation
// B); the latter is deferred to a future task once the methodology
// engine grows a snapshot-create handler.
//
// **No `at` parameter today.** The `at: <sequence>` form (request
// "send me the state as of sequence N") is documented as a future
// extension; the v1 schema does not declare it. Use cases — test-
// mode scrubbing and audience-surface chapter navigation — are
// future deliverables. The schema's structural shape (`{ sessionId
// }`) accepts extra fields per Zod's default and ignores them, so
// adding `at` later is backward-compatible.

/**
 * Client → server. Asks the server to send the current projection
 * state for `sessionId`. The client must have already sent a
 * successful `subscribe` for the same session (the server enforces);
 * otherwise the wire response is an `error` envelope with
 * `code: 'forbidden'`.
 *
 * On success the server sends ONE envelope to the requesting client:
 *
 *   - A `snapshot-state` response (this envelope's request-response
 *     pair), correlated via `inResponseTo`. Carries `{ sessionId,
 *     sequence, projection }`. The `projection` field holds the
 *     full projection as a JSON-safe object (see
 *     `snapshotStatePayloadSchema` below).
 *
 * Unlike the propose / vote / commit / mark-meta-disagreement
 * handlers, this surface emits NO broadcast and NO event. It is a
 * pure read. Other subscribed clients are unaffected.
 *
 * On any rejection (not subscribed → `forbidden`; session not
 * visible → `not-found`), the server sends an `error` envelope with
 * the corresponding `code` via the dispatcher's `onHandlerError`
 * seam.
 */
export const snapshotPayloadSchema = z.object({
  sessionId: z.string().uuid(),
});

export type SnapshotPayload = z.infer<typeof snapshotPayloadSchema>;

/**
 * Server → client response. Echoes the originating `snapshot`
 * envelope's `id` via `inResponseTo`. Payload carries:
 *
 *   - `sessionId` — the session the projection describes.
 *   - `sequence` — `projection.lastAppliedSequence` at the point the
 *     SELECT ran. Subsequent `event-applied` broadcasts at
 *     `sequence > this` are deltas the client applies on top; any
 *     broadcast at `sequence <= this` is a no-op (already reflected
 *     in the snapshot).
 *   - `projection` — the full state, with the in-memory `Projection`
 *     class's Maps flattened to plain objects. The structure mirrors
 *     `apps/server/src/projection/types.ts`'s shape:
 *
 *     ```ts
 *     {
 *       sessionState: 'open' | 'ended',
 *       lastAppliedSequence: number,
 *       participants: ParticipantRecord[],
 *       nodes: ProjectedNode[],       // with FacetState.perParticipant flattened
 *       edges: ProjectedEdge[],       // with FacetState.perParticipant flattened
 *       annotations: ProjectedAnnotation[],
 *       pendingProposals: PendingProposal[],
 *       committedProposals: CommittedProposalRecord[],
 *       snapshots: SnapshotRecord[],
 *       unresolvedMetaDisagreements: UnresolvedMetaDisagreement[]
 *     }
 *     ```
 *
 * **Why `projection` is `z.unknown()`.** The projection types are
 * locked by the `projection` work-stream's refinements; widening
 * the wire schema to enforce every nested key would tightly couple
 * the WS module to those types and produce a maintenance burden
 * each time a new facet field lands. The projection is built by a
 * pure function (`projectFromLog`) over schema-validated events;
 * re-validating its OUTPUT is redundant. The serialization helper's
 * unit tests pin the wire shape; the schema's job is to keep the
 * OUTER envelope honest (no missing `sessionId`, no negative
 * `sequence`).
 */
export const snapshotStatePayloadSchema = z.object({
  sessionId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  projection: z.unknown(),
});

export type SnapshotStatePayload = {
  sessionId: string;
  sequence: number;
  projection: unknown;
};

// -- event-applied payload -----------------------------------------
//
// `event-applied` (server → client): emitted by the broadcast surface
// (`ws_event_broadcast`) whenever an event is successfully appended to
// `session_events`. Every WS connection subscribed to the event's
// `sessionId` (via `subscribe`) receives one `event-applied` envelope
// per appended event, in per-session sequence order.
//
// The payload wraps the appended event verbatim — same shape `events.ts`
// owns. Wrapping (rather than spreading the event fields onto the
// payload top level) keeps the event surface treatable as a single
// unit downstream consumers can pass to any code path that already
// handles a persisted event (the projection layer, the methodology
// engine's replay, audit logs).
//
// `sessionId` and `sequence` are NOT separate top-level fields on the
// payload — they live on the inner `event` already (and would otherwise
// drift). The convention saves a frame's worth of bytes and keeps the
// invariant "the event IS the broadcast" obvious to a wire-trace reader.
//
// **Ordering invariant.** The broadcast surface emits AFTER the
// `session_events` INSERT commits. Two events for the same session
// committed in sequence order produce two `event-applied` broadcasts
// in the same sequence order on every subscribed connection (per-
// session per-connection FIFO). Cross-session ordering is NOT
// guaranteed; subscribers care only about their own session's stream.

export const eventAppliedPayloadSchema = z.object({
  event: eventEnvelopeSchema,
});

export type EventAppliedPayload = {
  /** The appended event — same shape `events.ts` owns. */
  event: Event;
};

// -- error payload -------------------------------------------------
//
// `error` (server → client): emitted when a client request fails or
// the server cannot process an inbound frame. The envelope shape
// mirrors the HTTP `ApiError` body shape (see
// `apps/server/src/errors.ts`) minus the HTTP status code — the WS
// channel has no status code; the `code` discriminator is the typed
// branch clients switch on.
//
// **Owned by `ws_error_message`.** The discriminator vocabulary for
// `payload.code` is unified across the HTTP and WS surfaces:
//
//   - HTTP `ApiError.code` taxonomy (kebab-case): `'bad-request'`,
//     `'unauthorized'`, `'forbidden'`, `'not-found'`, `'conflict'`,
//     `'unprocessable-entity'`, `'internal-error'`.
//   - WS-specific additions: `'unknown-message-type'` (the
//     dispatcher's `onUnknownType` fires) and `'malformed-envelope'`
//     (`parseWsEnvelopeJson` rejects the inbound frame).
//   - Future `RejectionReason` values from the methodology engine
//     ride the same surface once the five message-type tasks
//     (`ws_propose_message`, `ws_vote_message`, `ws_commit_message`,
//     `ws_meta_disagreement_message`, `ws_snapshot_message`) land.
//
// **Correlation contract.** `inResponseTo` is present on the
// envelope when the error responds to a specific client envelope
// (the dispatcher seams echo `envelope.id`; the subscribe handler's
// visibility rejection echoes the originating subscribe envelope's
// id). It is absent when the error is server-emitted without a
// client correlate — the canonical case is `'malformed-envelope'`,
// where the inbound frame failed to parse and the server therefore
// cannot read an `id` off it.
//
// **Schema-on-write.** `serializeWsEnvelope` re-runs `parseWsEnvelope`
// on every outgoing frame, so a server bug that constructs an `error`
// envelope with a missing `code` field surfaces at the server, not
// on the client.
//
// **`code` is `z.string()` (not a closed enum).** Future
// `RejectionReason` values keep widening the effective set;
// constraining the wire schema to a closed enum here would force a
// shared-types update on every methodology change. The discipline
// is documented (every code is kebab-case + matches the HTTP
// taxonomy or a documented WS-specific extension) and enforced by
// the construction surface (`buildWsErrorEnvelope` accepts a
// `string` and callers reach for the documented values) — not by
// the wire schema.

/**
 * Server → client error envelope payload. Shape mirrors the HTTP
 * `ApiError` body minus the status code.
 *
 * - `code` — kebab-case discriminator. Reuses the HTTP `ApiError.code`
 *   taxonomy where applicable (`unauthorized`, `forbidden`,
 *   `not-found`, `bad-request`, `conflict`, `unprocessable-entity`,
 *   `internal-error`) plus WS-specific `unknown-message-type` and
 *   `malformed-envelope`. Future methodology `RejectionReason` values
 *   are added through the same surface as the relevant message-type
 *   tasks land.
 * - `message` — human-readable detail. `ApiError`-shaped server-side
 *   errors echo their `message` field; non-`ApiError` thrown values
 *   surface the generic literal `'internal error'` (the no-leak rule
 *   in `apps/server/src/ws/error-envelope.ts`).
 * - `details` — optional structured context (Zod issues, methodology
 *   rejection details, etc.). Same shape as `ApiErrorDetails`.
 */
export const errorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ErrorPayload = z.infer<typeof errorPayloadSchema>;

// -- Registry -------------------------------------------------------
//
// Exhaustive over `WsMessageType` (the `Record<...>` annotation forces
// the compile error if a `type` is added to `wsMessageTypes` without
// a corresponding registry entry). The two-stage parse below looks
// up `wsMessagePayloadSchemas[envelope.type]` and parses the payload
// against the matched schema.

export const wsMessagePayloadSchemas: Record<WsMessageType, z.ZodTypeAny> = {
  hello: helloPayloadSchema,
  // Group B — client → server request payload schemas.
  subscribe: subscribePayloadSchema,
  unsubscribe: unsubscribePayloadSchema,
  propose: proposePayloadSchema,
  vote: wsVotePayloadSchema,
  commit: wsCommitPayloadSchema,
  'mark-meta-disagreement': wsMarkMetaDisagreementPayloadSchema,
  snapshot: snapshotPayloadSchema,
  // Group C — server → client ack/result payload schemas.
  subscribed: subscribedPayloadSchema,
  unsubscribed: unsubscribedPayloadSchema,
  proposed: proposedPayloadSchema,
  voted: votedPayloadSchema,
  committed: committedPayloadSchema,
  'meta-disagreement-marked': metaDisagreementMarkedAckPayloadSchema,
  'snapshot-state': snapshotStatePayloadSchema,
  // The outer event envelope is checked; the per-kind payload inside
  // the event is `z.unknown()` per the schema in `events.ts` and is
  // re-validated by `validateEvent` on the receiving side. Server-side
  // we run `validateEvent` BEFORE the append + broadcast, so every
  // broadcast emitted carries a structurally valid event by
  // construction (schema-on-write invariant per ADR 0021).
  'event-applied': eventAppliedPayloadSchema,
  error: errorPayloadSchema,
};

// -- Per-type payload type map -------------------------------------
//
// Resolves each `type` to its concrete payload type so the generic
// `WsEnvelope<T>` narrows correctly. Mirror of `EventPayloadMap` in
// events.ts.

export interface WsMessagePayloadMap {
  hello: HelloPayload;
  // Group B — client → server request payload types.
  subscribe: SubscribePayload;
  unsubscribe: UnsubscribePayload;
  propose: ProposePayload;
  vote: WsVotePayload;
  commit: WsCommitPayload;
  'mark-meta-disagreement': WsMarkMetaDisagreementPayload;
  snapshot: SnapshotPayload;
  // Group C — server → client ack/result payload types.
  subscribed: SubscribedPayload;
  unsubscribed: UnsubscribedPayload;
  proposed: ProposedPayload;
  voted: VotedPayload;
  committed: CommittedPayload;
  'meta-disagreement-marked': MetaDisagreementMarkedAckPayload;
  'snapshot-state': SnapshotStatePayload;
  'event-applied': EventAppliedPayload;
  error: ErrorPayload;
}

export type WsPayloadFor<T extends WsMessageType> = WsMessagePayloadMap[T];

// -- Envelope -------------------------------------------------------
//
// The generic `WsEnvelope<T>` ties the `type` discriminator to its
// payload at the type level. `WsEnvelope` (no generic) is the
// discriminated-union shape consumers switch on.

export interface WsEnvelope<T extends WsMessageType = WsMessageType> {
  /** Discriminator — the closed `WsMessageType` enum. */
  type: T;
  /**
   * Client-generated message id (RFC 4122 v4 UUID). Required on every
   * envelope (server-emitted too — the server mints an id when it
   * originates a message). Used by `inResponseTo` to correlate
   * request → response across the duplex pipe.
   */
  id: string;
  /**
   * When this envelope is a response to a prior request, carries the
   * originating envelope's `id`. Absent on unsolicited server-emitted
   * envelopes (`hello`, broadcasts).
   */
  inResponseTo?: string;
  /** Per-`type` payload — narrowed via `WsPayloadFor<T>`. */
  payload: WsPayloadFor<T>;
}

/**
 * Discriminated union over `WsMessageType`. Switching on
 * `envelope.type` narrows `envelope.payload` to the matching
 * per-type payload.
 *
 * ```ts
 * function handle(envelope: WsEnvelopeUnion) {
 *   switch (envelope.type) {
 *     case 'hello':
 *       // envelope.payload is HelloPayload here
 *       break;
 *   }
 * }
 * ```
 */
export type WsEnvelopeUnion = {
  [T in WsMessageType]: WsEnvelope<T>;
}[WsMessageType];

// -- Envelope Zod schema -------------------------------------------
//
// Validates the OUTER envelope shape (type / id / inResponseTo /
// payload-as-unknown). The payload is parsed separately via the
// registry lookup in `parseWsEnvelope` — keeps error messages
// tagged with the offending `type` instead of producing a giant
// `discriminatedUnion`-issue tree.

export const wsEnvelopeSchema = z.object({
  type: wsMessageTypeSchema,
  id: z.string().uuid(),
  inResponseTo: z.string().uuid().optional(),
  // Validated separately against the per-type schema. Accepting any
  // value here means an envelope-level failure (e.g. unknown `type`)
  // does NOT mask a payload-shape failure with confusing nested
  // issues; the two-stage parse produces a clearer error.
  payload: z.unknown(),
});

// -- parseWsEnvelope -----------------------------------------------
//
// Two-stage parse:
//
//   1. Outer envelope (`wsEnvelopeSchema`) — type / id / inResponseTo
//      / payload-as-unknown.
//   2. Per-type payload (`wsMessagePayloadSchemas[type]`).
//
// Returns the typed `WsEnvelopeUnion` on success; throws a
// `WsEnvelopeValidationError` on failure with a message that names
// the offending `type` and the failing path inside the payload.
//
// **Why throw rather than return a Result type.** The server's
// dispatcher catches and routes failures into the WS-error envelope
// (`ws_error_message`'s job); a thrown error fits the existing
// try/catch shape. Tests assert on `instanceof
// WsEnvelopeValidationError`.

/**
 * Thrown by `parseWsEnvelope` when validation fails at either stage.
 * `cause` carries the underlying `ZodError` when present.
 */
export class WsEnvelopeValidationError extends Error {
  override readonly name = 'WsEnvelopeValidationError';
}

/**
 * Validate a candidate value as a `WsEnvelopeUnion`. Accepts either a
 * parsed object (Vitest unit tests pass an object literal) or a JSON
 * string (the WS message-receive path passes the raw frame bytes via
 * `parseWsEnvelopeJson`).
 *
 * @param raw an already-parsed JavaScript value.
 * @returns the typed envelope (discriminated union).
 * @throws {WsEnvelopeValidationError} on any envelope or payload
 *         mismatch, or on an unknown `type`.
 */
export function parseWsEnvelope(raw: unknown): WsEnvelopeUnion {
  const envelopeResult = wsEnvelopeSchema.safeParse(raw);
  if (!envelopeResult.success) {
    throw new WsEnvelopeValidationError(
      `ws envelope failed validation: ${envelopeResult.error.message}`,
      { cause: envelopeResult.error },
    );
  }

  const envelope = envelopeResult.data;
  const payloadSchema = wsMessagePayloadSchemas[envelope.type];
  // The registry is exhaustive over `WsMessageType`; the envelope
  // schema's `type` is the same enum. This guard exists so the failure
  // mode is explicit if someone widens `wsMessageTypeSchema` without
  // adding the matching registry entry.
  if (!payloadSchema) {
    throw new WsEnvelopeValidationError(
      `no payload schema registered for ws message type '${envelope.type}'`,
    );
  }

  const payloadResult = payloadSchema.safeParse(envelope.payload);
  if (!payloadResult.success) {
    throw new WsEnvelopeValidationError(
      `payload for ws message type '${envelope.type}' failed validation: ${payloadResult.error.message}`,
      { cause: payloadResult.error },
    );
  }

  // We've validated both halves; the resulting object is a valid
  // envelope. The cast is the bridge from Zod's runtime check to the
  // TS discriminated union — same pattern `validateEvent` in
  // events.ts uses.
  const result = {
    type: envelope.type,
    id: envelope.id,
    payload: payloadResult.data,
    ...(envelope.inResponseTo !== undefined ? { inResponseTo: envelope.inResponseTo } : {}),
  };
  return result as WsEnvelopeUnion;
}

/**
 * Parse a raw JSON string into a typed `WsEnvelopeUnion`. The WS
 * message-receive path calls this with the inbound frame's UTF-8
 * payload. Two failure modes are surfaced as the same
 * `WsEnvelopeValidationError`:
 *
 *   1. `JSON.parse` throws (malformed JSON) → wrap into a
 *      `WsEnvelopeValidationError` with the parse error as `cause`.
 *   2. `parseWsEnvelope` throws (well-formed JSON but schema-invalid).
 *
 * Wrapping the JSON error keeps the dispatcher's catch site narrow —
 * one error class to handle for both failure paths.
 */
export function parseWsEnvelopeJson(text: string): WsEnvelopeUnion {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new WsEnvelopeValidationError(
      `ws envelope JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  return parseWsEnvelope(raw);
}

/**
 * Serialize an envelope to its wire-format string.
 *
 * The shape is validated via `parseWsEnvelope` before
 * `JSON.stringify`. Validation at serialize-time catches the case
 * where the server constructs a malformed envelope (a programmer
 * error) — without it, a bad envelope would silently reach the wire
 * and break the client's parse. The cost is one extra parse per
 * outgoing message, which is negligible on the WS surface.
 *
 * @param envelope the typed envelope to send.
 * @returns the JSON string ready for `socket.send(...)`.
 * @throws {WsEnvelopeValidationError} if the envelope fails its own
 *         schema (defensive — server bug, not a client bug).
 */
export function serializeWsEnvelope(envelope: WsEnvelopeUnion): string {
  // Re-validate so a server-side construction bug fails loudly here
  // rather than silently on the wire. Same trade-off as event_validation.
  parseWsEnvelope(envelope);
  return JSON.stringify(envelope);
}
