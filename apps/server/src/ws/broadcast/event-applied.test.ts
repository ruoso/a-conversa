// Vitest unit tests for `buildEventAppliedBroadcastListener`.
//
// Refinement: tasks/refinements/backend/ws_event_broadcast.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_event_broadcast
//
// **What this file covers.** The pure-logic fan-out behaviour of the
// `event-applied` broadcast listener. No Fastify, no real sockets —
// we hand the builder a real `WsSubscriptionRegistry` (the registry
// is pure JS), a real `WsConnectionSenderRegistry` populated with
// captured-array senders, and a no-op logger.
//
// Contract pinned here:
//
//   1. Fan-out: every connection subscribed to the event's session
//      receives the `event-applied` envelope verbatim.
//   2. Other-session isolation: a connection subscribed to a DIFFERENT
//      session does NOT receive the broadcast.
//   3. No-subscribers: a session with no subscriptions makes the
//      listener a no-op (no error).
//   4. Per-connection error isolation: a sender that throws is logged
//      + the other senders still receive the broadcast.
//   5. Unregistered-sender: when the subscription registry mentions a
//      connection id whose sender was removed (the close race
//      window), the listener skips it without throwing.
//   6. Envelope shape: every fan-out target receives the SAME envelope
//      (single server-minted id; carries the full event verbatim;
//      `type === 'event-applied'`; no `inResponseTo`).

import { describe, expect, it } from 'vitest';

import type { Event, WsEnvelopeUnion } from '@a-conversa/shared-types';
import type { FastifyBaseLogger } from 'fastify';

import { buildEventAppliedBroadcastListener } from './event-applied.js';
import { WsConnectionSenderRegistry } from './connections.js';
import { WsSubscriptionRegistry } from '../subscriptions.js';

const SESSION_A = '00000000-0000-4000-8000-000000000a01';
const SESSION_B = '00000000-0000-4000-8000-000000000a02';
const CONN_1 = '00000000-0000-4000-8000-000000000c01';
const CONN_2 = '00000000-0000-4000-8000-000000000c02';
const CONN_3 = '00000000-0000-4000-8000-000000000c03';

function fixtureEvent(sessionId: string, sequence: number): Event {
  return {
    id: '00000000-0000-4000-8000-000000000e01',
    sessionId,
    sequence,
    kind: 'session-created',
    actor: '00000000-0000-4000-8000-000000000a99',
    payload: {
      host_user_id: '00000000-0000-4000-8000-000000000a99',
      privacy: 'public',
      topic: `fixture session ${sessionId}`,
      created_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

// Minimal FastifyBaseLogger stub — captures `warn` calls so we can
// assert the per-connection error-isolation path logged. The other
// methods are no-ops (the listener uses `warn` only).
interface CapturedLog {
  level: 'warn';
  ctx: Record<string, unknown>;
  msg: string;
}
function captureLogger(): { logger: FastifyBaseLogger; lines: CapturedLog[] } {
  const lines: CapturedLog[] = [];
  // The Fastify base logger surface is wider than we need; cast through
  // unknown to satisfy the type without implementing every method.
  const logger = {
    warn: (ctx: Record<string, unknown>, msg: string) => {
      lines.push({ level: 'warn', ctx, msg });
    },
    info: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => logger,
    level: 'info',
    silent: () => {},
  } as unknown as FastifyBaseLogger;
  return { logger, lines };
}

describe('buildEventAppliedBroadcastListener — fan-out behaviour', () => {
  it('sends the event-applied envelope to every subscribed connection on the session', () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured: Record<string, WsEnvelopeUnion[]> = { [CONN_1]: [], [CONN_2]: [] };
    connectionSenders.register(CONN_1, (env) => captured[CONN_1]!.push(env));
    connectionSenders.register(CONN_2, (env) => captured[CONN_2]!.push(env));

    subscriptions.subscribe(CONN_1, SESSION_A);
    subscriptions.subscribe(CONN_2, SESSION_A);

    const { logger } = captureLogger();
    const listener = buildEventAppliedBroadcastListener({
      subscriptions,
      connectionSenders,
      log: logger,
    });

    const event = fixtureEvent(SESSION_A, 1);
    listener({ event });

    expect(captured[CONN_1]).toHaveLength(1);
    expect(captured[CONN_2]).toHaveLength(1);
    // Both targets received the SAME envelope (envelope id is server-
    // minted once per fan-out; both receivers see the same id so a
    // server log can correlate the fan-out by id).
    expect(captured[CONN_1]![0]?.id).toBe(captured[CONN_2]![0]?.id);
    // Envelope shape — type is `event-applied`, no `inResponseTo` (the
    // broadcast is unsolicited), payload wraps the event.
    const envelope = captured[CONN_1]![0]!;
    expect(envelope.type).toBe('event-applied');
    expect(envelope.inResponseTo).toBeUndefined();
    expect(envelope.payload).toEqual({ event });
  });

  it('skips connections subscribed to a different session', () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured: Record<string, WsEnvelopeUnion[]> = { [CONN_1]: [], [CONN_2]: [] };
    connectionSenders.register(CONN_1, (env) => captured[CONN_1]!.push(env));
    connectionSenders.register(CONN_2, (env) => captured[CONN_2]!.push(env));

    subscriptions.subscribe(CONN_1, SESSION_A);
    subscriptions.subscribe(CONN_2, SESSION_B);

    const { logger } = captureLogger();
    const listener = buildEventAppliedBroadcastListener({
      subscriptions,
      connectionSenders,
      log: logger,
    });

    listener({ event: fixtureEvent(SESSION_A, 1) });

    // CONN_1 received the broadcast; CONN_2 did not.
    expect(captured[CONN_1]).toHaveLength(1);
    expect(captured[CONN_2]).toHaveLength(0);
  });

  it('is a no-op when no connection is subscribed to the session', () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured: WsEnvelopeUnion[] = [];
    connectionSenders.register(CONN_1, (env) => captured.push(env));
    // Subscribe to a DIFFERENT session so the registry isn't empty —
    // we want to assert specifically that "no subscribers for THIS
    // session" is fine, not "no subscribers at all."
    subscriptions.subscribe(CONN_1, SESSION_B);

    const { logger, lines } = captureLogger();
    const listener = buildEventAppliedBroadcastListener({
      subscriptions,
      connectionSenders,
      log: logger,
    });

    expect(() => listener({ event: fixtureEvent(SESSION_A, 1) })).not.toThrow();
    expect(captured).toHaveLength(0);
    expect(lines).toHaveLength(0);
  });

  it('isolates per-connection send failures — one bad sender does not break the fan-out', () => {
    // Three connections subscribed to the same session. The middle
    // sender throws on send. The first and third must still receive
    // the broadcast; the warn log must capture the failure.
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured1: WsEnvelopeUnion[] = [];
    const captured3: WsEnvelopeUnion[] = [];
    connectionSenders.register(CONN_1, (env) => captured1.push(env));
    connectionSenders.register(CONN_2, () => {
      throw new Error('socket already closed');
    });
    connectionSenders.register(CONN_3, (env) => captured3.push(env));

    subscriptions.subscribe(CONN_1, SESSION_A);
    subscriptions.subscribe(CONN_2, SESSION_A);
    subscriptions.subscribe(CONN_3, SESSION_A);

    const { logger, lines } = captureLogger();
    const listener = buildEventAppliedBroadcastListener({
      subscriptions,
      connectionSenders,
      log: logger,
    });

    const event = fixtureEvent(SESSION_A, 1);
    expect(() => listener({ event })).not.toThrow();

    // The good senders received the broadcast.
    expect(captured1).toHaveLength(1);
    expect(captured3).toHaveLength(1);

    // The bad sender's failure was logged at warn level with the
    // connection id and the event id for correlation.
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('warn');
    expect(lines[0]?.ctx['connectionId']).toBe(CONN_2);
    expect(lines[0]?.ctx['sessionId']).toBe(SESSION_A);
    expect(lines[0]?.ctx['eventKind']).toBe('session-created');
    expect(lines[0]?.ctx['eventSequence']).toBe(1);
    expect(lines[0]?.ctx['err']).toBeInstanceOf(Error);
  });

  it('skips connections whose sender has been unregistered (close-race window)', () => {
    // The subscription registry still mentions CONN_2 (the close hook
    // hasn't run yet for the subscription side), but the sender was
    // already unregistered (the senders unregistered first). The
    // listener must skip silently — no throw, no warn.
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured: WsEnvelopeUnion[] = [];
    connectionSenders.register(CONN_1, (env) => captured.push(env));
    // CONN_2 is subscribed but has no sender.
    subscriptions.subscribe(CONN_1, SESSION_A);
    subscriptions.subscribe(CONN_2, SESSION_A);

    const { logger, lines } = captureLogger();
    const listener = buildEventAppliedBroadcastListener({
      subscriptions,
      connectionSenders,
      log: logger,
    });

    expect(() => listener({ event: fixtureEvent(SESSION_A, 1) })).not.toThrow();
    expect(captured).toHaveLength(1);
    // No warn — a missing sender is not an error; it's the close-race
    // window. Logging on every close would flood the operator's
    // attention surface for a benign condition.
    expect(lines).toHaveLength(0);
  });

  it('preserves per-session ordering: sequential emits arrive in emit order on each subscribed connection', () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const seqs: number[] = [];
    connectionSenders.register(CONN_1, (env) => {
      // Pull the sequence off the carried event for assertion.
      if (env.type === 'event-applied') {
        seqs.push(env.payload.event.sequence);
      }
    });
    subscriptions.subscribe(CONN_1, SESSION_A);

    const { logger } = captureLogger();
    const listener = buildEventAppliedBroadcastListener({
      subscriptions,
      connectionSenders,
      log: logger,
    });

    // Three emits in sequence-order.
    listener({ event: fixtureEvent(SESSION_A, 1) });
    listener({ event: fixtureEvent(SESSION_A, 2) });
    listener({ event: fixtureEvent(SESSION_A, 3) });

    // The connection received them in the SAME order. Synchronous
    // dispatch + a single sender means the array is populated in
    // emit-call order. Across the bus -> listener -> sender path the
    // ordering invariant holds.
    expect(seqs).toEqual([1, 2, 3]);
  });
});
