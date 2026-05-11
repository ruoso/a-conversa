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

import { describe, expect, it } from 'vitest';

import { WsSubscriptionRegistry } from './subscriptions.js';

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
