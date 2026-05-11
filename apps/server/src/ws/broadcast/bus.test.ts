// Vitest unit tests for `WsBroadcastBus`.
//
// Refinement: tasks/refinements/backend/ws_event_broadcast.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_event_broadcast
//
// **What this file covers.** The pure-logic surface of `WsBroadcastBus`
// — no Fastify, no sockets, no I/O. The bus is a thin pub/sub
// primitive; its contract is:
//
//   1. `on('event-applied', ...)` registers a listener; the returned
//      unsubscribe handle removes it.
//   2. `emit(...)` dispatches synchronously, in registration order, to
//      every listener.
//   3. Multiple listeners receive the same emit independently.
//   4. A listener unsubscribing during its own emit doesn't disturb
//      the in-flight iteration (the bus snapshots the listener list
//      before iterating).
//   5. `listenerCount(...)` reports the current listener count.
//
// The error-isolation behaviour (one bad listener doesn't break the
// others) is NOT a bus contract — by design, the bus rethrows. The
// subscriber-side error isolation lives in
// `./event-applied.test.ts`.

import { describe, expect, it } from 'vitest';

import { WsBroadcastBus, type EventAppliedBusEvent } from './bus.js';

import type { Event } from '@a-conversa/shared-types';

// Stable fixture — a minimal Event the bus carries. Field values
// don't matter for these tests; only that `emit(...)` passes the
// payload through to every listener verbatim.
const FIXTURE_EVENT: Event = {
  id: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  sequence: 1,
  kind: 'session-created',
  actor: '00000000-0000-4000-8000-000000000003',
  payload: {
    host_user_id: '00000000-0000-4000-8000-000000000003',
    privacy: 'public',
    topic: 'fixture',
    created_at: '2026-05-11T12:00:00.000Z',
  },
  createdAt: '2026-05-11T12:00:00.001Z',
};

describe('WsBroadcastBus', () => {
  it('starts with zero listeners', () => {
    const bus = new WsBroadcastBus();
    expect(bus.listenerCount('event-applied')).toBe(0);
  });

  it('emit with no listeners is a no-op (does not throw)', () => {
    const bus = new WsBroadcastBus();
    expect(() => bus.emit({ event: FIXTURE_EVENT })).not.toThrow();
  });

  it('on(event-applied) registers a listener invoked on emit', () => {
    const bus = new WsBroadcastBus();
    const received: EventAppliedBusEvent[] = [];
    bus.on('event-applied', (evt) => received.push(evt));
    expect(bus.listenerCount('event-applied')).toBe(1);

    bus.emit({ event: FIXTURE_EVENT });
    expect(received).toHaveLength(1);
    expect(received[0]?.event).toBe(FIXTURE_EVENT);
  });

  it('multiple listeners all receive the same emit', () => {
    const bus = new WsBroadcastBus();
    const a: EventAppliedBusEvent[] = [];
    const b: EventAppliedBusEvent[] = [];
    const c: EventAppliedBusEvent[] = [];
    bus.on('event-applied', (evt) => a.push(evt));
    bus.on('event-applied', (evt) => b.push(evt));
    bus.on('event-applied', (evt) => c.push(evt));
    expect(bus.listenerCount('event-applied')).toBe(3);

    bus.emit({ event: FIXTURE_EVENT });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(c).toHaveLength(1);
    expect(a[0]?.event).toBe(FIXTURE_EVENT);
    expect(b[0]?.event).toBe(FIXTURE_EVENT);
    expect(c[0]?.event).toBe(FIXTURE_EVENT);
  });

  it('dispatches synchronously in registration order', () => {
    const bus = new WsBroadcastBus();
    const callOrder: string[] = [];
    bus.on('event-applied', () => callOrder.push('first'));
    bus.on('event-applied', () => callOrder.push('second'));
    bus.on('event-applied', () => callOrder.push('third'));

    bus.emit({ event: FIXTURE_EVENT });
    // Synchronous — order is preserved + the array is fully populated
    // before emit returns.
    expect(callOrder).toEqual(['first', 'second', 'third']);
  });

  it('the returned unsubscribe handle removes the listener', () => {
    const bus = new WsBroadcastBus();
    const received: EventAppliedBusEvent[] = [];
    const off = bus.on('event-applied', (evt) => received.push(evt));
    bus.emit({ event: FIXTURE_EVENT });
    expect(received).toHaveLength(1);

    off();
    expect(bus.listenerCount('event-applied')).toBe(0);
    bus.emit({ event: FIXTURE_EVENT });
    // The second emit did not reach the unsubscribed listener.
    expect(received).toHaveLength(1);
  });

  it('a listener unsubscribing itself does not disturb the in-flight emit', () => {
    // Snapshot semantics — the bus iterates a snapshot of the listener
    // list, so a listener that unsubscribes itself during its own
    // emit doesn't shift the index of later listeners. Pinning the
    // snapshot contract here so a future refactor can't silently
    // collapse it to a live-array iteration.
    const bus = new WsBroadcastBus();
    const order: string[] = [];

    let offA: (() => void) | null = null;
    offA = bus.on('event-applied', () => {
      order.push('a');
      offA?.();
    });
    bus.on('event-applied', () => {
      order.push('b');
    });
    bus.on('event-applied', () => {
      order.push('c');
    });

    bus.emit({ event: FIXTURE_EVENT });
    // All three listeners fired in registration order, even though
    // `a` unsubscribed itself mid-iteration.
    expect(order).toEqual(['a', 'b', 'c']);
    // After the emit, `a` is gone.
    expect(bus.listenerCount('event-applied')).toBe(2);
  });

  it('a throwing listener propagates to the emit caller (bus is not error-policy-aware)', () => {
    // Error containment is the subscriber's job, not the bus's — the
    // bus mirrors `DiagnosticBus`'s synchronous-rethrow contract. Per-
    // connection error isolation (one bad socket doesn't break the
    // fan-out) lives in the `event-applied` subscriber's listener,
    // tested separately.
    const bus = new WsBroadcastBus();
    bus.on('event-applied', () => {
      throw new Error('listener bug');
    });
    expect(() => bus.emit({ event: FIXTURE_EVENT })).toThrow('listener bug');
  });

  it('throws on an unsupported event name (defensive against TS-bypassed string literals)', () => {
    const bus = new WsBroadcastBus();
    expect(() => bus.on('does-not-exist' as 'event-applied', () => {})).toThrow();
  });
});
