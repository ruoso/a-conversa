// Vitest unit tests for `buildDiagnosticBroadcastListener` +
// `WsDiagnosticBroadcast`.
//
// Refinement: tasks/refinements/backend/ws_diagnostic_broadcast.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_diagnostic_broadcast
//
// **What this file covers.** The pure-logic fan-out behaviour of the
// `diagnostic` broadcast listener + the session-context-aware wrapper.
// No Fastify, no real sockets — we hand the builder a real
// `WsSubscriptionRegistry` (the registry is pure JS), a real
// `WsConnectionSenderRegistry` populated with captured-array senders,
// a real `DiagnosticBus`, and a no-op logger.
//
// Contract pinned here:
//
//   1. Fan-out: every connection subscribed to the diagnostic's
//      session (carried via the active context) receives a
//      `diagnostic` envelope.
//   2. Other-session isolation: a client subscribed to session B does
//      NOT receive a diagnostic broadcast emitted for session A.
//   3. Multiple subscribed clients all receive the same envelope id.
//   4. All five surfaced diagnostic kinds (cycle, contradiction,
//      multi-warrant, dangling-claim, coherency-hint) round-trip the
//      payload pass-through verbatim with the right `kind` discriminator
//      + the right severity classification.
//   5. Per-connection error isolation: a sender that throws is logged
//      and the other senders still receive the broadcast.
//   6. Unregistered-sender close-race: a subscribed connection whose
//      sender was unregistered is skipped silently.
//   7. Status discriminator: `fired` and `cleared` produce envelopes
//      with the corresponding `status` field.
//   8. Missing-context defensive path: a raw `bus.notify(...)` bypassing
//      the wrapper logs a warn + skips fan-out.
//   9. `WsDiagnosticBroadcast.notifyForSession` clears active context
//      in `finally` even when a listener throws.

import { describe, expect, it } from 'vitest';

import type { WsEnvelopeUnion } from '@a-conversa/shared-types';
import type { FastifyBaseLogger } from 'fastify';

import {
  DiagnosticBus,
  type DiagnosticEntry,
  type CoherencyHintDiagnosticEntry,
} from '../../diagnostics/index.js';
import { buildDiagnosticBroadcastListener, WsDiagnosticBroadcast } from './diagnostic.js';
import { WsConnectionSenderRegistry } from './connections.js';
import { WsSubscriptionRegistry } from '../subscriptions.js';

const SESSION_A = '00000000-0000-4000-8000-000000000a01';
const SESSION_B = '00000000-0000-4000-8000-000000000a02';
const CONN_1 = '00000000-0000-4000-8000-000000000c01';
const CONN_2 = '00000000-0000-4000-8000-000000000c02';
const CONN_3 = '00000000-0000-4000-8000-000000000c03';

interface CapturedLog {
  level: 'warn';
  ctx: Record<string, unknown>;
  msg: string;
}

function captureLogger(): { logger: FastifyBaseLogger; lines: CapturedLog[] } {
  const lines: CapturedLog[] = [];
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

// Each diagnostic-kind fixture builds a minimal valid `DiagnosticEntry`
// for the named kind. Field values are arbitrary placeholders — only
// the discriminator + the pass-through-verbatim invariant matter for
// the broadcast surface.
function cycleEntry(): DiagnosticEntry {
  return {
    kind: 'cycle',
    nodes: ['n1', 'n2', 'n3'],
  };
}

function contradictionEntry(): DiagnosticEntry {
  return {
    kind: 'contradiction',
    nodeA: 'n-a',
    nodeB: 'n-b',
    edges: ['e1'],
  };
}

function multiWarrantEntry(): DiagnosticEntry {
  return {
    kind: 'multi-warrant',
    dataNodeId: 'd1',
    claimNodeId: 'c1',
    warrantNodeIds: ['w1', 'w2'],
  };
}

function danglingClaimEntry(): DiagnosticEntry {
  return {
    kind: 'dangling-claim',
    nodeId: 'c-dangling',
  };
}

function coherencyHintEntry(): CoherencyHintDiagnosticEntry {
  return {
    kind: 'coherency-hint',
    hint: {
      kind: 'self-contradicts',
      edgeId: 'edge-1',
      nodeId: 'n-self',
    },
  };
}

/**
 * Compose a fully-wired bridge for unit testing — a real
 * `DiagnosticBus`, a real `WsDiagnosticBroadcast` wrapping it, real
 * subscription + sender registries populated by the caller, the
 * fan-out listeners registered on the bus. The caller subscribes
 * connections + senders + then drives `notifyForSession(...)`.
 */
function setupBridge(opts: { logger?: FastifyBaseLogger } = {}): {
  bus: DiagnosticBus;
  wrapper: WsDiagnosticBroadcast;
  subscriptions: WsSubscriptionRegistry;
  connectionSenders: WsConnectionSenderRegistry;
  logger: FastifyBaseLogger;
  lines: CapturedLog[];
} {
  const subscriptions = new WsSubscriptionRegistry();
  const connectionSenders = new WsConnectionSenderRegistry();
  const bus = new DiagnosticBus();
  const wrapper = new WsDiagnosticBroadcast(bus);
  const capture = captureLogger();
  const logger = opts.logger ?? capture.logger;
  const listeners = buildDiagnosticBroadcastListener({
    subscriptions,
    connectionSenders,
    getActiveContext: () => wrapper.getActiveContext(),
    log: logger,
  });
  bus.on('fired', listeners.fired);
  bus.on('cleared', listeners.cleared);
  return {
    bus,
    wrapper,
    subscriptions,
    connectionSenders,
    logger,
    lines: capture.lines,
  };
}

describe('buildDiagnosticBroadcastListener — fan-out behaviour', () => {
  it('sends a diagnostic envelope to every subscribed connection on the session', () => {
    const bridge = setupBridge();
    const captured: Record<string, WsEnvelopeUnion[]> = { [CONN_1]: [], [CONN_2]: [] };
    bridge.connectionSenders.register(CONN_1, (env) => captured[CONN_1]!.push(env));
    bridge.connectionSenders.register(CONN_2, (env) => captured[CONN_2]!.push(env));
    bridge.subscriptions.subscribe(CONN_1, SESSION_A);
    bridge.subscriptions.subscribe(CONN_2, SESSION_A);

    const entry = cycleEntry();
    bridge.wrapper.notifyForSession(SESSION_A, 7, [], [entry]);

    expect(captured[CONN_1]).toHaveLength(1);
    expect(captured[CONN_2]).toHaveLength(1);
    // Both targets received the SAME envelope id (server-minted once
    // per fan-out).
    expect(captured[CONN_1]![0]?.id).toBe(captured[CONN_2]![0]?.id);
    // Envelope shape.
    const envelope = captured[CONN_1]![0]!;
    expect(envelope.type).toBe('diagnostic');
    expect(envelope.inResponseTo).toBeUndefined();
    expect(envelope.payload).toMatchObject({
      sessionId: SESSION_A,
      kind: 'cycle',
      severity: 'blocking',
      status: 'fired',
      sequence: 7,
      diagnostic: entry,
    });
  });

  it('skips connections subscribed to a different session', () => {
    const bridge = setupBridge();
    const captured: Record<string, WsEnvelopeUnion[]> = { [CONN_1]: [], [CONN_2]: [] };
    bridge.connectionSenders.register(CONN_1, (env) => captured[CONN_1]!.push(env));
    bridge.connectionSenders.register(CONN_2, (env) => captured[CONN_2]!.push(env));
    bridge.subscriptions.subscribe(CONN_1, SESSION_A);
    bridge.subscriptions.subscribe(CONN_2, SESSION_B);

    bridge.wrapper.notifyForSession(SESSION_A, 1, [], [cycleEntry()]);

    expect(captured[CONN_1]).toHaveLength(1);
    expect(captured[CONN_2]).toHaveLength(0);
  });

  it('is a no-op when no connection is subscribed to the session', () => {
    const bridge = setupBridge();
    const captured: WsEnvelopeUnion[] = [];
    bridge.connectionSenders.register(CONN_1, (env) => captured.push(env));
    bridge.subscriptions.subscribe(CONN_1, SESSION_B);

    expect(() => bridge.wrapper.notifyForSession(SESSION_A, 1, [], [cycleEntry()])).not.toThrow();
    expect(captured).toHaveLength(0);
    expect(bridge.lines).toHaveLength(0);
  });

  it('isolates per-connection send failures — one bad sender does not break fan-out', () => {
    const bridge = setupBridge();
    const captured1: WsEnvelopeUnion[] = [];
    const captured3: WsEnvelopeUnion[] = [];
    bridge.connectionSenders.register(CONN_1, (env) => captured1.push(env));
    bridge.connectionSenders.register(CONN_2, () => {
      throw new Error('socket already closed');
    });
    bridge.connectionSenders.register(CONN_3, (env) => captured3.push(env));
    bridge.subscriptions.subscribe(CONN_1, SESSION_A);
    bridge.subscriptions.subscribe(CONN_2, SESSION_A);
    bridge.subscriptions.subscribe(CONN_3, SESSION_A);

    const entry = contradictionEntry();
    expect(() => bridge.wrapper.notifyForSession(SESSION_A, 9, [], [entry])).not.toThrow();

    expect(captured1).toHaveLength(1);
    expect(captured3).toHaveLength(1);
    expect(bridge.lines).toHaveLength(1);
    expect(bridge.lines[0]?.level).toBe('warn');
    expect(bridge.lines[0]?.ctx['connectionId']).toBe(CONN_2);
    expect(bridge.lines[0]?.ctx['sessionId']).toBe(SESSION_A);
    expect(bridge.lines[0]?.ctx['diagnosticKind']).toBe('contradiction');
    expect(bridge.lines[0]?.ctx['diagnosticStatus']).toBe('fired');
    expect(bridge.lines[0]?.ctx['sequence']).toBe(9);
    expect(bridge.lines[0]?.ctx['err']).toBeInstanceOf(Error);
  });

  it('skips connections whose sender has been unregistered (close-race window)', () => {
    const bridge = setupBridge();
    const captured: WsEnvelopeUnion[] = [];
    bridge.connectionSenders.register(CONN_1, (env) => captured.push(env));
    // CONN_2 is subscribed but has NO sender registered.
    bridge.subscriptions.subscribe(CONN_1, SESSION_A);
    bridge.subscriptions.subscribe(CONN_2, SESSION_A);

    expect(() =>
      bridge.wrapper.notifyForSession(SESSION_A, 1, [], [danglingClaimEntry()]),
    ).not.toThrow();
    expect(captured).toHaveLength(1);
    // No warn — a missing sender is the close-race window, not an error.
    expect(bridge.lines).toHaveLength(0);
  });
});

describe('buildDiagnosticBroadcastListener — kind + severity coverage', () => {
  // Parameterised over all five surfaced diagnostic kinds. Each
  // builds the entry, fires it, and asserts the wire envelope's
  // `kind` discriminator + the severity classification produced by
  // `classifyDiagnostic` (the source-of-truth severity vocabulary).
  // The pass-through invariant — `payload.diagnostic === entry` — is
  // asserted by `toBe(entry)` (referential equality), not just
  // `toEqual` deep-equal, because the bridge promises NOT to clone
  // or reshape.
  const cases: Array<{
    name: string;
    entry: () => DiagnosticEntry;
    expectedKind: string;
    expectedSeverity: 'blocking' | 'advisory';
  }> = [
    { name: 'cycle', entry: cycleEntry, expectedKind: 'cycle', expectedSeverity: 'blocking' },
    {
      name: 'contradiction',
      entry: contradictionEntry,
      expectedKind: 'contradiction',
      expectedSeverity: 'blocking',
    },
    {
      name: 'multi-warrant',
      entry: multiWarrantEntry,
      expectedKind: 'multi-warrant',
      expectedSeverity: 'advisory',
    },
    {
      name: 'dangling-claim',
      entry: danglingClaimEntry,
      expectedKind: 'dangling-claim',
      expectedSeverity: 'advisory',
    },
    {
      name: 'coherency-hint',
      entry: coherencyHintEntry,
      expectedKind: 'coherency-hint',
      expectedSeverity: 'advisory',
    },
  ];

  for (const c of cases) {
    it(`${c.name}: kind=${c.expectedKind}, severity=${c.expectedSeverity}, payload pass-through`, () => {
      const bridge = setupBridge();
      const captured: WsEnvelopeUnion[] = [];
      bridge.connectionSenders.register(CONN_1, (env) => captured.push(env));
      bridge.subscriptions.subscribe(CONN_1, SESSION_A);

      const entry = c.entry();
      bridge.wrapper.notifyForSession(SESSION_A, 3, [], [entry]);

      expect(captured).toHaveLength(1);
      const env = captured[0]!;
      expect(env.type).toBe('diagnostic');
      if (env.type === 'diagnostic') {
        expect(env.payload.kind).toBe(c.expectedKind);
        expect(env.payload.severity).toBe(c.expectedSeverity);
        expect(env.payload.status).toBe('fired');
        expect(env.payload.sequence).toBe(3);
        expect(env.payload.sessionId).toBe(SESSION_A);
        // Pass-through verbatim — referential equality, not just
        // deep-equal. The bridge promises NOT to clone or reshape
        // the `DiagnosticEntry`.
        expect(env.payload.diagnostic).toBe(entry);
      }
    });
  }
});

describe('buildDiagnosticBroadcastListener — status discriminator', () => {
  it('emits status="fired" for entries newly present in the post-event projection', () => {
    const bridge = setupBridge();
    const captured: WsEnvelopeUnion[] = [];
    bridge.connectionSenders.register(CONN_1, (env) => captured.push(env));
    bridge.subscriptions.subscribe(CONN_1, SESSION_A);

    const entry = cycleEntry();
    // prev is empty, next has the entry — fired.
    bridge.wrapper.notifyForSession(SESSION_A, 4, [], [entry]);

    expect(captured).toHaveLength(1);
    const env = captured[0]!;
    if (env.type === 'diagnostic') {
      expect(env.payload.status).toBe('fired');
    }
  });

  it('emits status="cleared" for entries gone from the post-event projection', () => {
    const bridge = setupBridge();
    const captured: WsEnvelopeUnion[] = [];
    bridge.connectionSenders.register(CONN_1, (env) => captured.push(env));
    bridge.subscriptions.subscribe(CONN_1, SESSION_A);

    const entry = cycleEntry();
    // prev has the entry, next is empty — cleared.
    bridge.wrapper.notifyForSession(SESSION_A, 5, [entry], []);

    expect(captured).toHaveLength(1);
    const env = captured[0]!;
    if (env.type === 'diagnostic') {
      expect(env.payload.status).toBe('cleared');
    }
  });

  it('emits both fired and cleared in the same notify call', () => {
    const bridge = setupBridge();
    const captured: WsEnvelopeUnion[] = [];
    bridge.connectionSenders.register(CONN_1, (env) => captured.push(env));
    bridge.subscriptions.subscribe(CONN_1, SESSION_A);

    const prev = [cycleEntry()];
    // Different identity (different node set) — counts as cleared
    // (the prev cycle) and fired (a new cycle).
    const next: DiagnosticEntry[] = [{ kind: 'cycle', nodes: ['x', 'y'] }];
    bridge.wrapper.notifyForSession(SESSION_A, 6, prev, next);

    // Two envelopes — one fired and one cleared.
    expect(captured).toHaveLength(2);
    const statuses = captured
      .map((env) => (env.type === 'diagnostic' ? env.payload.status : undefined))
      .sort();
    expect(statuses).toEqual(['cleared', 'fired']);
  });
});

describe('WsDiagnosticBroadcast — wrapper invariants', () => {
  it('clears active context in finally even when a listener throws', () => {
    const bridge = setupBridge();
    bridge.subscriptions.subscribe(CONN_1, SESSION_A);
    bridge.connectionSenders.register(CONN_1, () => {
      throw new Error('boom');
    });

    // The fan-out listener catches the per-connection send error
    // (per the error-isolation contract), so notifyForSession
    // returns normally. The context should be cleared regardless.
    expect(() => bridge.wrapper.notifyForSession(SESSION_A, 1, [], [cycleEntry()])).not.toThrow();

    expect(bridge.wrapper.getActiveContext()).toBeUndefined();
  });

  it('clears active context in finally when a non-fan-out listener throws', () => {
    const bridge = setupBridge();
    // Register a second `fired` listener directly on the bus that
    // throws. The bus rethrows; the wrapper must still clear context.
    bridge.bus.on('fired', () => {
      throw new Error('extra-listener boom');
    });

    expect(() => bridge.wrapper.notifyForSession(SESSION_A, 1, [], [cycleEntry()])).toThrow(
      /extra-listener boom/,
    );

    expect(bridge.wrapper.getActiveContext()).toBeUndefined();
  });
});

describe('buildDiagnosticBroadcastListener — defensive missing-context path', () => {
  it('logs at warn and skips fan-out when bus.notify is called without going through the wrapper', () => {
    const bridge = setupBridge();
    const captured: WsEnvelopeUnion[] = [];
    bridge.connectionSenders.register(CONN_1, (env) => captured.push(env));
    bridge.subscriptions.subscribe(CONN_1, SESSION_A);

    // Bypass the wrapper — call bus.notify directly. The fan-out
    // listener has no active context to read from; it should log a
    // warn and skip the entry.
    bridge.bus.notify([], [cycleEntry()]);

    expect(captured).toHaveLength(0);
    expect(bridge.lines).toHaveLength(1);
    expect(bridge.lines[0]?.level).toBe('warn');
    expect(bridge.lines[0]?.msg).toMatch(/without active session context/);
    expect(bridge.lines[0]?.ctx['status']).toBe('fired');
    expect(bridge.lines[0]?.ctx['entryKind']).toBe('cycle');
  });
});
