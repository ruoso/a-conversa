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

// -- Message-type vocabulary ----------------------------------------
//
// The closed list of `type` discriminator values. Today only `hello`
// is shipped (replacing the ws_connection_handling placeholder).
// Downstream tasks (`ws_propose_message`, `ws_vote_message`,
// `ws_commit_message`, `ws_meta_disagreement_message`,
// `ws_snapshot_message`, `ws_error_message`) extend this list and the
// matching `wsMessagePayloadSchemas` entry.
//
// The list is declared `as const` so the `WsMessageType` union narrows
// to the literal-string union. Zod's `z.enum(wsMessageTypes)` checks
// the wire value against this list at parse time.

export const wsMessageTypes = [
  'hello',
  'subscribe',
  'unsubscribe',
  'subscribed',
  'unsubscribed',
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

// -- Registry -------------------------------------------------------
//
// Exhaustive over `WsMessageType` (the `Record<...>` annotation forces
// the compile error if a `type` is added to `wsMessageTypes` without
// a corresponding registry entry). The two-stage parse below looks
// up `wsMessagePayloadSchemas[envelope.type]` and parses the payload
// against the matched schema.

export const wsMessagePayloadSchemas: Record<WsMessageType, z.ZodTypeAny> = {
  hello: helloPayloadSchema,
  subscribe: subscribePayloadSchema,
  unsubscribe: unsubscribePayloadSchema,
  subscribed: subscribedPayloadSchema,
  unsubscribed: unsubscribedPayloadSchema,
};

// -- Per-type payload type map -------------------------------------
//
// Resolves each `type` to its concrete payload type so the generic
// `WsEnvelope<T>` narrows correctly. Mirror of `EventPayloadMap` in
// events.ts.

export interface WsMessagePayloadMap {
  hello: HelloPayload;
  subscribe: SubscribePayload;
  unsubscribe: UnsubscribePayload;
  subscribed: SubscribedPayload;
  unsubscribed: UnsubscribedPayload;
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
