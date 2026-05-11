// `diagnostic` broadcast subscriber — bridge the projection-layer
// `DiagnosticBus` to the WS fan-out surface.
//
// Refinement: tasks/refinements/backend/ws_diagnostic_broadcast.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_diagnostic_broadcast
//
// **What this module owns.**
//
//   1. `wsDiagnosticBusPlugin` — decorates `app.diagnosticBus` with a
//      fresh `DiagnosticBus` per Fastify instance. Mirror of
//      `wsBroadcastPlugin` (the `event-applied` bus's decorator). The
//      bus's contract (`fired` / `cleared` per-entry, synchronous
//      dispatch) is owned by `apps/server/src/diagnostics/event-emission.ts`;
//      this plugin only wires it to the app.
//   2. `WsDiagnosticBroadcast` — a session-context-aware wrapper that
//      sits ATOP `DiagnosticBus`. Exposes `notifyForSession(sessionId,
//      sequence, prev, next)` as the one entry point the projection-
//      cache wiring (a future task) will call AFTER `applyEvent` re-
//      computes the diagnostic snapshot. Sets an internal active-
//      context map before calling `bus.notify(prev, next)` so the
//      fan-out listener can read sessionId/sequence in the per-entry
//      callback; clears the context in a `finally`.
//   3. `buildDiagnosticBroadcastListener(...)` — the pure listener
//      builder that closes over the subscriptions registry + the
//      connection-sender registry + the active-context accessor + a
//      logger, returns a `(status, entry) => void` closure suitable
//      for registration against `bus.on('fired', ...)` and
//      `bus.on('cleared', ...)`. Pure so the fan-out behaviour is
//      unit-testable without standing up a Fastify instance.
//   4. `wsDiagnosticBroadcastPlugin` — the Fastify plugin that wires
//      everything: registers the dependencies (`wsBroadcastPlugin`,
//      `wsConnectionSendersPlugin`, `wsDiagnosticBusPlugin`),
//      decorates `app.wsDiagnosticBroadcast` with the session-context-
//      aware wrapper, and registers the listeners on
//      `app.diagnosticBus`'s `'fired'` and `'cleared'` events.
//
// **Why a context-setter pattern (vs. carrying sessionId/sequence on
// each `DiagnosticEntry`).** The `DiagnosticBus` was defined to emit
// per-entry without session context — see
// `apps/server/src/diagnostics/event-emission.ts`'s comment block.
// Modifying that contract would force every existing consumer (the
// diagnostics' own unit tests, the future moderator-UI direct
// consumer, etc.) to either accept a wider entry shape or break.
// The session-aware wrapper here lets the bridge layer inject
// context WITHOUT changing the underlying bus's contract: the bus
// stays per-entry, the wrapper threads context through a closure-
// captured holder set immediately before `bus.notify(...)` and
// cleared immediately after.
//
// The pattern is safe because `DiagnosticBus.notify(...)` dispatches
// SYNCHRONOUSLY. The `notifyForSession(...)` call returns AFTER the
// last listener finished; the active-context holder is cleared in a
// `finally` so a thrown listener doesn't leak context to a subsequent
// notify call.
//
// **Wire shape pass-through.** The `diagnostic` envelope's `diagnostic`
// field carries the full `DiagnosticEntry` from
// `apps/server/src/diagnostics/event-emission.ts` verbatim — no
// reshaping, no flattening. A receiver that already knows how to
// render a `DiagnosticEntry` can render the broadcast directly. The
// outer envelope's `kind` / `severity` / `status` / `sessionId` /
// `sequence` fields are derived (kind from `entry.kind`, severity
// from `classifyDiagnostic(entry)`, status from which bus event
// fired, sessionId + sequence from the active context).
//
// **Ordering relative to `event-applied`.** The projection-cache
// wiring (a separate downstream task) will call
// `applyEvent → wsBroadcast.emit({event}) → wsDiagnosticBroadcast.notifyForSession(prev, next)`
// in that order — both AFTER the `session_events` INSERT commits.
// Therefore subscribed clients see `event-applied(N)` BEFORE
// `diagnostic` envelopes derived from the post-N projection. The
// invariant is preserved by:
//
//   1. The `event-applied` bus dispatches synchronously.
//   2. The diagnostic listener fans out to per-connection senders
//      synchronously.
//   3. `notifyForSession` runs AFTER the projection has the new
//      event applied (the projection-cache wiring orders this).
//
// Cross-broadcast ordering across multiple events is FIFO per session
// per connection.
//
// **Per-connection error isolation.** Same contract as
// `event-applied`: one bad socket logs at warn and the iteration
// continues. The diagnostic broadcasts MUST NOT crash on a per-
// connection send failure.
//
// **Why this complements (not duplicates) the structured-error
// envelope from `ws_error_message`.** Errors are per-client request-
// failure responses, correlated via `inResponseTo` to a specific
// client envelope (bad request, permission denied, methodology
// rejection). Diagnostics are session-wide derived signals from the
// projection layer — they fire even when no client made a request
// (e.g., a remote moderator's event triggers a contradiction for
// every subscribed participant). The two are deliberately separate
// envelopes with distinct semantics; collapsing them would force
// receivers to disambiguate "what did I request that errored" from
// "what does the system want me to notice about the session state."

import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import type { WsEnvelope, WsDiagnosticKind } from '@a-conversa/shared-types';

import {
  classifyDiagnostic,
  DiagnosticBus,
  type DiagnosticEntry,
  type Severity,
} from '../../diagnostics/index.js';
import { wsBroadcastPlugin } from './bus.js';
import { wsConnectionSendersPlugin, type WsConnectionSenderRegistry } from './connections.js';
import type { WsSubscriptionRegistry } from '../subscriptions.js';

/** The status discriminator. Mirror of `DiagnosticBusEvent`. */
export type DiagnosticBroadcastStatus = 'fired' | 'cleared';

/**
 * Active context the session-aware wrapper sets before calling
 * `bus.notify(...)`. The fan-out listener reads it inside its per-
 * entry callback. Holder is a single-slot box (not a stack) because
 * `DiagnosticBus.notify` dispatches synchronously — re-entrant calls
 * are not possible inside a single thread, and explicitly nested
 * notify calls would be a programmer error (the projection-cache
 * wiring drives a single `applyEvent` at a time).
 */
export interface DiagnosticBroadcastActiveContext {
  readonly sessionId: string;
  readonly sequence: number;
}

/**
 * Options for `buildDiagnosticBroadcastListener`. Captures the
 * subscription registry, the connection-sender registry, an accessor
 * for the active context (the wrapper's mutable slot), and the
 * logger for the per-connection warn-level error-isolation path.
 */
export interface DiagnosticBroadcastListenerOptions {
  /** Per-app-instance subscription registry. */
  readonly subscriptions: WsSubscriptionRegistry;
  /** Per-app-instance connection-sender registry. */
  readonly connectionSenders: WsConnectionSenderRegistry;
  /**
   * Accessor for the active context. Reads the wrapper's mutable
   * slot at listener-fire time. Returns `undefined` when no
   * `notifyForSession` is currently in flight — defensive against a
   * raw `bus.notify(...)` call that bypassed the wrapper (which
   * would be a programmer error; logged + skipped, not crashed).
   */
  readonly getActiveContext: () => DiagnosticBroadcastActiveContext | undefined;
  /** Logger for the per-connection error-isolation + missing-context path. */
  readonly log: FastifyBaseLogger;
}

/**
 * Listener signature for the bus's `'fired'` / `'cleared'` events,
 * narrowed to the broadcast surface's contract. The status discriminator
 * is curried in by the registration site (one listener per status).
 */
export type DiagnosticBroadcastListener = (entry: DiagnosticEntry) => void;

/**
 * Build a pair of listeners (`fired` + `cleared`) that fan out a
 * `diagnostic` envelope to every WS connection subscribed to the
 * active-context session. Returned as a builder so the listener's
 * dependencies are explicit + so the fan-out is unit-testable
 * without a Fastify instance.
 *
 * The returned object exposes one listener per bus event. Each one:
 *
 *   1. Reads the active context (sessionId + sequence). If missing,
 *      logs at warn and returns — defensive against the raw-bus
 *      bypass case (a future consumer that calls `bus.notify(...)`
 *      directly without going through `notifyForSession`).
 *   2. Looks up `connectionsForSession(sessionId)`.
 *   3. Builds the `diagnostic` envelope (one per fan-out, server-
 *      minted UUID) and sends it to every subscribed connection via
 *      `wsConnectionSenders.get(connectionId)`. Per-connection
 *      try/catch isolates one bad socket from the rest.
 */
export function buildDiagnosticBroadcastListener(opts: DiagnosticBroadcastListenerOptions): {
  fired: DiagnosticBroadcastListener;
  cleared: DiagnosticBroadcastListener;
} {
  function dispatch(status: DiagnosticBroadcastStatus, entry: DiagnosticEntry): void {
    const ctx = opts.getActiveContext();
    if (ctx === undefined) {
      // The bus was notified without going through the session-aware
      // wrapper. Without session context we have no fan-out target.
      // This is a programmer error in the caller (raw `bus.notify`
      // bypassing `notifyForSession`); log so the seam is visible
      // and skip the entry. The bus's other listeners (if any) still
      // received the entry — we're only declining to fan out.
      opts.log.warn(
        { status, entryKind: entry.kind },
        'ws-diagnostic-broadcast: bus fired without active session context — skipping fan-out',
      );
      return;
    }

    const { sessionId, sequence } = ctx;
    const connectionIds = opts.subscriptions.connectionsForSession(sessionId);
    if (connectionIds.length === 0) {
      // No subscribers — nothing to fan out. The bus's other
      // listeners still ran.
      return;
    }

    const severity: Severity = classifyDiagnostic(entry);
    const envelope: WsEnvelope<'diagnostic'> = {
      type: 'diagnostic',
      id: randomUUID(),
      payload: {
        sessionId,
        kind: entry.kind satisfies WsDiagnosticKind,
        severity,
        status,
        sequence,
        // Pass-through verbatim. The wire schema accepts
        // `z.unknown()` here; the inner type is owned by
        // `event-emission.ts`'s `DiagnosticEntry` union. A receiver
        // already familiar with that shape can render the
        // broadcast directly.
        diagnostic: entry,
      },
    };

    for (const connectionId of connectionIds) {
      const sender = opts.connectionSenders.get(connectionId);
      if (sender === undefined) {
        // Close-race window — the connection was unregistered
        // between the registry snapshot and this iteration. Skip
        // silently; logging every close would flood the operator's
        // attention surface for a benign condition (parallel to
        // `event-applied`'s contract).
        continue;
      }
      try {
        sender(envelope);
      } catch (err) {
        // Per-connection error isolation. The diagnostic broadcast
        // surface MUST NOT crash on a per-connection send failure —
        // one bad socket logs at warn and the iteration continues.
        opts.log.warn(
          {
            err,
            connectionId,
            sessionId,
            messageId: envelope.id,
            diagnosticKind: entry.kind,
            diagnosticStatus: status,
            sequence,
          },
          'ws-diagnostic-broadcast send failed — skipping connection (one bad socket does not break fan-out)',
        );
      }
    }
  }

  return {
    fired: (entry) => dispatch('fired', entry),
    cleared: (entry) => dispatch('cleared', entry),
  };
}

/**
 * Session-context-aware wrapper around `DiagnosticBus`. Exposes a
 * single `notifyForSession(sessionId, sequence, prev, next)` entry
 * point the projection-cache wiring (a future task) will call AFTER
 * `applyEvent` re-computes the diagnostic snapshot.
 *
 * The wrapper's contract:
 *
 *   1. Set the active context to `{sessionId, sequence}`.
 *   2. Call `bus.notify(prev, next)` — synchronous dispatch fires the
 *      registered `fired` / `cleared` listeners (including the WS
 *      fan-out listener registered by `wsDiagnosticBroadcastPlugin`).
 *   3. Clear the active context in `finally`. A throwing listener
 *      propagates to the caller (matching `DiagnosticBus`'s
 *      rethrow contract); the `finally` ensures the context never
 *      leaks across notify calls.
 *
 * Re-entrant calls (`notifyForSession` from inside a listener) are
 * not supported — the active context is a single slot. The
 * projection-cache wiring drives a single `applyEvent` at a time, so
 * this is not a practical limitation.
 */
export class WsDiagnosticBroadcast {
  readonly #bus: DiagnosticBus;
  #activeContext: DiagnosticBroadcastActiveContext | undefined;

  constructor(bus: DiagnosticBus) {
    this.#bus = bus;
  }

  /** Accessor used by the listener builder. */
  getActiveContext(): DiagnosticBroadcastActiveContext | undefined {
    return this.#activeContext;
  }

  /**
   * Notify the bus with session context. The bus dispatches
   * synchronously; the fan-out listener reads the context from this
   * wrapper to build the wire envelope. The context is cleared in a
   * `finally` so a throwing listener doesn't leak context.
   *
   * @param sessionId the session the diagnostics are for.
   * @param sequence  the event-log sequence at which the diagnostics
   *                  were re-computed. Carried on every fan-out
   *                  envelope so receivers can correlate the
   *                  diagnostic delta with the prior `event-applied`
   *                  frame.
   * @param prev      previous diagnostic snapshot (before `applyEvent`).
   * @param next      next diagnostic snapshot (after `applyEvent`).
   */
  notifyForSession(
    sessionId: string,
    sequence: number,
    prev: DiagnosticEntry[],
    next: DiagnosticEntry[],
  ): void {
    this.#activeContext = { sessionId, sequence };
    try {
      this.#bus.notify(prev, next);
    } finally {
      this.#activeContext = undefined;
    }
  }
}

/**
 * Fastify plugin: decorate `app.diagnosticBus` with a fresh
 * `DiagnosticBus`. Mirror of `wsBroadcastPlugin` — `fastify-plugin`-
 * wrapped so the decoration reaches the root scope, idempotent
 * against re-registration.
 *
 * The bus alone is not enough to put diagnostic broadcasts on the
 * wire — `wsDiagnosticBroadcastPlugin` (below) registers the fan-out
 * listener AND the session-aware wrapper. This plugin owns only the
 * bus primitive so callers that need a `DiagnosticBus` without the
 * WS fan-out (the projection-cache wiring's tests, future audit
 * consumers) can depend on the lighter decoration.
 */
const wsDiagnosticBusPluginAsync: FastifyPluginAsync = (app: FastifyInstance) => {
  if (!app.hasDecorator('diagnosticBus')) {
    app.decorate('diagnosticBus', new DiagnosticBus());
  }
  return Promise.resolve();
};

export const wsDiagnosticBusPlugin = fp(wsDiagnosticBusPluginAsync, {
  name: 'a-conversa-ws-diagnostic-bus',
  fastify: '5.x',
});

/**
 * Fastify plugin: wire the diagnostic broadcast surface end-to-end.
 *
 *   1. Register transitively-required decorators
 *      (`wsBroadcastPlugin`, `wsConnectionSendersPlugin`,
 *      `wsDiagnosticBusPlugin`). Each is idempotent — the plugins'
 *      bodies check `hasDecorator` first — so calling this plugin
 *      standalone in a test app doesn't require the caller to
 *      pre-register the dependencies in any specific order.
 *   2. Decorate `app.wsDiagnosticBroadcast` with the session-aware
 *      wrapper. The projection-cache wiring (a future task) will
 *      call `app.wsDiagnosticBroadcast.notifyForSession(...)` to
 *      drive the fan-out.
 *   3. Register the `fired` + `cleared` listeners on
 *      `app.diagnosticBus`. The listener pair reads the active
 *      context from the wrapper at fire time.
 *
 * The listener's lifetime is the app's lifetime; when the app
 * closes, the bus is GC'd and the listeners with it. No explicit
 * unsubscribe is needed.
 */
const wsDiagnosticBroadcastPluginAsync: FastifyPluginAsync = async (app: FastifyInstance) => {
  await app.register(wsBroadcastPlugin);
  await app.register(wsConnectionSendersPlugin);
  await app.register(wsDiagnosticBusPlugin);

  if (!app.hasDecorator('wsDiagnosticBroadcast')) {
    const wrapper = new WsDiagnosticBroadcast(app.diagnosticBus);
    app.decorate('wsDiagnosticBroadcast', wrapper);
  }

  // Bind the fan-out listeners. The accessor closes over `app` so
  // future re-decoration via `hasDecorator` would still resolve to
  // the same wrapper instance.
  const listeners = buildDiagnosticBroadcastListener({
    subscriptions: app.wsSubscriptions,
    connectionSenders: app.wsConnectionSenders,
    getActiveContext: () => app.wsDiagnosticBroadcast.getActiveContext(),
    log: app.log,
  });
  app.diagnosticBus.on('fired', listeners.fired);
  app.diagnosticBus.on('cleared', listeners.cleared);
};

export const wsDiagnosticBroadcastPlugin = fp(wsDiagnosticBroadcastPluginAsync, {
  name: 'a-conversa-ws-diagnostic-broadcast',
  fastify: '5.x',
});

// -- TypeScript augmentation ---------------------------------------
//
// Adds the `diagnosticBus` + `wsDiagnosticBroadcast` fields to
// `FastifyInstance`. Co-located with the runtime module — same
// trade-off as `dispatcher.ts` / `subscriptions.ts` / `bus.ts`.

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * The per-app-instance diagnostic bus. The projection-cache
     * wiring (a future task) calls `app.diagnosticBus.notify(...)`
     * — or, when session context is available,
     * `app.wsDiagnosticBroadcast.notifyForSession(...)` — to fire
     * registered listeners. The WS fan-out listener registered by
     * `wsDiagnosticBroadcastPlugin` is the today's only consumer;
     * the bus's design allows additional listeners (audit, metrics,
     * a future cluster-fanout layer) without rewiring callers.
     */
    diagnosticBus: DiagnosticBus;
    /**
     * Session-context-aware wrapper around `diagnosticBus`. The
     * projection-cache wiring calls
     * `app.wsDiagnosticBroadcast.notifyForSession(sessionId,
     * sequence, prev, next)` AFTER `applyEvent` re-computes the
     * diagnostic snapshot. The wrapper sets the active context the
     * fan-out listener reads at fire time.
     */
    wsDiagnosticBroadcast: WsDiagnosticBroadcast;
  }
}
