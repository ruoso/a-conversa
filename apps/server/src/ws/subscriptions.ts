// In-process per-(connection, session) subscription registry + plugin.
//
// Refinement: tasks/refinements/backend/ws_subscribe_to_session.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_subscribe_to_session
//
// **What this module owns.**
//
// `WsSubscriptionRegistry` — a per-server-instance bookkeeping table
// that records which authenticated connections are subscribed to which
// sessions. Used by:
//
//   1. The `subscribe` / `unsubscribe` message handlers (this task's
//      siblings under `./handlers/`) — they call `subscribe(...)` /
//      `unsubscribe(...)` after the visibility gate clears.
//   2. The connection-close path in `connection.ts` — calls
//      `removeConnection(connectionId)` so a dropped socket doesn't
//      leave dangling subscriptions in the registry.
//   3. The future `ws_event_broadcast` task — will reach for
//      `connectionsForSession(sessionId)` to iterate the connections
//      that should receive a fan-out frame.
//
// **Storage shape — bidirectional maps.** Two `Map<string, Set<string>>`
// tables:
//
//   - `bySession: Map<sessionId, Set<connectionId>>`
//   - `byConnection: Map<connectionId, Set<sessionId>>`
//
// The two tables together turn every public-surface operation into
// O(1) on the relevant index:
//
//   - `subscribe(conn, sess)` — two `Set.add` calls.
//   - `unsubscribe(conn, sess)` — two `Set.delete` calls.
//   - `connectionsForSession(sess)` — one `Map.get`.
//   - `sessionsForConnection(conn)` — one `Map.get`.
//   - `removeConnection(conn)` — iterate `byConnection.get(conn)` once,
//     remove the connection from each session's set, then delete the
//     connection's entry.
//
// Single-map alternatives (e.g. only `bySession` + a scan in
// `removeConnection`) would force O(N_sessions) on close, which is the
// hottest path under churn (every disconnected client triggers it).
// Two-map storage trades a tiny memory overhead (the connection side
// duplicates the membership info) for predictable close-time cost.
//
// **In-process / per-instance.** This registry lives in the server
// process. A horizontally-scaled deployment (multiple `apps/server`
// instances behind a load-balancer) would NOT see broadcasts emitted on
// one instance reach subscribers connected to another — each registry
// is local to its instance. **Clustering / multi-instance fan-out is
// out of scope for this task.** Two future paths recover the property:
//
//   1. `ws_reconnection_handling` lets a client reconnect (to any
//      instance) and replay state from the data-model. The new
//      instance reconstructs the subscription via the same
//      `subscribe` handler — visibility is re-checked, the registry
//      is repopulated locally.
//   2. A future cluster-fanout layer (NOT specified yet — out of
//      scope for the M3 milestone) would publish broadcasts to a
//      message bus that every instance subscribes to. The registry's
//      shape doesn't change; the broadcast surface does.
//
// **Idempotence.** `subscribe(conn, sess)` is idempotent — re-subscribing
// is a no-op. `unsubscribe(conn, sess)` is idempotent — unsubscribing
// from a tuple that isn't in the registry is a no-op. The handlers
// emit the ack envelope in both cases (the client's request-response
// correlation stays consistent regardless of registry state).

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Per-server-instance subscription registry. Maintains two indices
 * (session → connections, connection → sessions) so every public-API
 * operation is O(1) on the relevant side.
 *
 * Created by `wsSubscriptionsPlugin` and decorated onto
 * `app.wsSubscriptions`; sibling plugins (handlers, the broadcast
 * surface) reach for it via `app.wsSubscriptions.<method>(...)`.
 */
export class WsSubscriptionRegistry {
  /** sessionId -> set of connectionIds subscribed to that session. */
  private readonly bySession = new Map<string, Set<string>>();
  /** connectionId -> set of sessionIds the connection is subscribed to. */
  private readonly byConnection = new Map<string, Set<string>>();

  /**
   * Add a (connection, session) subscription. Idempotent — calling
   * twice with the same tuple is a no-op (the underlying `Set.add`
   * is itself idempotent; both indices remain consistent).
   *
   * @param connectionId the WS connection's stable id (the
   *                     `WsConnectionContext.connectionId`).
   * @param sessionId the session id the client wants events for.
   */
  subscribe(connectionId: string, sessionId: string): void {
    let conns = this.bySession.get(sessionId);
    if (conns === undefined) {
      conns = new Set();
      this.bySession.set(sessionId, conns);
    }
    conns.add(connectionId);

    let sessions = this.byConnection.get(connectionId);
    if (sessions === undefined) {
      sessions = new Set();
      this.byConnection.set(connectionId, sessions);
    }
    sessions.add(sessionId);
  }

  /**
   * Remove a (connection, session) subscription. Idempotent —
   * unsubscribing a tuple that isn't in the registry is a no-op.
   * Empty sets are pruned (the map entry is deleted) so the registry
   * doesn't leak per-session or per-connection allocations after
   * churn.
   *
   * @param connectionId the WS connection's stable id.
   * @param sessionId the session id to stop streaming.
   */
  unsubscribe(connectionId: string, sessionId: string): void {
    const conns = this.bySession.get(sessionId);
    if (conns !== undefined) {
      conns.delete(connectionId);
      if (conns.size === 0) {
        this.bySession.delete(sessionId);
      }
    }
    const sessions = this.byConnection.get(connectionId);
    if (sessions !== undefined) {
      sessions.delete(sessionId);
      if (sessions.size === 0) {
        this.byConnection.delete(connectionId);
      }
    }
  }

  /**
   * Snapshot of the connections subscribed to `sessionId`. Returned as
   * a fresh array (NOT a live view into the internal Set) so callers
   * iterating the snapshot can't mutate the registry mid-iteration —
   * important for the future broadcast surface, which may emit frames
   * that trigger re-entrant `unsubscribe` calls from misbehaving
   * clients.
   *
   * Empty array when nothing is registered for the session — does NOT
   * distinguish "no one subscribed" from "session doesn't exist". The
   * registry is a routing table, not a session-existence oracle; the
   * `canSeeSession` predicate (called by the handler before
   * `subscribe`) is the one that answers existence + visibility.
   *
   * @returns a readonly snapshot of subscribed connection ids.
   */
  connectionsForSession(sessionId: string): readonly string[] {
    const conns = this.bySession.get(sessionId);
    return conns === undefined ? [] : [...conns];
  }

  /**
   * Snapshot of the sessions `connectionId` is subscribed to. Same
   * snapshot semantics as `connectionsForSession`. Used by the
   * connection-close path to log what was dropped + by tests to assert
   * the post-conditions of the lifecycle.
   *
   * @returns a readonly snapshot of subscribed session ids.
   */
  sessionsForConnection(connectionId: string): readonly string[] {
    const sessions = this.byConnection.get(connectionId);
    return sessions === undefined ? [] : [...sessions];
  }

  /**
   * Drop every subscription held by `connectionId`. Called by the
   * connection-close hook in `connection.ts` so a dropped socket
   * doesn't leak entries in either index.
   *
   * Iterates the snapshot once (O(N_sessions) where N is the number
   * of sessions THIS connection subscribed to — typically 1, since a
   * client usually subscribes to the one session it's participating
   * in). Each iteration is O(1) — a `Set.delete` on the
   * by-session index and possibly a `Map.delete` to prune.
   *
   * Idempotent — calling with an unknown connection id is a no-op.
   */
  removeConnection(connectionId: string): void {
    const sessions = this.byConnection.get(connectionId);
    if (sessions === undefined) {
      return;
    }
    for (const sessionId of sessions) {
      const conns = this.bySession.get(sessionId);
      if (conns !== undefined) {
        conns.delete(connectionId);
        if (conns.size === 0) {
          this.bySession.delete(sessionId);
        }
      }
    }
    this.byConnection.delete(connectionId);
  }
}

/**
 * Fastify plugin: construct a `WsSubscriptionRegistry` per app instance
 * and decorate it onto `app.wsSubscriptions`. Mirror of the
 * `wsDispatcherPlugin` pattern — `fastify-plugin`-wrapped so the
 * decoration reaches the root scope, idempotent against re-registration.
 *
 * Each `createServer()` call gets its own registry; tests build a fresh
 * app per scenario, so there's no cross-test bleed.
 */
const wsSubscriptionsPluginAsync: FastifyPluginAsync = (app: FastifyInstance) => {
  // Guard against re-decoration. Production registers the plugin once;
  // a defensive check keeps the failure mode explicit if a future test
  // pattern lands a second `createServer()` against the same instance.
  if (!app.hasDecorator('wsSubscriptions')) {
    app.decorate('wsSubscriptions', new WsSubscriptionRegistry());
  }
  return Promise.resolve();
};

export const wsSubscriptionsPlugin = fp(wsSubscriptionsPluginAsync, {
  name: 'a-conversa-ws-subscriptions',
  fastify: '5.x',
});

// -- TypeScript augmentation ---------------------------------------
//
// Adds the `wsSubscriptions` field to `FastifyInstance`. Co-located
// with the runtime module (same trade-off `dispatcher.ts` makes —
// the type is owned here, so the augmentation lives here).

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * The per-app-instance WS subscription registry. The `subscribe`
     * and `unsubscribe` message handlers reach for `subscribe(...)` /
     * `unsubscribe(...)`; the connection-close hook calls
     * `removeConnection(...)`; the future `ws_event_broadcast` task
     * will use `connectionsForSession(...)` to iterate broadcast
     * targets.
     */
    wsSubscriptions: WsSubscriptionRegistry;
  }
}
