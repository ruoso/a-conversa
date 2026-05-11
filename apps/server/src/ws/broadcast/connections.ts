// Per-connection sender registry — maps `connectionId` -> sender
// closure so the broadcast subscriber can fan out frames without
// reaching back into the connection handler's closures.
//
// Refinement: tasks/refinements/backend/ws_event_broadcast.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_event_broadcast
//
// **What this module owns.** A per-app-instance lookup from the WS
// connection's stable id (the v4 UUID the connection handler mints on
// open) to a `WsEnvelopeSender` — a closure that knows how to send a
// parsed envelope on the underlying socket.
//
// **Why a separate registry (vs. attaching the sender to
// `WsConnectionContext`).** Two reasons:
//
//   1. The subscription registry (`WsSubscriptionRegistry`) returns
//      `connectionId` strings — connections-for-session lookup yields
//      a list of stable ids, not contexts. Storing senders against
//      the same id makes the fan-out a single `Map.get` per target.
//   2. The connection context's `socket` is intentionally private to
//      the connection handler (it carries the raw `ws.WebSocket` from
//      the upstream library; reaching for it from a different module
//      couples that module to the WS implementation). The sender
//      closure exposes a minimal `(envelope) => void` surface that
//      hides the socket entirely.
//
// **Why per-app-instance.** Same rationale as `WsSubscriptionRegistry`
// and `WsBroadcastBus`: tests build a fresh app per scenario, so a
// module-scoped registry would carry senders across test instances.
// Each `createServer()` call gets its own registry decorated onto
// `app.wsConnectionSenders`.
//
// **Lifecycle.** The connection handler calls `register(connectionId,
// sender)` on open and `unregister(connectionId)` on close. Both calls
// are idempotent — re-registering replaces the sender (rare under
// real lifecycles, but the contract stays explicit); unregistering an
// unknown id is a no-op.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import type { WsEnvelopeUnion } from '@a-conversa/shared-types';

/**
 * Closure type the broadcast subscriber invokes per target connection.
 * The sender knows how to serialise + send on the underlying socket.
 * Returning `void` (not a promise) keeps the fan-out tight — the
 * upstream `ws.WebSocket.send` is fire-and-forget at the API level
 * (buffering happens inside the library; back-pressure surfaces via
 * `bufferedAmount` which is not part of the broadcast contract today).
 *
 * Implementations MUST be defensive against send-on-closed-socket and
 * other transient errors; the subscriber's per-connection try/catch
 * wraps each invocation, so a thrown error here is logged + swallowed,
 * not propagated to the bus emit caller.
 */
export type WsEnvelopeSender = (envelope: WsEnvelopeUnion) => void;

/**
 * Per-server-instance connection sender registry. Decorated onto
 * `app.wsConnectionSenders` so siblings (the broadcast subscriber, any
 * future direct-send surface) can reach a per-connection sender by id.
 */
export class WsConnectionSenderRegistry {
  readonly #senders = new Map<string, WsEnvelopeSender>();

  /**
   * Register a sender for `connectionId`. Replaces any previously-
   * registered sender for the same id. Called by the connection
   * handler on socket open.
   */
  register(connectionId: string, sender: WsEnvelopeSender): void {
    this.#senders.set(connectionId, sender);
  }

  /**
   * Remove the sender for `connectionId`. Idempotent — unregistering
   * an unknown id is a no-op. Called by the connection handler on
   * socket close (or by the close hook of any future reconnection
   * surface).
   */
  unregister(connectionId: string): void {
    this.#senders.delete(connectionId);
  }

  /**
   * Look up the sender for `connectionId`. Returns `undefined` when
   * the connection has been unregistered (e.g. closed in the window
   * between the broadcast subscriber's snapshot and the fan-out
   * iteration). The caller MUST treat `undefined` as "skip — this
   * connection is gone" and continue to the next target.
   */
  get(connectionId: string): WsEnvelopeSender | undefined {
    return this.#senders.get(connectionId);
  }

  /** Count of registered senders. Test-only convenience. */
  size(): number {
    return this.#senders.size;
  }
}

/**
 * Fastify plugin: construct a `WsConnectionSenderRegistry` per app
 * instance and decorate it onto `app.wsConnectionSenders`.
 *
 * `fastify-plugin`-wrapped + idempotent (same shape as the other WS
 * plugins) so siblings registered in any encapsulation can reach the
 * registry via `app.wsConnectionSenders.<method>(...)`.
 */
const wsConnectionSendersPluginAsync: FastifyPluginAsync = (app: FastifyInstance) => {
  if (!app.hasDecorator('wsConnectionSenders')) {
    app.decorate('wsConnectionSenders', new WsConnectionSenderRegistry());
  }
  return Promise.resolve();
};

export const wsConnectionSendersPlugin = fp(wsConnectionSendersPluginAsync, {
  name: 'a-conversa-ws-connection-senders',
  fastify: '5.x',
});

// -- TypeScript augmentation ---------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * The per-app-instance per-connection sender registry. The
     * connection handler registers a sender on socket open and
     * unregisters on socket close; the broadcast subscriber (see
     * `./event-applied.ts`) reaches for senders by connection id when
     * fanning out a frame.
     */
    wsConnectionSenders: WsConnectionSenderRegistry;
  }
}
