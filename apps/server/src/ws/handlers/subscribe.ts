// Dispatcher handlers for `subscribe` / `unsubscribe` client messages.
//
// Refinement: tasks/refinements/backend/ws_subscribe_to_session.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_subscribe_to_session
//
// **What this module owns.**
//
// Two `WsDispatcher` handlers — `subscribe` and `unsubscribe` — plus
// a builder that captures the `app.wsSubscriptions` / `app.log` / pool
// closures and returns a handler-pair ready to be registered. The
// handlers:
//
//   1. `subscribe` — calls `canSeeSession(pool, sessionId, userId)`.
//      Visible → registry.subscribe + send `subscribed` ack.
//      Not visible → placeholder error path (see below) + early-return.
//   2. `unsubscribe` — idempotent: drops the (conn, session) tuple from
//      the registry and sends an `unsubscribed` ack. No visibility
//      check (a client that's NOT subscribed can still ask to be
//      removed; the ack is the contract).
//
// **Why a builder, not a class.** The dispatcher's
// `register(type, handler)` signature takes a closure; a builder that
// captures `(app, pool)` once and returns the handler pair keeps the
// handler bodies pure-function — easier to unit-test in isolation
// without standing up a full Fastify instance.
//
// **Error path is a placeholder until `ws_error_message` lands.** The
// canonical wire-format error envelope is owned by `ws_error_message`
// (one of this task's siblings under `websocket_protocol`). Today the
// dispatcher's `onUnknownType` / `onHandlerError` seams log + drop;
// this handler's "not visible" path follows the same discipline —
// log at warn level and drop the request. The client's `subscribe`
// envelope will eventually time-out client-side waiting for the ack
// (no ack is the signal); when `ws_error_message` ships, that task
// will replace this branch with a typed error envelope carrying
// `inResponseTo = envelope.id` so the client gets a deterministic
// rejection.
//
// **Why no error envelope today (vs. inventing one prematurely).** The
// `error` type isn't in the closed `WsMessageType` discriminator yet
// (per `packages/shared-types/src/ws-envelope.ts`). Adding it here
// would either (a) hard-code a wire shape the `ws_error_message` task
// will then have to change, or (b) require a forward-compatible
// guess at the error envelope's shape. The dispatcher-seam pattern
// the envelope task established is the project's chosen discipline:
// log + drop today, wire-format error when the owning task lands.

import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { WsEnvelope } from '@a-conversa/shared-types';

import type { DbPool } from '../../db.js';
import { canSeeSession } from '../../sessions/visibility.js';
import type { WsConnectionContext } from '../connection.js';
import { serializeWsEnvelope } from '../envelope.js';
import type { WsDispatcher } from '../dispatcher.js';
import type { WsSubscriptionRegistry } from '../subscriptions.js';

/**
 * Captures the pool + registry + logger so the handler bodies are
 * pure closures. The shape mirrors the existing `WsDispatcherOptions`
 * pattern — a small object passed in at construction so the handler
 * doesn't reach across module boundaries each time it fires.
 */
export interface SubscribeHandlerOptions {
  /** DB pool the visibility predicate runs against. */
  readonly pool: DbPool;
  /** Per-instance subscription registry. */
  readonly registry: WsSubscriptionRegistry;
  /** Logger used for the placeholder error path + diagnostics. */
  readonly log: FastifyBaseLogger;
}

/**
 * Build the `subscribe` handler. Visible → registry.subscribe + ack.
 * Not visible → log + drop (placeholder until `ws_error_message`).
 */
export function buildSubscribeHandler(
  opts: SubscribeHandlerOptions,
): (envelope: WsEnvelope<'subscribe'>, connection: WsConnectionContext) => Promise<void> {
  return async (envelope, connection) => {
    const { sessionId } = envelope.payload;
    const userId = connection.user?.id;
    if (userId === undefined) {
      // The auth gate (`ws_auth_on_connect`) populates `connection.user`
      // before the dispatcher ever sees a message. Reaching this branch
      // would indicate a wiring bug — log + drop so the connection
      // stays usable for other messages, but make the issue loud.
      opts.log.error(
        {
          connectionId: connection.connectionId,
          messageId: envelope.id,
        },
        'ws-subscribe: connection.user is undefined — auth gate bypassed',
      );
      return;
    }

    const visible = await canSeeSession(opts.pool, sessionId, userId);
    if (!visible) {
      // Placeholder error path. `ws_error_message` will replace the
      // log + return with a typed error envelope sent back on the
      // socket carrying `code: 'not-found'` (the visibility predicate
      // collapses "doesn't exist" and "exists but not visible" — see
      // `apps/server/src/sessions/visibility.ts`'s docblock for the
      // 404-not-403 decision) and `inResponseTo = envelope.id`.
      opts.log.warn(
        {
          connectionId: connection.connectionId,
          userId,
          sessionId,
          messageId: envelope.id,
        },
        'ws-subscribe rejected — session not visible to user (placeholder error path, ws_error_message TODO)',
      );
      return;
    }

    opts.registry.subscribe(connection.connectionId, sessionId);

    // Send the `subscribed` ack. The envelope's `inResponseTo`
    // correlates to the originating `subscribe` envelope's `id`; the
    // payload echoes the `sessionId` for human-readable debuggability
    // (the wire-protocol contract is that `inResponseTo` is the
    // authoritative correlation field).
    const ack: WsEnvelope<'subscribed'> = {
      type: 'subscribed',
      id: randomUUID(),
      inResponseTo: envelope.id,
      payload: { sessionId },
    };
    connection.socket.send(serializeWsEnvelope(ack));
  };
}

/**
 * Build the `unsubscribe` handler. Idempotent — even if the client
 * wasn't subscribed to the session, the ack still fires. The contract
 * is "after you receive `unsubscribed`, you won't receive any more
 * broadcasts for this session over this connection"; trivially true
 * when no subscription existed.
 */
export function buildUnsubscribeHandler(
  opts: SubscribeHandlerOptions,
): (envelope: WsEnvelope<'unsubscribe'>, connection: WsConnectionContext) => Promise<void> {
  return (envelope, connection) => {
    const { sessionId } = envelope.payload;
    opts.registry.unsubscribe(connection.connectionId, sessionId);
    const ack: WsEnvelope<'unsubscribed'> = {
      type: 'unsubscribed',
      id: randomUUID(),
      inResponseTo: envelope.id,
      payload: { sessionId },
    };
    connection.socket.send(serializeWsEnvelope(ack));
    return Promise.resolve();
  };
}

/**
 * Register both handlers against the dispatcher. Called by the
 * `wsHandlersPlugin` once at registration time.
 */
export function registerSubscribeHandlers(
  dispatcher: WsDispatcher,
  opts: SubscribeHandlerOptions,
): void {
  dispatcher.register('subscribe', buildSubscribeHandler(opts));
  dispatcher.register('unsubscribe', buildUnsubscribeHandler(opts));
}
