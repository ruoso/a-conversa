// Server-side WebSocket envelope helpers.
//
// Refinement: tasks/refinements/backend/ws_message_envelope.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_message_envelope
//
// Thin server-side wrapper around the shared envelope schema and
// helpers from `@a-conversa/shared-types`. Exists so the server has a
// single import surface for "the WS envelope" (just `./envelope.js`)
// without consumers reaching across packages for every helper. The
// schema, parse, and serialize functions themselves are owned by the
// shared package — this file re-exports them and adds a small server-
// side helper (`buildHelloEnvelope`) that constructs the on-connect
// hello message with a freshly minted message id.
//
// **Why a wafer-thin wrapper.** The shared package owns the contract
// (one source of truth) so participant / moderator / audience apps
// import the same types. The server-side helpers are the construction
// + I/O glue: builder functions that mint an `id`, the
// dispatcher-side error class, and the `socket.send` adapter live
// here. Each consumer reaches for `./envelope.js` (server) or
// `@a-conversa/shared-types` (cross-app) per their layer.

import { randomUUID } from 'node:crypto';

import {
  parseWsEnvelope,
  parseWsEnvelopeJson,
  serializeWsEnvelope,
  WsEnvelopeValidationError,
  type WsEnvelope,
  type WsEnvelopeUnion,
  type WsMessageType,
  type WsPayloadFor,
} from '@a-conversa/shared-types';

// Re-export the shared surface so server-side callers have one import
// path. The barrel in `./index.ts` lifts these further so consumers
// in the broader server codebase reach for `./ws/index.js`.
export { parseWsEnvelope, parseWsEnvelopeJson, serializeWsEnvelope, WsEnvelopeValidationError };
export type { WsEnvelope, WsEnvelopeUnion, WsMessageType, WsPayloadFor };

/**
 * Construct a fully-typed `WsEnvelope<T>` with a freshly minted
 * message id (`crypto.randomUUID()`, RFC 4122 v4). Used by the
 * server-emitted messages (hello today; broadcasts, ack, error
 * envelopes when their owning tasks land).
 *
 * @param type the closed-enum discriminator value.
 * @param payload the per-type payload (typed via `WsPayloadFor<T>`).
 * @param inResponseTo optional originating client envelope id —
 *                     present when this envelope is a response (the
 *                     error / ack envelopes will use this).
 * @returns a typed envelope ready to pass through `serializeWsEnvelope`.
 */
export function buildServerEnvelope<T extends WsMessageType>(
  type: T,
  payload: WsPayloadFor<T>,
  inResponseTo?: string,
): WsEnvelope<T> {
  const base = {
    type,
    id: randomUUID(),
    payload,
  } as const;
  return inResponseTo !== undefined ? { ...base, inResponseTo } : base;
}

/**
 * Build the canonical on-connect hello envelope. Replaces the
 * placeholder `{ type: 'hello', connectionId }` shape that
 * `ws_connection_handling` shipped. The new shape is envelope-shaped:
 *
 *   `{ type: 'hello', id: <uuid>, payload: { connectionId: <uuid> } }`
 *
 * `id` is a freshly minted v4 UUID for the message; `connectionId` is
 * the connection-lifetime identifier the connection-handling plugin
 * already mints (passed in by the caller — not derived here, so the
 * single `connectionId` mint stays in `connection.ts`).
 *
 * @param connectionId the v4 UUID minted by `connection.ts` on open.
 * @returns the hello envelope ready for `serializeWsEnvelope`.
 */
export function buildHelloEnvelope(connectionId: string): WsEnvelope<'hello'> {
  return buildServerEnvelope('hello', { connectionId });
}
