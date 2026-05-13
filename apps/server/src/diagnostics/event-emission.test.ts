// Tests for `computeAllDiagnostics`, `diffDiagnostics`, `identityKeyFor`,
// and `DiagnosticBus`.
//
// Refinement: tasks/refinements/data-and-methodology/diagnostic_event_emission.md
// TaskJuggler: data_and_methodology.diagnostics.diagnostic_event_emission
//
// Coverage:
//   - computeAllDiagnostics:
//     - Empty projection → empty list.
//     - One cycle → one entry of kind 'cycle'.
//     - One cycle + one multi-warrant → two entries; aggregator order
//       puts the cycle first.
//     - Excludes pending-consequences. A projection that produces a
//       PendingConsequence (agreed edge with unagreed source) is NOT
//       surfaced in the aggregator output.
//   - diffDiagnostics:
//     - diff([], [cycle]) → fired contains the cycle, cleared empty.
//     - diff([cycle], []) → cleared contains the cycle, fired empty.
//     - diff([cycle], [cycle]) → both empty (no change).
//     - diff([cycleA], [cycleB]) (different cycles) → cycleA cleared,
//       cycleB fired.
//     - cycle canonicalization: two cycles with the same node set in
//       different adjacency-walk orders diff as identical.
//     - multi-warrant identity is sensitive to the warrant set; a
//       warrant added or removed produces cleared + fired.
//     - contradiction identity is the node pair; a contradiction
//       gaining its reverse-direction edge is the same diagnostic.
//     - coherency-hint identity per variant.
//   - DiagnosticBus:
//     - fired listener fires for each fired entry.
//     - cleared listener fires for each cleared entry.
//     - unsubscribed listener does not fire.
//     - multiple listeners are dispatched in registration order.
//     - listenerCount reflects the current registration set.
//
// Reuses the seedSession / createNode / createEdge / commitNodeAgreed /
// commitEdgeAgreed helper pattern from `cycle-detection.test.ts`. Each
// test builds a fresh projection via TS-literal events and applies
// them through `applyEvent`; no DB. The Cucumber feature at
// tests/behavior/diagnostics/event-emission.feature exercises the
// round-tripped path through pglite's session_events table.

import { describe, expect, it } from 'vitest';

import type { Event, EdgeRole } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../projection/projection.js';
import { applyEvent } from '../projection/replay.js';
import {
  computeAllDiagnostics,
  diffDiagnostics,
  identityKeyFor,
  DiagnosticBus,
  type DiagnosticEntry,
  type CycleDiagnosticEntry,
  type ContradictionDiagnosticEntry,
  type MultiWarrantDiagnosticEntry,
  type CoherencyHintDiagnosticEntry,
} from './event-emission.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111188';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';

const NODE_A = '66666666-6666-4666-8666-666666666601';
const NODE_B = '66666666-6666-4666-8666-666666666602';
const NODE_C = '66666666-6666-4666-8666-666666666603';
const NODE_D = '66666666-6666-4666-8666-666666666604';
// For the multi-warrant scenario — disjoint from the cycle (A, B, C).
const NODE_MW_D = '66666666-6666-4666-8666-666666666621';
const NODE_MW_C = '66666666-6666-4666-8666-666666666622';
const NODE_W1 = '66666666-6666-4666-8666-666666666611';
const NODE_W2 = '66666666-6666-4666-8666-666666666612';
const NODE_W3 = '66666666-6666-4666-8666-666666666613';

const EDGE_AB = '77777777-7777-4777-8777-777777777712';
const EDGE_BC = '77777777-7777-4777-8777-777777777723';
const EDGE_CA = '77777777-7777-4777-8777-777777777731';
const EDGE_AB_C = '77777777-7777-4777-8777-77777aabbccd';
const EDGE_BA_C = '77777777-7777-4777-8777-77777bbaacce';
// Multi-warrant edges (warrant -> D / -> C).
const EDGE_W1_FROM_D = '77777777-7777-4777-8777-777777777811';
const EDGE_W1_TO_C = '77777777-7777-4777-8777-777777777812';
const EDGE_W2_FROM_D = '77777777-7777-4777-8777-777777777821';
const EDGE_W2_TO_C = '77777777-7777-4777-8777-777777777822';

const T0 = '2026-05-12T12:00:00Z';
const T1 = '2026-05-12T12:00:01Z';
const T2 = '2026-05-12T12:00:02Z';
const T3 = '2026-05-12T12:00:03Z';
const T4 = '2026-05-12T12:00:04Z';
const T7 = '2026-05-12T12:00:07Z';

function evId(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

function makeEvent<K extends Event['kind']>(
  sequence: number,
  kind: K,
  actor: string | null,
  createdAt: string,
  payload: Extract<Event, { kind: K }>['payload'],
): Extract<Event, { kind: K }> {
  return {
    id: evId(sequence),
    sessionId: SESSION_ID,
    sequence,
    kind,
    actor,
    payload,
    createdAt,
  } as Extract<Event, { kind: K }>;
}

let seq = 1;
let propCounter = 0x100;

function nextSeq(): number {
  return seq++;
}

function resetSeq(): void {
  seq = 1;
  propCounter = 0x100;
}

function nextProposalId(): string {
  propCounter++;
  const hex = propCounter.toString(16).padStart(12, '0');
  return `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`;
}

type Projection = ReturnType<typeof createEmptyProjection>;

function seedSession(): Projection {
  const projection = createEmptyProjection(SESSION_ID);
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'session-created', HOST_ID, T0, {
      host_user_id: HOST_ID,
      privacy: 'public',
      topic: 't',
      created_at: T0,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'participant-joined', MODERATOR_ID, T1, {
      user_id: MODERATOR_ID,
      role: 'moderator',
      screen_name: 'M',
      joined_at: T1,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'participant-joined', DEBATER_A_ID, T1, {
      user_id: DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'A',
      joined_at: T1,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'participant-joined', DEBATER_B_ID, T1, {
      user_id: DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'B',
      joined_at: T1,
    }),
  );
  return projection;
}

function createNode(projection: Projection, nodeId: string, wording: string): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'node-created', DEBATER_A_ID, T2, {
      node_id: nodeId,
      wording,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
}

function createEdge(
  projection: Projection,
  edgeId: string,
  source: string,
  target: string,
  role: EdgeRole = 'supports',
): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
      edge_id: edgeId,
      role,
      source_node_id: source,
      target_node_id: target,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
}

function castVote(
  projection: Projection,
  proposalId: string,
  participant: string,
  vote: 'agree' | 'dispute' | 'withdraw',
): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'vote', participant, T4, {
      proposal_id: proposalId,
      participant,
      vote,
      voted_at: T4,
    }),
  );
}

function commit(projection: Projection, proposalId: string): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'commit', MODERATOR_ID, T7, {
      proposal_id: proposalId,
      moderator: MODERATOR_ID,
      committed_at: T7,
    }),
  );
}

function allAgree(projection: Projection, proposalId: string): void {
  castVote(projection, proposalId, MODERATOR_ID, 'agree');
  castVote(projection, proposalId, DEBATER_A_ID, 'agree');
  castVote(projection, proposalId, DEBATER_B_ID, 'agree');
}

function commitNodeAgreed(projection: Projection, nodeId: string): void {
  const proposalId = nextProposalId();
  applyEvent(projection, {
    ...makeEvent(nextSeq(), 'proposal', DEBATER_A_ID, T3, {
      proposal: { kind: 'set-node-substance', node_id: nodeId, value: 'agreed' },
    }),
    id: proposalId,
  });
  allAgree(projection, proposalId);
  commit(projection, proposalId);
}

function commitEdgeAgreed(projection: Projection, edgeId: string): void {
  const proposalId = nextProposalId();
  applyEvent(projection, {
    ...makeEvent(nextSeq(), 'proposal', DEBATER_A_ID, T3, {
      proposal: { kind: 'set-edge-substance', edge_id: edgeId, value: 'agreed' },
    }),
    id: proposalId,
  });
  allAgree(projection, proposalId);
  commit(projection, proposalId);
}

// Build a 3-node supports cycle A → B → C → A with every node and
// every edge committed-substance-agreed.
function buildThreeNodeCycle(projection: Projection): void {
  createNode(projection, NODE_A, 'A');
  createNode(projection, NODE_B, 'B');
  createNode(projection, NODE_C, 'C');
  createEdge(projection, EDGE_AB, NODE_A, NODE_B);
  createEdge(projection, EDGE_BC, NODE_B, NODE_C);
  createEdge(projection, EDGE_CA, NODE_C, NODE_A);
  commitNodeAgreed(projection, NODE_A);
  commitNodeAgreed(projection, NODE_B);
  commitNodeAgreed(projection, NODE_C);
  commitEdgeAgreed(projection, EDGE_AB);
  commitEdgeAgreed(projection, EDGE_BC);
  commitEdgeAgreed(projection, EDGE_CA);
}

// Build a multi-warrant pattern with two warrants W1, W2 bridging D→C.
// Uses NODE_MW_D / NODE_MW_C — disjoint from the cycle node set so
// the two patterns can coexist in one projection.
function buildTwoWarrantBridge(projection: Projection): void {
  createNode(projection, NODE_MW_D, 'D');
  createNode(projection, NODE_MW_C, 'C');
  createNode(projection, NODE_W1, 'W1');
  createNode(projection, NODE_W2, 'W2');
  createEdge(projection, EDGE_W1_FROM_D, NODE_W1, NODE_MW_D, 'bridges-from');
  createEdge(projection, EDGE_W1_TO_C, NODE_W1, NODE_MW_C, 'bridges-to');
  createEdge(projection, EDGE_W2_FROM_D, NODE_W2, NODE_MW_D, 'bridges-from');
  createEdge(projection, EDGE_W2_TO_C, NODE_W2, NODE_MW_C, 'bridges-to');
}

// ---------------------------------------------------------------
// Synthetic DiagnosticEntry constructors — for testing the diff and
// the bus in isolation from the detectors. Useful where the detector
// behavior isn't what's under test.
// ---------------------------------------------------------------

function cycleEntry(...nodes: string[]): CycleDiagnosticEntry {
  return { kind: 'cycle', nodes };
}

function contradictionEntry(
  nodeA: string,
  nodeB: string,
  ...edges: string[]
): ContradictionDiagnosticEntry {
  return { kind: 'contradiction', nodeA, nodeB, edges };
}

function multiWarrantEntry(
  dataNodeId: string,
  claimNodeId: string,
  warrantNodeIds: string[],
): MultiWarrantDiagnosticEntry {
  return { kind: 'multi-warrant', dataNodeId, claimNodeId, warrantNodeIds };
}

// ---------------------------------------------------------------
// computeAllDiagnostics.
// ---------------------------------------------------------------

describe('computeAllDiagnostics', () => {
  it('empty projection → empty list', () => {
    resetSeq();
    const projection = seedSession();
    expect(computeAllDiagnostics(projection)).toEqual([]);
  });

  it('projection with one cycle → one entry of kind cycle', () => {
    resetSeq();
    const projection = seedSession();
    buildThreeNodeCycle(projection);
    const all = computeAllDiagnostics(projection);
    expect(all).toHaveLength(1);
    const first = all[0];
    expect(first?.kind).toBe('cycle');
    if (first?.kind !== 'cycle') throw new Error('unreachable');
    expect(new Set(first.nodes)).toEqual(new Set([NODE_A, NODE_B, NODE_C]));
  });

  it('projection with one cycle + one multi-warrant → at least two entries; cycle precedes multi-warrant', () => {
    // The multi-warrant pattern also incidentally triggers a
    // dangling-claim entry for the (D, C) data node — D has incoming
    // bridges-from edges (so it's claim-positioned) but no incoming
    // supports/rebuts/bridges-to, so the dangling-claim detector
    // surfaces it. That's an interaction of the detectors, not a
    // contract of this aggregator. Assert the fixed aggregator
    // ordering (cycle → contradiction → multi-warrant → dangling-claim
    // → coherency-hint) and the presence of the cycle and multi-
    // warrant; tolerate any incidental dangling-claim entry.
    resetSeq();
    const projection = seedSession();
    buildThreeNodeCycle(projection);
    buildTwoWarrantBridge(projection);
    const all = computeAllDiagnostics(projection);
    const kinds = all.map((e) => e.kind);
    expect(kinds).toContain('cycle');
    expect(kinds).toContain('multi-warrant');
    // Cycle comes before multi-warrant in the aggregator's fixed order.
    expect(kinds.indexOf('cycle')).toBeLessThan(kinds.indexOf('multi-warrant'));
  });

  it('excludes pending-consequences (per stub-framing)', () => {
    // A pending consequence is an agreed-substance edge whose source
    // is not agreed. Build A -> B (supports), commit the edge but
    // leave A's substance unagreed. detectPendingConsequences would
    // surface this; computeAllDiagnostics must not.
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B);
    commitEdgeAgreed(projection, EDGE_AB);
    // A's substance left unagreed. B's substance does not matter for
    // pending-consequences; we leave it unagreed too.
    const all = computeAllDiagnostics(projection);
    // No entry of kind 'pending-consequence' is possible (it's not in
    // the union); assert no entry was wrapped under the unrelated
    // 'dangling-claim' kind either (B has incoming supports, so it's
    // justified; A has none, but no incoming edges at all means
    // dangling-claim does not fire).
    expect(all.every((e) => e.kind !== 'dangling-claim')).toBe(true);
    // The aggregator MUST NOT have a 'pending-consequence' kind at
    // the type level; check via Set of kinds.
    const kinds = new Set(all.map((e) => e.kind));
    expect(kinds.has('cycle' as const)).toBe(false);
    expect(kinds.has('contradiction' as const)).toBe(false);
    expect(kinds.has('multi-warrant' as const)).toBe(false);
    expect(kinds.has('coherency-hint' as const)).toBe(false);
  });
});

// ---------------------------------------------------------------
// diffDiagnostics — basics.
// ---------------------------------------------------------------

describe('diffDiagnostics', () => {
  it('diff([], [cycleA]) → cycleA fired, cleared empty', () => {
    const cycleA = cycleEntry(NODE_A, NODE_B, NODE_C);
    const { fired, cleared } = diffDiagnostics([], [cycleA]);
    expect(fired).toEqual([cycleA]);
    expect(cleared).toEqual([]);
  });

  it('diff([cycleA], []) → cycleA cleared, fired empty', () => {
    const cycleA = cycleEntry(NODE_A, NODE_B, NODE_C);
    const { fired, cleared } = diffDiagnostics([cycleA], []);
    expect(fired).toEqual([]);
    expect(cleared).toEqual([cycleA]);
  });

  it('diff([cycleA], [cycleA]) → both empty (no change)', () => {
    const cycleA = cycleEntry(NODE_A, NODE_B, NODE_C);
    const { fired, cleared } = diffDiagnostics([cycleA], [cycleA]);
    expect(fired).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it('diff([cycleA], [cycleB]) (different cycles) → cycleA cleared, cycleB fired', () => {
    const cycleA = cycleEntry(NODE_A, NODE_B, NODE_C);
    // Different node set — different cycle.
    const cycleB = cycleEntry(NODE_A, NODE_B, NODE_D);
    const { fired, cleared } = diffDiagnostics([cycleA], [cycleB]);
    expect(fired).toEqual([cycleB]);
    expect(cleared).toEqual([cycleA]);
  });
});

// ---------------------------------------------------------------
// diffDiagnostics — identity-key canonicalization.
// ---------------------------------------------------------------

describe('diffDiagnostics identity canonicalization', () => {
  it('cycle: two adjacency-walk orders over the same node set are the same diagnostic', () => {
    const walk1 = cycleEntry(NODE_A, NODE_B, NODE_C);
    const walk2 = cycleEntry(NODE_B, NODE_C, NODE_A);
    expect(identityKeyFor(walk1)).toBe(identityKeyFor(walk2));
    const { fired, cleared } = diffDiagnostics([walk1], [walk2]);
    expect(fired).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it('multi-warrant: adding a warrant to the (D, C) group fires + clears', () => {
    const before = multiWarrantEntry(NODE_D, NODE_C, [NODE_W1, NODE_W2]);
    const after = multiWarrantEntry(NODE_D, NODE_C, [NODE_W1, NODE_W2, NODE_W3]);
    const { fired, cleared } = diffDiagnostics([before], [after]);
    expect(fired).toEqual([after]);
    expect(cleared).toEqual([before]);
  });

  it('multi-warrant: removing a warrant from the (D, C) group fires + clears', () => {
    const before = multiWarrantEntry(NODE_D, NODE_C, [NODE_W1, NODE_W2, NODE_W3]);
    const after = multiWarrantEntry(NODE_D, NODE_C, [NODE_W1, NODE_W2]);
    const { fired, cleared } = diffDiagnostics([before], [after]);
    expect(fired).toEqual([after]);
    expect(cleared).toEqual([before]);
  });

  it('contradiction: same pair with one or two edges is the same diagnostic', () => {
    const singleEdge = contradictionEntry(NODE_A, NODE_B, EDGE_AB_C);
    const symmetric = contradictionEntry(NODE_A, NODE_B, EDGE_AB_C, EDGE_BA_C);
    expect(identityKeyFor(singleEdge)).toBe(identityKeyFor(symmetric));
    const { fired, cleared } = diffDiagnostics([singleEdge], [symmetric]);
    expect(fired).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it('coherency-hint: two incomplete-warrant-missing-bridges-to hints with different data nodes are different diagnostics', () => {
    const h1: CoherencyHintDiagnosticEntry = {
      kind: 'coherency-hint',
      hint: {
        kind: 'incomplete-warrant-missing-bridges-to',
        warrantNodeId: NODE_W1,
        dataNodeId: NODE_D,
      },
    };
    const h2: CoherencyHintDiagnosticEntry = {
      kind: 'coherency-hint',
      hint: {
        kind: 'incomplete-warrant-missing-bridges-to',
        warrantNodeId: NODE_W1,
        dataNodeId: NODE_A,
      },
    };
    expect(identityKeyFor(h1)).not.toBe(identityKeyFor(h2));
    const { fired, cleared } = diffDiagnostics([h1], [h2]);
    expect(fired).toEqual([h2]);
    expect(cleared).toEqual([h1]);
  });

  it('coherency-hint: different hint kinds with overlapping ids are different diagnostics', () => {
    // Same warrant id used in two different hint kinds; identity
    // includes the hint kind so they don't collide.
    const incompleteTo: CoherencyHintDiagnosticEntry = {
      kind: 'coherency-hint',
      hint: {
        kind: 'incomplete-warrant-missing-bridges-to',
        warrantNodeId: NODE_W1,
        dataNodeId: NODE_D,
      },
    };
    const selfContradicts: CoherencyHintDiagnosticEntry = {
      kind: 'coherency-hint',
      hint: { kind: 'self-contradicts', edgeId: NODE_W1, nodeId: NODE_W1 },
    };
    expect(identityKeyFor(incompleteTo)).not.toBe(identityKeyFor(selfContradicts));
  });
});

// ---------------------------------------------------------------
// DiagnosticBus.
// ---------------------------------------------------------------

describe('DiagnosticBus', () => {
  it('fired listener fires for each fired entry', () => {
    const bus = new DiagnosticBus();
    const received: DiagnosticEntry[] = [];
    bus.on('fired', (entry) => received.push(entry));
    const cycleA = cycleEntry(NODE_A, NODE_B, NODE_C);
    const cycleB = cycleEntry(NODE_A, NODE_B, NODE_D);
    bus.notify([], [cycleA, cycleB]);
    expect(received).toEqual([cycleA, cycleB]);
  });

  it('cleared listener fires for each cleared entry', () => {
    const bus = new DiagnosticBus();
    const received: DiagnosticEntry[] = [];
    bus.on('cleared', (entry) => received.push(entry));
    const cycleA = cycleEntry(NODE_A, NODE_B, NODE_C);
    bus.notify([cycleA], []);
    expect(received).toEqual([cycleA]);
  });

  it('unsubscribed listener does not fire', () => {
    const bus = new DiagnosticBus();
    const received: DiagnosticEntry[] = [];
    const off = bus.on('fired', (entry) => received.push(entry));
    off();
    const cycleA = cycleEntry(NODE_A, NODE_B, NODE_C);
    bus.notify([], [cycleA]);
    expect(received).toEqual([]);
  });

  it('multiple listeners are dispatched in registration order', () => {
    const bus = new DiagnosticBus();
    const order: string[] = [];
    bus.on('fired', () => order.push('first'));
    bus.on('fired', () => order.push('second'));
    bus.on('fired', () => order.push('third'));
    const cycleA = cycleEntry(NODE_A, NODE_B, NODE_C);
    bus.notify([], [cycleA]);
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('fired and cleared listeners are dispatched independently', () => {
    const bus = new DiagnosticBus();
    const firedCalls: DiagnosticEntry[] = [];
    const clearedCalls: DiagnosticEntry[] = [];
    bus.on('fired', (e) => firedCalls.push(e));
    bus.on('cleared', (e) => clearedCalls.push(e));
    const cycleA = cycleEntry(NODE_A, NODE_B, NODE_C);
    const cycleB = cycleEntry(NODE_A, NODE_B, NODE_D);
    // prev: [cycleA] -> next: [cycleB] => cycleA cleared, cycleB fired.
    bus.notify([cycleA], [cycleB]);
    expect(firedCalls).toEqual([cycleB]);
    expect(clearedCalls).toEqual([cycleA]);
  });

  it('listenerCount reflects the current registration set', () => {
    const bus = new DiagnosticBus();
    expect(bus.listenerCount('fired')).toBe(0);
    expect(bus.listenerCount('cleared')).toBe(0);
    const off1 = bus.on('fired', () => undefined);
    bus.on('fired', () => undefined);
    bus.on('cleared', () => undefined);
    expect(bus.listenerCount('fired')).toBe(2);
    expect(bus.listenerCount('cleared')).toBe(1);
    off1();
    expect(bus.listenerCount('fired')).toBe(1);
  });

  it('notify with no changes dispatches no listeners', () => {
    const bus = new DiagnosticBus();
    let firedCount = 0;
    let clearedCount = 0;
    bus.on('fired', () => firedCount++);
    bus.on('cleared', () => clearedCount++);
    const cycleA = cycleEntry(NODE_A, NODE_B, NODE_C);
    bus.notify([cycleA], [cycleA]);
    expect(firedCount).toBe(0);
    expect(clearedCount).toBe(0);
  });
});

// ---------------------------------------------------------------
// DiagnosticBus — synchronous-dispatch contract (G-016).
// ---------------------------------------------------------------
//
// Source finding: docs/security/m3-review/coverage.md G-016.
// Refinement:    tasks/refinements/backend-hardening/diagnostic_sync_dispatch_pin.md
//
// This block pins the **current** synchronous-dispatch contract of
// `DiagnosticBus.notify(...)`. The contract is stated in the class's
// own leading comment ("Synchronous dispatch, no error handling") and
// is depended on by `WsDiagnosticBroadcast.notifyForSession`'s
// context-window pattern in `apps/server/src/ws/broadcast/diagnostic.ts`
// (the wrapper sets active context BEFORE `bus.notify(...)` and clears
// it in `finally` AFTER — the pattern is only safe if `notify` returns
// AFTER every listener has finished).
//
// **If a future refactor makes the bus async-aware** (e.g., adds
// `await listener(entry)` inside `notify`'s loop, or queues dispatch
// through `Promise.resolve()` / `queueMicrotask` / `setImmediate`),
// these tests WILL fail — and that's the load-bearing signal. The
// failure is a prompt to ALSO re-align the wrapper's context-window
// pattern (today a single-slot mutable holder; under async dispatch it
// would need an async-local store, a per-call closure, or an entry-
// level context field). **This test IS the canonical doc of the
// dispatch shape**; updating it is the structural step that surfaces
// the cross-cutting refactor to reviewers.
//
// The discriminating-sentinel pattern (see the first `it(...)`):
// a naive single-boolean sentinel passes under both sync dispatch AND
// a hypothetical async-aware bus that `await`s listeners — because
// awaiting an immediately-resolving function returns in the same
// microtask tick. The discriminator is the GAP between "the listener
// body started executing" and "every promise the listener returned
// has resolved." Sync dispatch sees the former but not the latter at
// `notify`'s return time; async-aware dispatch would see both.

describe('DiagnosticBus — synchronous-dispatch contract (G-016)', () => {
  it('returns AFTER each listener body has run synchronously, BEFORE any awaited microtask resolves', async () => {
    const bus = new DiagnosticBus();
    let syncSentinel = false;
    let microtaskSentinel = false;

    // A listener that sets a sync sentinel synchronously, then
    // schedules a microtask that sets a second sentinel. The bus's
    // `notify(...)` does NOT await any promise the listener might
    // return (today's contract). After `notify` returns, the sync
    // sentinel MUST be set (the listener body ran) and the microtask
    // sentinel MUST NOT be set (the bus did not drain the listener's
    // microtask queue). A future async-aware bus that `await`s each
    // listener would set BOTH and this assertion would fail.
    //
    // The async work is launched via an inner IIFE whose promise is
    // explicitly discarded (`void`), so the listener's outer return
    // type stays `void` per `DiagnosticListener`. Switching the outer
    // signature to `async` would itself be the kind of refactor this
    // test is designed to flag — keeping the listener synchronous-
    // returning preserves the test's discriminator role.
    bus.on('fired', () => {
      syncSentinel = true;
      void (async () => {
        await Promise.resolve();
        microtaskSentinel = true;
      })();
    });

    const cycleA = cycleEntry(NODE_A, NODE_B, NODE_C);
    bus.notify([], [cycleA]);

    // Sync half: listener body ran inside `notify(...)`.
    expect(syncSentinel).toBe(true);
    // Async half: the listener's returned promise was NOT awaited by
    // the bus. The microtask has not yet been drained.
    expect(microtaskSentinel).toBe(false);

    // Positive control — drain the microtask queue and confirm the
    // microtask sentinel flips. Without this, a refactor that simply
    // DOESN'T CALL THE LISTENER would also pass the assertions above.
    await Promise.resolve();
    expect(microtaskSentinel).toBe(true);
  });

  it('ignores promises returned by listeners — multiple async listeners do not extend notify', async () => {
    const bus = new DiagnosticBus();
    let firstMicrotaskSentinel = false;
    let secondMicrotaskSentinel = false;

    bus.on('fired', () => {
      void (async () => {
        await Promise.resolve();
        firstMicrotaskSentinel = true;
      })();
    });
    bus.on('fired', () => {
      void (async () => {
        await Promise.resolve();
        await Promise.resolve();
        secondMicrotaskSentinel = true;
      })();
    });

    const cycleA = cycleEntry(NODE_A, NODE_B, NODE_C);
    bus.notify([], [cycleA]);

    // Neither microtask sentinel is set at `notify`'s return —
    // the bus dispatched the listener bodies synchronously but did
    // NOT await the returned promises.
    expect(firstMicrotaskSentinel).toBe(false);
    expect(secondMicrotaskSentinel).toBe(false);

    // Drain enough microtask ticks for the deepest listener to
    // complete — positive control that the listeners DID run.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(firstMicrotaskSentinel).toBe(true);
    expect(secondMicrotaskSentinel).toBe(true);
  });
});
