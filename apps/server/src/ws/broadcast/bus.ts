// WS broadcast bus — in-process pub/sub for `event-applied` notifications.
//
// Refinement: tasks/refinements/backend/ws_event_broadcast.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_event_broadcast
//
// **Why this module exists.** Every event-append site in
// `apps/server/src/sessions/routes.ts` (and any future appender) needs
// to inform the WS broadcast surface so subscribed clients receive an
// `event-applied` envelope. Two architectural shapes were considered:
//
//   - **Bus (this module).** Routes publish to an `EventEmitter`-like
//     bus AFTER their INSERT commits; the WS broadcast subscriber
//     listens + fans out to `app.wsSubscriptions.connectionsForSession`.
//     Decoupled — routes don't reach into the WS surface.
//   - **Direct call.** Routes call `app.wsBroadcast.applyEvent(event)`
//     directly. Less indirection but tighter coupling.
//
// The bus shape was picked. Rationale: it mirrors the existing
// `DiagnosticBus` (`apps/server/src/diagnostics/event-emission.ts`),
// keeping the codebase's pub/sub vocabulary uniform. Adding a second
// downstream consumer of the same event-append signal (audit logs,
// metrics, the future cluster-fanout layer) only requires another
// `.on('event-applied', ...)` registration; the routes don't change.
//
// **Synchronous dispatch, FIFO.** Listeners are invoked synchronously
// in registration order, mirroring `DiagnosticBus`. The synchronous
// contract is what guarantees per-session ordering: routes call
// `emit(...)` AFTER their INSERT commits in the same logical request;
// because the bus dispatches synchronously to listeners, the broadcast
// subscriber sees events in the same order routes publish them, which
// is the same order Postgres committed them under the per-session
// serialisation (FOR UPDATE row lock + UNIQUE (session_id, sequence)).
//
// **Per-app-instance.** A `WsBroadcastBus` is created by
// `wsBroadcastPlugin` and decorated onto `app.wsBroadcast`. Module-
// scoped state would carry listeners across `createServer()` instances
// — tests would interfere with each other. Each Fastify instance gets
// its own bus.
//
// **Error containment is the SUBSCRIBER's job, not the bus's.** The
// bus dispatches synchronously and lets exceptions propagate to the
// `emit(...)` caller (matching `DiagnosticBus`'s contract). The
// `event-applied` subscriber catches per-connection send failures so
// one bad socket doesn't break the fan-out — error isolation lives in
// `./event-applied.ts`, not here. Keeping the bus error-policy-free
// makes it composable with future subscribers that may want different
// semantics.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import type { Event } from '@a-conversa/shared-types';

/**
 * The single event the bus carries today. Carries the appended event
 * verbatim. `sessionId` lives on the inner envelope already
 * (`event.sessionId`); the broadcast subscriber reads it from there to
 * route fan-out via `app.wsSubscriptions.connectionsForSession(...)`.
 */
export interface EventAppliedBusEvent {
  /** The event that was just appended to `session_events` and committed. */
  readonly event: Event;
}

/** Event name on the `WsBroadcastBus`. Closed over a single string today. */
export type WsBroadcastBusEventName = 'event-applied';

/** Listener signature on the bus. */
export type WsBroadcastListener = (evt: EventAppliedBusEvent) => void;

/**
 * In-process pub/sub for `event-applied` notifications.
 *
 * Mirror of `DiagnosticBus`'s shape — synchronous dispatch, listener
 * snapshot before iteration (so a listener unsubscribing itself
 * doesn't disturb the iteration), `on(...)` returns an unsubscribe
 * function.
 *
 * Usage:
 *
 * ```ts
 * const bus = new WsBroadcastBus();
 * const off = bus.on('event-applied', ({ event }) => render(event));
 * bus.emit({ event });
 * off();
 * ```
 *
 * The caller (the route's transaction wrapper or the centralized
 * `appendSessionEvent` helper) is responsible for emitting AFTER the
 * `session_events` INSERT commits. Emitting before commit would break
 * the ordering invariant — a subscriber might fan out a frame the DB
 * later rolls back.
 */
export class WsBroadcastBus {
  readonly #eventAppliedListeners: WsBroadcastListener[] = [];

  /**
   * Register a listener for the bus's `event-applied` event. Returns
   * an unsubscribe function that removes the listener when called.
   * The same function may be registered more than once; each
   * registration produces a separate dispatch and a separate
   * unsubscribe handle.
   */
  on(event: WsBroadcastBusEventName, listener: WsBroadcastListener): () => void {
    if (event !== 'event-applied') {
      // Defensive — the union has one entry today. Adding a second
      // event later will land another branch here. The runtime check
      // catches a TS-bypassed string literal at the seam. `event` is
      // typed `never` at this point because the equality check
      // narrowed it out of the singleton union; cast to string for
      // the diagnostic message.
      throw new Error(`unsupported WsBroadcastBus event: ${String(event)}`);
    }
    this.#eventAppliedListeners.push(listener);
    return () => {
      const idx = this.#eventAppliedListeners.indexOf(listener);
      if (idx !== -1) {
        // Splice (not reassign) so an in-flight emit's snapshot sees
        // the same listener set its iteration started against. JS
        // arrays' splice-during-iteration is well-defined; the
        // snapshot pattern below makes the semantics explicit.
        this.#eventAppliedListeners.splice(idx, 1);
      }
    };
  }

  /**
   * Synchronously dispatch an `event-applied` notification to every
   * registered listener. Listeners fire in registration order. A
   * throwing listener propagates to the caller (per `DiagnosticBus`
   * — error containment is the subscriber's job).
   *
   * Callers MUST invoke this AFTER the `session_events` INSERT
   * commits. The ordering invariant the subscribed clients rely on
   * (per-session FIFO) is upheld by:
   *
   *   1. The route's transaction serialises appends for the same
   *      session via `FOR UPDATE` on the sessions row (ADR 0020).
   *   2. The route emits to the bus AFTER COMMIT, in the same code
   *      path that allocated the sequence.
   *   3. The bus dispatches synchronously, so subscribers see events
   *      in the same order routes emitted them.
   */
  emit(evt: EventAppliedBusEvent): void {
    // Snapshot the listener list before dispatch so a listener that
    // unsubscribes itself doesn't disturb the iteration. New
    // registrations from within a listener fire on the NEXT emit, not
    // this one.
    const listeners = [...this.#eventAppliedListeners];
    for (const listener of listeners) {
      listener(evt);
    }
  }

  /** Number of registered listeners for the given event. */
  listenerCount(event: WsBroadcastBusEventName): number {
    if (event !== 'event-applied') return 0;
    return this.#eventAppliedListeners.length;
  }
}

/**
 * Fastify plugin: construct a `WsBroadcastBus` per app instance and
 * decorate it onto `app.wsBroadcast`. Mirror of `wsDispatcherPlugin` /
 * `wsSubscriptionsPlugin`: `fastify-plugin`-wrapped so the decoration
 * reaches the root scope, idempotent against re-registration.
 *
 * The bus alone is not enough to make broadcasts arrive on the wire —
 * a SUBSCRIBER must be wired to the bus that fans out frames over
 * connections. The subscriber is registered by
 * `wsEventAppliedBroadcastPlugin` in `./event-applied.ts`; this plugin
 * only owns the bus primitive.
 */
const wsBroadcastPluginAsync: FastifyPluginAsync = (app: FastifyInstance) => {
  if (!app.hasDecorator('wsBroadcast')) {
    app.decorate('wsBroadcast', new WsBroadcastBus());
  }
  return Promise.resolve();
};

export const wsBroadcastPlugin = fp(wsBroadcastPluginAsync, {
  name: 'a-conversa-ws-broadcast-bus',
  fastify: '5.x',
});

// -- TypeScript augmentation ---------------------------------------
//
// Adds the `wsBroadcast` field to `FastifyInstance`. The augmentation
// is co-located with the runtime module (same trade-off as
// `dispatcher.ts` / `subscriptions.ts`).

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * The per-app-instance WS broadcast bus. Routes publish
     * `event-applied` notifications via `app.wsBroadcast.emit(...)`
     * AFTER their `session_events` INSERT commits; the subscriber
     * wired by `wsEventAppliedBroadcastPlugin` listens + fans out
     * frames to every connection subscribed to the event's session.
     */
    wsBroadcast: WsBroadcastBus;
  }
}
