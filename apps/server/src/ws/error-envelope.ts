// Server-side WebSocket error-envelope construction + send helper.
//
// Refinement: tasks/refinements/backend/ws_error_message.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_error_message
//
// **What this module owns.**
//
// `buildWsErrorEnvelope({ inResponseTo?, code, message, details? })` —
// pure builder that returns a typed `WsEnvelope<'error'>` with a
// freshly-minted v4 UUID `id`. Pure so it's directly unit-testable
// without standing up a Fastify instance.
//
// `sendWsError(send, options)` — builds the envelope, serialises it
// (via `serializeWsEnvelope`, which re-validates so a server-construction
// bug fails loudly at the server, not silently on the wire), and
// invokes the sender closure with the wire string. Used by:
//
//   1. `WsDispatcher`'s `onUnknownType` seam → `code: 'unknown-message-type'`.
//   2. `WsDispatcher`'s `onHandlerError` seam → `code: <ApiError.code>` if
//      the thrown value is `ApiError`-shaped; otherwise `'internal-error'`
//      and the full error is logged server-side at error level (the
//      no-leak rule — non-`ApiError` thrown messages can leak stack /
//      DB / hostname details).
//   3. `connection.ts`'s receive loop → `code: 'malformed-envelope'`
//      when `parseWsEnvelopeJson` rejects an inbound frame. The
//      connection STAYS OPEN (per-frame failures are recoverable; a
//      reconnect for a one-frame hiccup would be over-strict).
//   4. `handlers/subscribe.ts`'s visibility-rejection branch →
//      `code: 'not-found'` (inherits the existence-non-leak rule from
//      `canSeeSession` — if the user can't see it, the wire says
//      not-found, not forbidden).
//   5. Future message-type tasks (`ws_propose_message`,
//      `ws_vote_message`, `ws_commit_message`,
//      `ws_meta_disagreement_message`, `ws_snapshot_message`) will
//      reach for `sendWsError(connection.socket.send.bind(...), {
//      code: rejection.reason, message: rejection.detail,
//      inResponseTo: envelope.id })` for their methodology-rejection
//      path. Same surface, same vocabulary, no new wire shape per
//      task.
//
// **Sender as a parameter, not coupled to `socket.send`.** The helper
// takes `(wire: string) => void` so callers can wire any source: the
// dispatcher seams reach for `app.wsConnectionSenders.get(connectionId)`
// (the broadcast surface's per-connection registry, which returns a
// `(envelope) => void` we wrap as `(wire) => sender(parsed)`); the
// subscribe handler can pass `(wire) => socket.send(wire)`. Either
// path produces the same wire output because every server-emitted
// envelope flows through `serializeWsEnvelope`.
//
// **`ApiError`-shape duck-typing.** `isApiErrorShape(err)` checks for
// `typeof err.code === 'string' && typeof err.message === 'string'`;
// it does NOT `instanceof ApiError`. Rationale: (a) methodology-engine
// rejections may be wrapped at the call site (`rejectedToApiError`)
// or constructed as plain-object errors by a future handler; (b) the
// cross-module import would couple every consumer to
// `apps/server/src/errors.ts` even if it constructs its own shape.
// Duck-typing covers both cleanly.

import { randomUUID } from 'node:crypto';

import type { WsEnvelope } from '@a-conversa/shared-types';

import { serializeWsEnvelope } from './envelope.js';

/**
 * Sender closure invoked by `sendWsError`. Receives the serialised
 * wire string ready to push on the underlying socket. Returning
 * `void` keeps the call site simple — every WS send is fire-and-forget
 * at the library level; the underlying `ws.WebSocket.send` queues
 * internally.
 *
 * Implementations may throw (e.g. send-on-closed-socket); callers
 * that wrap `sendWsError` in a broader error-handling boundary (the
 * dispatcher seams already log internal errors at error level) are
 * responsible for the catch.
 */
export type WsErrorSender = (wire: string) => void;

/**
 * Inputs to `buildWsErrorEnvelope` and `sendWsError`. Mirrors the
 * `ApiError` body shape (code / message / details) plus the
 * `inResponseTo` correlation field the WS surface adds for duplex
 * request → response pairing.
 */
export interface WsErrorEnvelopeOptions {
  /**
   * Kebab-case discriminator clients branch on. Reuses the HTTP
   * `ApiError.code` taxonomy where applicable (`unauthorized`,
   * `forbidden`, `not-found`, `bad-request`, `conflict`,
   * `unprocessable-entity`, `internal-error`) plus the WS-specific
   * `unknown-message-type` and `malformed-envelope`. Future
   * `RejectionReason` values from the methodology engine ride the
   * same surface once their message-type tasks land.
   */
  readonly code: string;
  /**
   * Human-readable detail. `ApiError`-shaped server-side errors
   * echo their own `message`; non-`ApiError` thrown values surface
   * the generic literal `'internal error'` (the no-leak rule —
   * `onHandlerError` produces the generic message and logs the
   * underlying error server-side).
   */
  readonly message: string;
  /**
   * When the envelope responds to a specific client envelope, carries
   * the originating envelope's `id`. Absent when the error is
   * server-emitted without a client correlate — the canonical case
   * is `'malformed-envelope'`, where the inbound frame failed to
   * parse and the server therefore cannot read an `id` off it.
   */
  readonly inResponseTo?: string;
  /**
   * Optional structured context (Zod issues, methodology rejection
   * details, etc.). Same shape as `ApiErrorDetails`.
   */
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Build a typed `WsEnvelope<'error'>` with a freshly-minted v4 UUID
 * `id`. Pure — no I/O, no logging, no socket. Use this when a caller
 * wants the envelope object (e.g. to assert against in a unit test);
 * production callers reach for `sendWsError` which builds + sends in
 * one call.
 */
export function buildWsErrorEnvelope(options: WsErrorEnvelopeOptions): WsEnvelope<'error'> {
  const base = {
    type: 'error' as const,
    id: randomUUID(),
    payload: {
      code: options.code,
      message: options.message,
      ...(options.details !== undefined ? { details: options.details } : {}),
    },
  };
  return options.inResponseTo !== undefined
    ? { ...base, inResponseTo: options.inResponseTo }
    : base;
}

/**
 * Build the canonical error envelope and push the serialised wire
 * string through `send`. Every server-emitted error envelope MUST
 * flow through this helper — it's the single surface where the
 * envelope's shape is constructed and validated before reaching the
 * socket.
 *
 * **Why `serializeWsEnvelope` is the right wrapper.** It re-runs the
 * shared `parseWsEnvelope` schema check before stringifying; a server
 * bug that constructs an `error` envelope with (e.g.) a missing
 * `code` field fails loudly here rather than silently on the wire.
 * Same trade-off the `ws_message_envelope` task documented for every
 * server-emitted frame.
 *
 * @param send the sender closure — receives the serialised wire string.
 * @param options the envelope's `code` / `message` / optional
 *                `inResponseTo` / optional `details`.
 */
export function sendWsError(send: WsErrorSender, options: WsErrorEnvelopeOptions): void {
  const envelope = buildWsErrorEnvelope(options);
  const wire = serializeWsEnvelope(envelope);
  send(wire);
}

/**
 * Generic message the no-leak rule uses on non-`ApiError` thrown
 * values. Exported so tests can assert against the exact literal
 * without re-declaring the constant. Production callers reach
 * `isApiErrorShape` first and pass the thrown value's own `message`
 * for `ApiError`-shaped throws; the generic literal applies only to
 * the fallback branch.
 */
export const WS_INTERNAL_ERROR_MESSAGE = 'internal error';

/**
 * Generic discriminator the no-leak rule uses on non-`ApiError`
 * thrown values. Exported alongside `WS_INTERNAL_ERROR_MESSAGE` so
 * the constants stay co-located.
 */
export const WS_INTERNAL_ERROR_CODE = 'internal-error';

/**
 * Discriminator the dispatcher's `onUnknownType` seam emits. Exported
 * so the seam and the test stay in sync without a string duplication.
 */
export const WS_UNKNOWN_MESSAGE_TYPE_CODE = 'unknown-message-type';

/**
 * Discriminator the connection-level malformed-envelope path emits.
 * Exported so the connection handler and the test stay in sync
 * without a string duplication.
 */
export const WS_MALFORMED_ENVELOPE_CODE = 'malformed-envelope';

/**
 * Discriminator the subscribe handler emits when a connection has
 * already subscribed to its per-connection cap of sessions and is
 * trying to add another. Closes
 * `docs/security/m3-review/inputs.md` F-001. The cap (and its env
 * override) live in `subscriptions.ts`; the wire code is shared
 * here so the handler + test + protocol doc stay in lock-step.
 *
 * The wire `message` field intentionally carries no integer (no
 * cap value, no occupancy count) so a future cap retune via
 * `WS_MAX_SUBSCRIPTIONS_PER_CONNECTION` does not require a
 * coordinated wire-message change AND so an attacker cannot
 * calibrate their fan-out against the leaked value.
 */
export const WS_TOO_MANY_SUBSCRIPTIONS_CODE = 'too-many-subscriptions';

/**
 * Duck-typed `ApiError` shape. Returns `true` when the thrown value
 * has both `code: string` and `message: string` fields, which is the
 * structural contract `apps/server/src/errors.ts`'s `ApiError` class
 * satisfies. Used by the dispatcher's `onHandlerError` seam to decide
 * whether the thrown value's `message` is safe to echo to the client
 * (`true`: handler chose the message; `false`: programmer error,
 * surface the generic literal and log the underlying error
 * server-side).
 *
 * NOT an `instanceof ApiError` check — methodology-engine rejections
 * may be wrapped into `ApiError` at the call site OR constructed as
 * plain-object errors by a future message-type handler. Duck-typing
 * covers both shapes.
 */
export function isApiErrorShape(err: unknown): err is { code: string; message: string } {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const candidate = err as { code?: unknown; message?: unknown };
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}
