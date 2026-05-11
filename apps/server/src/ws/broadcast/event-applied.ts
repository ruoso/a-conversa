// `event-applied` broadcast subscriber — fan out a server-emitted
// envelope to every connection subscribed to the event's session.
//
// Refinement: tasks/refinements/backend/ws_event_broadcast.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_event_broadcast
//
// **What this module owns.**
//
//   1. `buildEventAppliedBroadcastListener(...)` — a pure builder that
//      captures the subscription registry, the connection-sender
//      registry, and the logger, and returns a `WsBroadcastListener`
//      ready to register on the bus. Pure so the fan-out behaviour
//      is unit-testable without standing up a Fastify instance.
//   2. `wsEventAppliedBroadcastPlugin` — the Fastify plugin that
//      registers the listener against `app.wsBroadcast` once at app-
//      ready time. The registration's lifetime is the app's lifetime;
//      the bus is destroyed with the app, so no explicit unsubscribe
//      is needed.
//
// **Fan-out shape.** For each `event-applied` bus event:
//
//   1. Read `event.sessionId` from the bus event's payload.
//   2. Look up `connectionsForSession(sessionId)` — a fresh array
//      snapshot (per the registry's contract).
//   3. For each connectionId:
//      - Look up the sender via `wsConnectionSenders.get(connectionId)`.
//      - If `undefined` (the connection was unregistered between the
//        snapshot and the iteration — close races are possible),
//        skip. Otherwise build the canonical `event-applied` envelope
//        and pass it to the sender inside a try/catch.
//      - On send failure (sender threw): log at warn level with the
//        connection id + event id; CONTINUE the iteration so one bad
//        socket doesn't break the fan-out.
//
// **Error isolation.** Per-connection try/catch is the hard contract —
// the broadcast surface MUST NOT crash an emit because one socket is
// in a bad state. Without isolation a single misbehaving client could
// suppress broadcasts to every other subscriber.
//
// **Server-emitted envelope id.** Each broadcast frame carries a
// freshly-minted v4 UUID `id` (per `ws_message_envelope`'s contract for
// server-originated messages). `inResponseTo` is absent — broadcasts
// are unsolicited; they don't correlate to a client request.
//
// **Ordering invariant — how this module honours it.** The bus
// dispatches synchronously in registration order, and routes emit
// AFTER their `session_events` INSERT commits. The listener therefore
// sees events in commit order. Each fan-out call sends synchronously
// to every connection; the underlying `ws.WebSocket.send` queues
// frames in the order they're invoked. End-to-end: every subscribed
// connection sees broadcasts in per-session sequence order.

import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import type { WsEnvelope } from '@a-conversa/shared-types';

import { wsBroadcastPlugin, type EventAppliedBusEvent, type WsBroadcastListener } from './bus.js';
import { wsConnectionSendersPlugin, type WsConnectionSenderRegistry } from './connections.js';
import type { WsSubscriptionRegistry } from '../subscriptions.js';

/**
 * Options for `buildEventAppliedBroadcastListener`. Captures the
 * subscription registry (the "who's subscribed to what" lookup), the
 * connection-sender registry (the "how do I send on this connection"
 * lookup), and a logger for the per-connection error-isolation path.
 */
export interface EventAppliedBroadcastListenerOptions {
  /** Per-app-instance subscription registry. */
  readonly subscriptions: WsSubscriptionRegistry;
  /** Per-app-instance connection-sender registry. */
  readonly connectionSenders: WsConnectionSenderRegistry;
  /** Logger for the per-connection warn-level error-isolation path. */
  readonly log: FastifyBaseLogger;
}

/**
 * Build the bus listener that fans out `event-applied` notifications
 * to every WS connection subscribed to the event's session. Returned
 * as a closure so the listener's dependencies are explicit + so the
 * builder is unit-testable without a Fastify instance.
 *
 * The returned listener:
 *
 *   1. Reads `event.sessionId` and queries the subscription registry.
 *   2. For each subscribed connection:
 *      - Builds a server-emitted envelope (`{ type: 'event-applied',
 *        id: <new uuid>, payload: { event } }`).
 *      - Looks up the per-connection sender.
 *      - Catches send failures per-connection (one bad socket doesn't
 *        break the fan-out).
 */
export function buildEventAppliedBroadcastListener(
  opts: EventAppliedBroadcastListenerOptions,
): WsBroadcastListener {
  return (evt: EventAppliedBusEvent) => {
    const { event } = evt;
    const sessionId = event.sessionId;
    const connectionIds = opts.subscriptions.connectionsForSession(sessionId);
    if (connectionIds.length === 0) {
      // No subscribers — nothing to do. The bus emit was a no-op
      // from the broadcast-surface's perspective; the route's
      // post-commit emit still ran for any other registered listener.
      return;
    }

    // Build the envelope ONCE per fan-out, even though each connection
    // gets its own send. The envelope's `id` is a server-minted UUID
    // (per `ws_message_envelope` for unsolicited server-emitted
    // messages); reusing the same `id` across the fan-out is the
    // intended behaviour — every subscriber sees the SAME broadcast,
    // and a server log line can correlate the fan-out by the single
    // message id.
    const envelope: WsEnvelope<'event-applied'> = {
      type: 'event-applied',
      id: randomUUID(),
      payload: { event },
    };

    for (const connectionId of connectionIds) {
      const sender = opts.connectionSenders.get(connectionId);
      if (sender === undefined) {
        // The connection was unregistered between the registry
        // snapshot and this iteration (the close hook ran). Skip —
        // not an error.
        continue;
      }
      try {
        sender(envelope);
      } catch (err) {
        // Per-connection error isolation. The sender may throw on a
        // socket already torn down (the ws library can throw if
        // `.send()` is called on a CLOSING / CLOSED socket on some
        // Node versions). Log + continue so other subscribers receive
        // the broadcast.
        opts.log.warn(
          {
            err,
            connectionId,
            sessionId,
            messageId: envelope.id,
            eventKind: event.kind,
            eventSequence: event.sequence,
          },
          'ws-broadcast-send-failed — skipping connection (one bad socket does not break fan-out)',
        );
      }
    }
  };
}

/**
 * Fastify plugin: register the `event-applied` broadcast listener
 * against `app.wsBroadcast`. The plugin depends on:
 *
 *   - `wsBroadcastPlugin` — provides `app.wsBroadcast` (the bus).
 *   - `wsConnectionSendersPlugin` — provides `app.wsConnectionSenders`.
 *   - `wsSubscriptionsPlugin` — provides `app.wsSubscriptions`.
 *
 * All three are registered transitively when this plugin is
 * registered via `wsConnectionHandlingPlugin` (which composes them).
 * The defensive `hasDecorator` check on this plugin's own decorator
 * (none today — we don't decorate, we just register a listener)
 * leaves the door open for future re-registration patterns; for now,
 * each `createServer()` call gets its own listener.
 *
 * The listener's lifetime is the app's lifetime — when the app closes,
 * the bus is GC'd and the listener with it. No explicit unsubscribe is
 * needed.
 */
const wsEventAppliedBroadcastPluginAsync: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Register transitively-required decorators so this plugin can be
  // registered standalone in a test app without the caller having to
  // remember the registration order. The plugin wrappers are
  // idempotent (each plugin's body checks `hasDecorator` first).
  await app.register(wsBroadcastPlugin);
  await app.register(wsConnectionSendersPlugin);

  // Bind the listener. The bus dispatches synchronously to every
  // listener; this listener is the only consumer today, but the
  // bus's design allows additional listeners (audit logs, metrics,
  // a future cluster-fanout layer) without rewiring the routes.
  app.wsBroadcast.on(
    'event-applied',
    buildEventAppliedBroadcastListener({
      subscriptions: app.wsSubscriptions,
      connectionSenders: app.wsConnectionSenders,
      log: app.log,
    }),
  );
};

export const wsEventAppliedBroadcastPlugin = fp(wsEventAppliedBroadcastPluginAsync, {
  name: 'a-conversa-ws-event-applied-broadcast',
  fastify: '5.x',
});
