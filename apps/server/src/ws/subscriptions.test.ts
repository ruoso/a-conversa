// Vitest unit tests for the WS subscription registry.
//
// Refinement: tasks/refinements/backend/ws_subscribe_to_session.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_subscribe_to_session
//
// **What this file covers.** The pure-logic surface of
// `WsSubscriptionRegistry` — no I/O, no Fastify, no real sockets. The
// registry is a bookkeeping table; its contract is:
//
//   1. `subscribe` + `unsubscribe` are idempotent.
//   2. The two indices (`bySession` / `byConnection`) stay in lock-step:
//      after `subscribe(c, s)`, `connectionsForSession(s)` contains `c`
//      AND `sessionsForConnection(c)` contains `s`; after
//      `unsubscribe(c, s)`, neither contains the other entry.
//   3. `removeConnection(c)` wipes every entry mentioning `c` from both
//      indices.
//   4. Multiple connections per session + multiple sessions per
//      connection are independently supported.
//   5. Empty sets are pruned (the registry doesn't leak per-session or
//      per-connection allocations after churn).
//
// The handler-level integration (visibility gate + ack-on-the-wire) is
// covered separately in `handlers/subscribe.test.ts`. The wire-format
// end-to-end is covered in the cucumber feature.

import { describe, expect, it, vi } from 'vitest';

import type { FastifyBaseLogger } from 'fastify';

import type { WsEnvelopeUnion } from '@a-conversa/shared-types';

import type { VisibilityExecutor } from '../sessions/visibility.js';
import { WsConnectionSenderRegistry } from './broadcast/connections.js';
import { pruneSubscribersForPrivateSession, WsSubscriptionRegistry } from './subscriptions.js';

// Stable fixture ids — value doesn't matter, only that distinct ids are
// used for distinct connections / sessions. Mirrors the `MSG_ID` /
// `CONNECTION_ID` pattern in `dispatcher.test.ts`.
const CONN_A = '00000000-0000-4000-8000-0000000000a1';
const CONN_B = '00000000-0000-4000-8000-0000000000a2';
const CONN_C = '00000000-0000-4000-8000-0000000000a3';
const SESS_X = '00000000-0000-4000-8000-0000000000b1';
const SESS_Y = '00000000-0000-4000-8000-0000000000b2';
const SESS_Z = '00000000-0000-4000-8000-0000000000b3';

describe('WsSubscriptionRegistry — public-API invariants', () => {
  it('returns empty snapshots for unknown ids', () => {
    const reg = new WsSubscriptionRegistry();
    expect(reg.connectionsForSession(SESS_X)).toEqual([]);
    expect(reg.sessionsForConnection(CONN_A)).toEqual([]);
  });

  it('subscribe populates both indices', () => {
    const reg = new WsSubscriptionRegistry();
    reg.subscribe(CONN_A, SESS_X);

    // bidirectional invariant — both snapshots see the new tuple
    expect(reg.connectionsForSession(SESS_X)).toEqual([CONN_A]);
    expect(reg.sessionsForConnection(CONN_A)).toEqual([SESS_X]);
  });

  it('subscribe is idempotent — calling twice with the same tuple is a no-op', () => {
    const reg = new WsSubscriptionRegistry();
    reg.subscribe(CONN_A, SESS_X);
    reg.subscribe(CONN_A, SESS_X);
    // Snapshots are de-duped (the underlying Set is idempotent).
    expect(reg.connectionsForSession(SESS_X)).toEqual([CONN_A]);
    expect(reg.sessionsForConnection(CONN_A)).toEqual([SESS_X]);
  });

  it('unsubscribe removes the tuple from both indices', () => {
    const reg = new WsSubscriptionRegistry();
    reg.subscribe(CONN_A, SESS_X);
    reg.unsubscribe(CONN_A, SESS_X);
    // Both indices are wiped + empty sets are pruned. The snapshot
    // accessors return [] for a session / connection that's not in the
    // registry, but the pruning is what keeps long-lived registries
    // from leaking allocations after churn — assert via the snapshot
    // surface, which is the public contract.
    expect(reg.connectionsForSession(SESS_X)).toEqual([]);
    expect(reg.sessionsForConnection(CONN_A)).toEqual([]);
  });

  it('unsubscribe is idempotent — calling with an unknown tuple is a no-op', () => {
    const reg = new WsSubscriptionRegistry();
    // Calling on an empty registry must not throw.
    reg.unsubscribe(CONN_A, SESS_X);
    expect(reg.connectionsForSession(SESS_X)).toEqual([]);
    expect(reg.sessionsForConnection(CONN_A)).toEqual([]);

    // Calling on a partially-populated registry for a tuple that
    // isn't there must not affect the existing entries.
    reg.subscribe(CONN_B, SESS_Y);
    reg.unsubscribe(CONN_A, SESS_X);
    expect(reg.connectionsForSession(SESS_Y)).toEqual([CONN_B]);
    expect(reg.sessionsForConnection(CONN_B)).toEqual([SESS_Y]);
  });

  it('supports multiple connections per session', () => {
    const reg = new WsSubscriptionRegistry();
    reg.subscribe(CONN_A, SESS_X);
    reg.subscribe(CONN_B, SESS_X);
    reg.subscribe(CONN_C, SESS_X);

    // All three connections appear in the session's snapshot. Order
    // is not part of the contract — the snapshot is sourced from a
    // Set, which is insertion-ordered in JS, but we don't pin the
    // order here (toEqual on a sorted copy keeps the test robust).
    const conns = [...reg.connectionsForSession(SESS_X)].sort();
    expect(conns).toEqual([CONN_A, CONN_B, CONN_C].sort());

    // Each connection's snapshot only contains the one session it
    // subscribed to.
    expect(reg.sessionsForConnection(CONN_A)).toEqual([SESS_X]);
    expect(reg.sessionsForConnection(CONN_B)).toEqual([SESS_X]);
    expect(reg.sessionsForConnection(CONN_C)).toEqual([SESS_X]);
  });

  it('supports multiple sessions per connection', () => {
    const reg = new WsSubscriptionRegistry();
    reg.subscribe(CONN_A, SESS_X);
    reg.subscribe(CONN_A, SESS_Y);
    reg.subscribe(CONN_A, SESS_Z);

    const sessions = [...reg.sessionsForConnection(CONN_A)].sort();
    expect(sessions).toEqual([SESS_X, SESS_Y, SESS_Z].sort());

    expect(reg.connectionsForSession(SESS_X)).toEqual([CONN_A]);
    expect(reg.connectionsForSession(SESS_Y)).toEqual([CONN_A]);
    expect(reg.connectionsForSession(SESS_Z)).toEqual([CONN_A]);
  });

  it('removeConnection wipes every entry for the connection across both indices', () => {
    const reg = new WsSubscriptionRegistry();
    // Three sessions for CONN_A, two sessions for CONN_B (one of
    // which CONN_A also subscribes to so the index has cross-talk to
    // verify).
    reg.subscribe(CONN_A, SESS_X);
    reg.subscribe(CONN_A, SESS_Y);
    reg.subscribe(CONN_A, SESS_Z);
    reg.subscribe(CONN_B, SESS_X);
    reg.subscribe(CONN_B, SESS_Y);

    reg.removeConnection(CONN_A);

    // CONN_A is gone from every session.
    expect(reg.connectionsForSession(SESS_X)).toEqual([CONN_B]);
    expect(reg.connectionsForSession(SESS_Y)).toEqual([CONN_B]);
    // SESS_Z had only CONN_A — its set is now empty and pruned.
    expect(reg.connectionsForSession(SESS_Z)).toEqual([]);

    // CONN_A's own snapshot is empty.
    expect(reg.sessionsForConnection(CONN_A)).toEqual([]);

    // CONN_B is untouched.
    const bSessions = [...reg.sessionsForConnection(CONN_B)].sort();
    expect(bSessions).toEqual([SESS_X, SESS_Y].sort());
  });

  it('removeConnection on an unknown connection is a no-op', () => {
    const reg = new WsSubscriptionRegistry();
    reg.subscribe(CONN_B, SESS_X);

    // CONN_A was never subscribed; calling removeConnection on it
    // must not throw and must not affect CONN_B's entries.
    reg.removeConnection(CONN_A);
    expect(reg.connectionsForSession(SESS_X)).toEqual([CONN_B]);
    expect(reg.sessionsForConnection(CONN_B)).toEqual([SESS_X]);
  });

  it('returns fresh snapshot arrays — mutating one does not affect the registry', () => {
    // The contract is that `connectionsForSession` / `sessionsForConnection`
    // return a snapshot, NOT a live view into the internal Set. The
    // broadcast surface (future `ws_event_broadcast`) iterates these
    // snapshots and may re-enter the registry via misbehaving-client
    // unsubscribes; if the snapshot were a live view, the iteration
    // would skip entries.
    const reg = new WsSubscriptionRegistry();
    reg.subscribe(CONN_A, SESS_X);
    reg.subscribe(CONN_B, SESS_X);

    const snap = reg.connectionsForSession(SESS_X);
    // Mutating the snapshot must not affect the registry — the
    // `readonly` typing prevents this at the type level, but the
    // assertion below makes the runtime invariant explicit.
    (snap as string[]).length = 0;
    expect(reg.connectionsForSession(SESS_X).length).toBe(2);
  });
});

// -- User binding (privacy-flip prune precursor) -------------------
//
// The `(connectionId, userId)` binding is the bridge between a
// subscription registry entry and the `canSeeSession(pool, sessId,
// userId)` predicate the prune helper consults. The legacy two-arg
// `subscribe(conn, sess)` shape is kept for back-compat with the
// twelve existing test fixtures that fabricate registry entries
// without an auth surface; the three-arg shape is what the production
// subscribe handler calls.
//
// Refinement:
//   tasks/refinements/backend-hardening/privacy_flip_subscription_prune.md.

describe('WsSubscriptionRegistry — stats() (metrics emitter source)', () => {
  // Read-only counts consumed by deployment.observability.basic_metrics;
  // pinned here so the metrics line's wsSubscribedSessions /
  // wsSubscriptions fields can't drift from the registry's actual
  // bookkeeping. Refinement: tasks/refinements/deployment/basic_metrics.md.

  it('reports zeros on a fresh registry', () => {
    const reg = new WsSubscriptionRegistry();
    expect(reg.stats()).toEqual({ sessions: 0, connections: 0, subscriptions: 0 });
  });

  it('counts sessions, connections, and pairs after subscribes', () => {
    const reg = new WsSubscriptionRegistry();
    reg.subscribe(CONN_A, SESS_X);
    reg.subscribe(CONN_A, SESS_Y);
    reg.subscribe(CONN_B, SESS_X);

    expect(reg.stats()).toEqual({ sessions: 2, connections: 2, subscriptions: 3 });
  });

  it('is idempotent under duplicate subscribes', () => {
    const reg = new WsSubscriptionRegistry();
    reg.subscribe(CONN_A, SESS_X);
    reg.subscribe(CONN_A, SESS_X);

    expect(reg.stats()).toEqual({ sessions: 1, connections: 1, subscriptions: 1 });
  });

  it('tracks unsubscribe and removeConnection back down to zero', () => {
    const reg = new WsSubscriptionRegistry();
    reg.subscribe(CONN_A, SESS_X);
    reg.subscribe(CONN_B, SESS_X);
    reg.subscribe(CONN_B, SESS_Y);

    reg.unsubscribe(CONN_A, SESS_X);
    expect(reg.stats()).toEqual({ sessions: 2, connections: 1, subscriptions: 2 });

    reg.removeConnection(CONN_B);
    expect(reg.stats()).toEqual({ sessions: 0, connections: 0, subscriptions: 0 });
  });
});

const USER_A = '11111111-1111-4111-8111-1111111111a1';
const USER_B = '22222222-2222-4222-8222-2222222222b2';

describe('WsSubscriptionRegistry — userId binding', () => {
  it('records the userId when subscribe is called with three arguments', () => {
    const reg = new WsSubscriptionRegistry();
    reg.subscribe(CONN_A, SESS_X, USER_A);

    expect(reg.userForConnection(CONN_A)).toBe(USER_A);
    // Both indices populated as before.
    expect(reg.connectionsForSession(SESS_X)).toEqual([CONN_A]);
    expect(reg.sessionsForConnection(CONN_A)).toEqual([SESS_X]);
  });

  it('omits the binding when subscribe is called with two arguments (legacy)', () => {
    const reg = new WsSubscriptionRegistry();
    reg.subscribe(CONN_A, SESS_X);
    // No third argument → no userId binding. The pruner skips such
    // entries because it cannot evaluate `canSeeSession` without a
    // userId.
    expect(reg.userForConnection(CONN_A)).toBeUndefined();
    // The two indices still work as before.
    expect(reg.connectionsForSession(SESS_X)).toEqual([CONN_A]);
  });

  it('removeConnection wipes the user binding alongside the indices', () => {
    const reg = new WsSubscriptionRegistry();
    reg.subscribe(CONN_A, SESS_X, USER_A);
    reg.subscribe(CONN_A, SESS_Y, USER_A);

    reg.removeConnection(CONN_A);

    // All three: by-session, by-connection, by-user-of-connection.
    expect(reg.connectionsForSession(SESS_X)).toEqual([]);
    expect(reg.connectionsForSession(SESS_Y)).toEqual([]);
    expect(reg.sessionsForConnection(CONN_A)).toEqual([]);
    expect(reg.userForConnection(CONN_A)).toBeUndefined();
  });

  it('re-subscribing with a different userId replaces the binding', () => {
    // Defensive: real connections don't re-bind because the connection's
    // user is fixed at upgrade time. The shape is pinned anyway so a
    // future regression in the subscribe handler that re-binds is
    // visible at the registry level.
    const reg = new WsSubscriptionRegistry();
    reg.subscribe(CONN_A, SESS_X, USER_A);
    reg.subscribe(CONN_A, SESS_X, USER_B);
    expect(reg.userForConnection(CONN_A)).toBe(USER_B);
  });
});

// -- pruneSubscribersForPrivateSession (helper unit tests) ---------
//
// The helper walks the registry, consults `canSeeSession` for each
// subscriber, and evicts users who can no longer see the session.
// These unit tests stub the visibility executor (so no real DB) and
// stub the sender (so we can inspect the wire envelope) — pure unit
// coverage of the helper's branching logic. The route-level test in
// `routes.test.ts` covers the integration end-to-end.

const SESS_PRIVATE = '00000000-0000-4000-8000-0000000000c1';

/** Build a tiny fake logger that records calls for assertion. */
function makeFakeLog(): FastifyBaseLogger {
  const noop = vi.fn();
  // Cast to FastifyBaseLogger — only the methods the helper calls
  // (`debug`, `info`, `warn`) need to be present. `child` returns
  // itself so any future `.child({...})` call doesn't trip.
  const log: Partial<FastifyBaseLogger> = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    level: 'info',
    silent: noop,
  };
  (log as { child: () => FastifyBaseLogger }).child = () => log as FastifyBaseLogger;
  return log as FastifyBaseLogger;
}

/**
 * Build a fake `VisibilityExecutor` whose `query` shim mimics
 * `canSeeSession`'s SQL: `SELECT 1 AS visible FROM sessions WHERE id =
 * $1 AND (visibility-fragment)`. Returns one row when
 * `visibleUserIds` contains `params[1]` (the userId at slot 2);
 * otherwise zero rows (matches "not visible").
 *
 * The helper consults `canSeeSession` once per subscriber; this shim
 * drives the boolean answer.
 */
function makeVisibilityExecutor(visibleUserIds: ReadonlySet<string>): VisibilityExecutor {
  return {
    query<TRow extends Record<string, unknown> = Record<string, unknown>>(
      _text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const userId = params?.[1] as string | undefined;
      if (userId !== undefined && visibleUserIds.has(userId)) {
        return Promise.resolve({ rows: [{ visible: 1 } as unknown as TRow] });
      }
      return Promise.resolve({ rows: [] });
    },
  };
}

describe('pruneSubscribersForPrivateSession', () => {
  it('evicts a subscriber the visibility predicate rejects + sends an unsubscribed envelope with reason: privacy-flipped', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const sent: WsEnvelopeUnion[] = [];
    subscriptions.subscribe(CONN_A, SESS_PRIVATE, USER_A);
    connectionSenders.register(CONN_A, (env) => {
      sent.push(env);
    });
    // USER_A is NOT in the visible set → the predicate rejects them.
    const pool = makeVisibilityExecutor(new Set());

    await pruneSubscribersForPrivateSession({
      subscriptions,
      connectionSenders,
      pool,
      sessionId: SESS_PRIVATE,
      log: makeFakeLog(),
    });

    // The registry entry is gone.
    expect(subscriptions.connectionsForSession(SESS_PRIVATE)).toEqual([]);
    expect(subscriptions.sessionsForConnection(CONN_A)).toEqual([]);

    // One server-initiated `unsubscribed` envelope was sent on
    // CONN_A's wire.
    expect(sent).toHaveLength(1);
    const env = sent[0];
    expect(env?.type).toBe('unsubscribed');
    // `inResponseTo` is absent — this is an unsolicited push, not a
    // correlated ack.
    expect(env?.inResponseTo).toBeUndefined();
    if (env?.type === 'unsubscribed') {
      expect(env.payload.sessionId).toBe(SESS_PRIVATE);
      expect(env.payload.reason).toBe('privacy-flipped');
    }
  });

  it('keeps a subscriber the visibility predicate admits (host / participant)', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const sent: WsEnvelopeUnion[] = [];
    subscriptions.subscribe(CONN_A, SESS_PRIVATE, USER_A);
    connectionSenders.register(CONN_A, (env) => {
      sent.push(env);
    });
    // USER_A IS in the visible set → the predicate admits them.
    const pool = makeVisibilityExecutor(new Set([USER_A]));

    await pruneSubscribersForPrivateSession({
      subscriptions,
      connectionSenders,
      pool,
      sessionId: SESS_PRIVATE,
      log: makeFakeLog(),
    });

    // Subscription still in place.
    expect(subscriptions.connectionsForSession(SESS_PRIVATE)).toEqual([CONN_A]);
    // No envelope sent — the subscriber was admitted, not evicted.
    expect(sent).toEqual([]);
  });

  it('prunes a mix of subscribers in a single walk — keeps the visible, evicts the rest', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const sentByConn = new Map<string, WsEnvelopeUnion[]>();
    const collect = (conn: string) => (env: WsEnvelopeUnion) => {
      const list = sentByConn.get(conn) ?? [];
      list.push(env);
      sentByConn.set(conn, list);
    };
    subscriptions.subscribe(CONN_A, SESS_PRIVATE, USER_A); // visible
    subscriptions.subscribe(CONN_B, SESS_PRIVATE, USER_B); // NOT visible
    connectionSenders.register(CONN_A, collect(CONN_A));
    connectionSenders.register(CONN_B, collect(CONN_B));
    const pool = makeVisibilityExecutor(new Set([USER_A]));

    await pruneSubscribersForPrivateSession({
      subscriptions,
      connectionSenders,
      pool,
      sessionId: SESS_PRIVATE,
      log: makeFakeLog(),
    });

    // Only CONN_A remains subscribed.
    const remaining = [...subscriptions.connectionsForSession(SESS_PRIVATE)].sort();
    expect(remaining).toEqual([CONN_A].sort());

    // CONN_A got no envelope; CONN_B got the eviction push.
    expect(sentByConn.get(CONN_A) ?? []).toEqual([]);
    const bEnvelopes = sentByConn.get(CONN_B) ?? [];
    expect(bEnvelopes).toHaveLength(1);
    const bEnv = bEnvelopes[0];
    expect(bEnv?.type).toBe('unsubscribed');
    if (bEnv?.type === 'unsubscribed') {
      expect(bEnv.payload.reason).toBe('privacy-flipped');
    }
  });

  // -- Anonymous-subscriber branch (per ADR 0029 / aud_anonymous_ws_subscribe) --
  //
  // After the anonymous-WS-upgrade widening, a connection that
  // subscribed without a userId IS a genuine anonymous viewer (not a
  // legacy fixture). The pruner's anonymous branch evicts those
  // subscribers unconditionally when the session flips to private —
  // an anonymous viewer can never see a private session by
  // construction, so the per-subscriber DB round trip is skipped.

  it('evicts an anonymous subscriber when the session flips to private + sends an unsubscribed envelope with reason: privacy-flipped', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const sent: WsEnvelopeUnion[] = [];
    // Anonymous: subscribe without a userId — the production subscribe
    // handler does this for `connection.user === undefined` per
    // `apps/server/src/ws/handlers/subscribe.ts`.
    subscriptions.subscribe(CONN_A, SESS_PRIVATE);
    connectionSenders.register(CONN_A, (env) => {
      sent.push(env);
    });
    const pool = makeVisibilityExecutor(new Set());

    await pruneSubscribersForPrivateSession({
      subscriptions,
      connectionSenders,
      pool,
      sessionId: SESS_PRIVATE,
      log: makeFakeLog(),
    });

    // The registry entry is gone — anonymous-prune is unconditional.
    expect(subscriptions.connectionsForSession(SESS_PRIVATE)).toEqual([]);
    expect(subscriptions.sessionsForConnection(CONN_A)).toEqual([]);

    // The server-initiated `unsubscribed` envelope was sent on
    // CONN_A's wire.
    expect(sent).toHaveLength(1);
    const env = sent[0];
    expect(env?.type).toBe('unsubscribed');
    expect(env?.inResponseTo).toBeUndefined();
    if (env?.type === 'unsubscribed') {
      expect(env.payload.sessionId).toBe(SESS_PRIVATE);
      expect(env.payload.reason).toBe('privacy-flipped');
    }
  });

  it('does NOT issue a visibility DB query for an anonymous subscriber (the flip-to-private eviction is unconditional)', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const sent: WsEnvelopeUnion[] = [];
    subscriptions.subscribe(CONN_A, SESS_PRIVATE); // anonymous
    connectionSenders.register(CONN_A, (env) => {
      sent.push(env);
    });

    // Spy executor: count the number of `query` calls. The
    // anonymous-prune branch must NOT call canSeeSession (the answer
    // is constant "false" by construction); this pins the
    // no-DB-round-trip property.
    let queryCalls = 0;
    const pool: VisibilityExecutor = {
      query<TRow extends Record<string, unknown> = Record<string, unknown>>(): Promise<{
        rows: TRow[];
      }> {
        queryCalls++;
        return Promise.resolve({ rows: [] });
      },
    };

    await pruneSubscribersForPrivateSession({
      subscriptions,
      connectionSenders,
      pool,
      sessionId: SESS_PRIVATE,
      log: makeFakeLog(),
    });

    // Zero visibility queries — the anonymous branch is a direct
    // eviction.
    expect(queryCalls).toBe(0);
    // The eviction still fired.
    expect(subscriptions.connectionsForSession(SESS_PRIVATE)).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe('unsubscribed');
  });

  it('continues the loop when one connection sender throws (per-connection error isolation)', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const sent: WsEnvelopeUnion[] = [];
    subscriptions.subscribe(CONN_A, SESS_PRIVATE, USER_A); // sender throws
    subscriptions.subscribe(CONN_B, SESS_PRIVATE, USER_B); // sender works
    connectionSenders.register(CONN_A, () => {
      throw new Error('socket already torn down');
    });
    connectionSenders.register(CONN_B, (env) => {
      sent.push(env);
    });
    // Neither user is visible.
    const pool = makeVisibilityExecutor(new Set());

    await pruneSubscribersForPrivateSession({
      subscriptions,
      connectionSenders,
      pool,
      sessionId: SESS_PRIVATE,
      log: makeFakeLog(),
    });

    // BOTH subscriptions removed — CONN_A's send threw, but the
    // helper still calls `unsubscribe` (the user cannot see the
    // session anymore; leaving them subscribed and silent would
    // leak future broadcasts).
    expect(subscriptions.connectionsForSession(SESS_PRIVATE)).toEqual([]);
    // CONN_B's sender was reached after CONN_A's throw — proves the
    // loop continued.
    expect(sent).toHaveLength(1);
  });

  it('is a no-op when no one is subscribed to the session', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const pool = makeVisibilityExecutor(new Set());
    // No throw, no crash, resolves cleanly.
    await pruneSubscribersForPrivateSession({
      subscriptions,
      connectionSenders,
      pool,
      sessionId: SESS_PRIVATE,
      log: makeFakeLog(),
    });
    expect(subscriptions.connectionsForSession(SESS_PRIVATE)).toEqual([]);
  });

  it('survives a canSeeSession query rejection by leaving the subscription in place', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const sent: WsEnvelopeUnion[] = [];
    subscriptions.subscribe(CONN_A, SESS_PRIVATE, USER_A);
    connectionSenders.register(CONN_A, (env) => {
      sent.push(env);
    });
    // The visibility executor REJECTS rather than resolves; the
    // pruner logs + skips, does NOT crash the promise.
    const pool: VisibilityExecutor = {
      query: () => Promise.reject(new Error('pool exhausted')),
    };

    await pruneSubscribersForPrivateSession({
      subscriptions,
      connectionSenders,
      pool,
      sessionId: SESS_PRIVATE,
      log: makeFakeLog(),
    });

    // Subscription left in place — the predicate could not give a
    // definite answer; eviction is deferred (next privacy-flip will
    // try again).
    expect(subscriptions.connectionsForSession(SESS_PRIVATE)).toEqual([CONN_A]);
    expect(sent).toEqual([]);
  });
});
