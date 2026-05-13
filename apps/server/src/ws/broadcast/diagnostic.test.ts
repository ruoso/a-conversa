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
import {
  buildDiagnosticBroadcastListener,
  WsDiagnosticBroadcast,
  type DiagnosticBroadcastActiveContext,
} from './diagnostic.js';
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

// -------------------------------------------------------------------
// WsDiagnosticBroadcast — synchronous-dispatch context window (G-016).
// -------------------------------------------------------------------
//
// Source finding: docs/security/m3-review/coverage.md G-016.
// Refinement:    tasks/refinements/backend-hardening/diagnostic_sync_dispatch_pin.md
//
// This block pins the **current** context-window contract that
// `WsDiagnosticBroadcast.notifyForSession` depends on. The wrapper
// sets `#activeContext` BEFORE calling `bus.notify(...)` and clears
// it in `finally` AFTER `notify` returns. The pattern is safe ONLY
// while `DiagnosticBus.notify` dispatches synchronously — listeners
// must observe the context during dispatch, and the clear must NOT
// happen until every listener has finished.
//
// The bus-level half of this contract is pinned by
// `apps/server/src/diagnostics/event-emission.test.ts`'s
// `DiagnosticBus — synchronous-dispatch contract (G-016)` describe.
// The wrapper-level half — that the set / fire / clear window is
// fully contained in `notifyForSession`'s synchronous call — is
// pinned here.
//
// **If a future refactor makes the bus async-aware** (e.g., adds
// `await listener(entry)` inside `notify`'s loop, or queues dispatch
// through `Promise.resolve()` / `queueMicrotask` / `setImmediate`),
// the bus-level test fails first; this test then needs updating to
// assert the NEW context-window pattern (today's single-slot mutable
// holder won't work under interleaved async notify calls — the
// wrapper would need an async-local store, a per-call closure, or an
// entry-level context field). **This test IS the canonical doc of
// the context-window shape**; updating it is the structural step
// that surfaces the cross-cutting refactor to reviewers.

describe('WsDiagnosticBroadcast — synchronous-dispatch context window (G-016)', () => {
  it('listeners observe the active context during dispatch AND the context is cleared by the time notifyForSession returns', () => {
    const bridge = setupBridge();
    bridge.subscriptions.subscribe(CONN_1, SESSION_A);
    bridge.connectionSenders.register(CONN_1, () => undefined);

    // The listener captures the wrapper's active context AT FIRE TIME
    // into an outer-scoped slot. After `notifyForSession` returns, the
    // outer slot reveals whether the context was set during the call;
    // a separate read of `wrapper.getActiveContext()` reveals whether
    // it was cleared by return time. The two observations together
    // pin the full set → fire → clear window as synchronous.
    const captured: { duringDispatch: DiagnosticBroadcastActiveContext | undefined } = {
      duringDispatch: undefined,
    };
    bridge.bus.on('fired', () => {
      captured.duringDispatch = bridge.wrapper.getActiveContext();
    });

    bridge.wrapper.notifyForSession(SESSION_A, 42, [], [cycleEntry()]);

    // Set half: the listener observed the active context during
    // dispatch. If the bus were async (queued the listener call to a
    // microtask), the wrapper's `finally` would have already cleared
    // the context by the time the listener ran — `duringDispatch`
    // would be `undefined` and this assertion would fail.
    expect(captured.duringDispatch).toEqual({ sessionId: SESSION_A, sequence: 42 });

    // Clear half: by the time `notifyForSession` returns
    // synchronously, the `finally` block has cleared the context.
    expect(bridge.wrapper.getActiveContext()).toBeUndefined();

    // Window-is-contained half: both halves observable synchronously,
    // immediately after `notifyForSession` returns, WITHOUT awaiting
    // anything. A future refactor that defers either the set or the
    // clear past the sync boundary would break this test.
  });

  it('does not extend the context window for async-returning listeners — wrapper mirrors the bus contract', async () => {
    const bridge = setupBridge();
    bridge.subscriptions.subscribe(CONN_1, SESSION_A);
    bridge.connectionSenders.register(CONN_1, () => undefined);

    // An async listener that captures the context twice: once
    // synchronously (during dispatch) and once after awaiting a
    // microtask. The bus does NOT await the returned promise (see
    // `DiagnosticBus — synchronous-dispatch contract (G-016)`), so
    // the wrapper's `finally` runs BEFORE the awaited microtask
    // resolves. The post-microtask observation should be `undefined`
    // — the context window does NOT stretch to cover the async
    // continuation. A consumer that puts async work in a listener
    // and depends on the context being available across it is
    // unsupported, and this test pins that.
    const captured: {
      duringDispatch: DiagnosticBroadcastActiveContext | undefined;
      afterMicrotask: DiagnosticBroadcastActiveContext | undefined;
    } = {
      duringDispatch: undefined,
      afterMicrotask: undefined,
    };
    bridge.bus.on('fired', () => {
      captured.duringDispatch = bridge.wrapper.getActiveContext();
      // The async continuation is launched via an inner IIFE whose
      // promise is explicitly discarded — the bus's listener
      // signature is sync-returning by contract (`DiagnosticListener
      // = (entry) => void`), and this test PINS that an async-
      // returning listener does not stretch the wrapper's context
      // window. Keeping the outer listener sync-returning mirrors
      // the bus's contract and forecloses a contributor "fixing" the
      // signature by widening it to allow promise-returning
      // listeners (which would itself be the refactor this pin is
      // designed to flag).
      void (async () => {
        await Promise.resolve();
        captured.afterMicrotask = bridge.wrapper.getActiveContext();
      })();
    });

    bridge.wrapper.notifyForSession(SESSION_A, 99, [], [cycleEntry()]);

    // Sync half: at dispatch time, context was set.
    expect(captured.duringDispatch).toEqual({ sessionId: SESSION_A, sequence: 99 });
    // Immediately after `notifyForSession` returns, the wrapper has
    // already cleared the context — the listener's awaited
    // continuation hasn't run yet.
    expect(bridge.wrapper.getActiveContext()).toBeUndefined();

    // Drain the microtask queue so the listener's continuation runs.
    // Positive control that the listener body actually completed,
    // and that the post-microtask context observation is the
    // load-bearing one — `undefined`, because the wrapper does NOT
    // re-establish context for async continuations.
    await Promise.resolve();
    expect(captured.afterMicrotask).toBeUndefined();
  });
});
