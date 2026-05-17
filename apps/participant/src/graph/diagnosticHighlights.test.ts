// Vitest cases for `diagnosticHighlights.ts` — per-entity
// diagnostic-highlight projection + identity-key parity with the
// server's `identityKeyFor`.
//
// Refinement: tasks/refinements/participant-ui/part_diagnostic_highlights.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in (mirroring the moderator's `diagnosticHighlights.test.ts`
// coverage shape so a reader cross-referencing the two ports sees the
// same pin):
//
//   1. `diagnosticIdentityKey` produces the same string as the server's
//      `identityKeyFor` for every diagnostic kind (round-trip), AND is
//      stable under adjacency-walk start-point variation for `cycle`,
//      under `edges` content for `contradiction`, under `warrantNodeIds`
//      order for `multi-warrant`.
//   2. `affectedEntities` extracts the documented entity ids per kind +
//      per coherency-hint sub-kind.
//   3. `projectDiagnosticHighlights` rolls up per-entity severity
//      (blocking wins over advisory), deduplicates kinds, preserves
//      encounter order, and returns the stable empty reference for
//      empty input.
//   4. `nodeHasDiagnostic` / `edgeHasDiagnostic` return `true` for
//      entities in the index, `false` otherwise; `diagnosticSeverityFor`
//      returns the rolled-up severity or the `'none'` sentinel.

import { describe, expect, it } from 'vitest';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import {
  affectedEntities,
  diagnosticIdentityKey,
  diagnosticSeverityFor,
  edgeHasDiagnostic,
  EMPTY_DIAGNOSTIC_HIGHLIGHTS,
  nodeHasDiagnostic,
  projectDiagnosticHighlights,
} from './diagnosticHighlights';

const SESSION = '00000000-0000-4000-8000-000000000001';
const NODE_A = 'node-a';
const NODE_B = 'node-b';
const NODE_C = 'node-c';
const EDGE_1 = 'edge-1';
const EDGE_2 = 'edge-2';

// Tiny helpers — the `diagnostic` field is `unknown` on the wire so the
// per-kind shape is provided inline. The outer envelope is shared.
function cyclePayload(
  nodes: string[],
  severity: 'blocking' | 'advisory' = 'blocking',
): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'cycle',
    severity,
    status: 'fired',
    sequence: 1,
    diagnostic: { kind: 'cycle', nodes },
  };
}

function contradictionPayload(
  nodeA: string,
  nodeB: string,
  edges: string[],
  severity: 'blocking' | 'advisory' = 'blocking',
): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'contradiction',
    severity,
    status: 'fired',
    sequence: 1,
    diagnostic: { kind: 'contradiction', nodeA, nodeB, edges },
  };
}

function multiWarrantPayload(
  dataNodeId: string,
  claimNodeId: string,
  warrantNodeIds: string[],
  severity: 'blocking' | 'advisory' = 'advisory',
): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'multi-warrant',
    severity,
    status: 'fired',
    sequence: 1,
    diagnostic: { kind: 'multi-warrant', dataNodeId, claimNodeId, warrantNodeIds },
  };
}

function danglingClaimPayload(
  nodeId: string,
  severity: 'blocking' | 'advisory' = 'advisory',
): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'dangling-claim',
    severity,
    status: 'fired',
    sequence: 1,
    diagnostic: { kind: 'dangling-claim', nodeId },
  };
}

function coherencyHintToPayload(warrantNodeId: string, dataNodeId: string): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'coherency-hint',
    severity: 'advisory',
    status: 'fired',
    sequence: 1,
    diagnostic: {
      kind: 'coherency-hint',
      hint: {
        kind: 'incomplete-warrant-missing-bridges-to',
        warrantNodeId,
        dataNodeId,
      },
    },
  };
}

function coherencyHintFromPayload(warrantNodeId: string, claimNodeId: string): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'coherency-hint',
    severity: 'advisory',
    status: 'fired',
    sequence: 1,
    diagnostic: {
      kind: 'coherency-hint',
      hint: {
        kind: 'incomplete-warrant-missing-bridges-from',
        warrantNodeId,
        claimNodeId,
      },
    },
  };
}

function coherencyHintSelfContradictsPayload(edgeId: string, nodeId: string): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'coherency-hint',
    severity: 'advisory',
    status: 'fired',
    sequence: 1,
    diagnostic: {
      kind: 'coherency-hint',
      hint: { kind: 'self-contradicts', edgeId, nodeId },
    },
  };
}

describe('diagnosticIdentityKey — round-trip parity with the server', () => {
  // The server's identityKeyFor (apps/server/src/diagnostics/event-emission.ts)
  // is the canonical formula. Each case below pins the same formula
  // applied to a wire payload; if either side drifts the cases here
  // fail. The cases reproduce the formula by string-construction so
  // the test does not depend on importing from `apps/server/*` (the
  // workspace-boundary discipline the refinement requires).

  it('cycle — same node set in two adjacency walks produces the same key', () => {
    const a = cyclePayload(['n-c', 'n-a', 'n-b']);
    const b = cyclePayload(['n-b', 'n-c', 'n-a']);
    expect(diagnosticIdentityKey(a)).toBe(diagnosticIdentityKey(b));
    expect(diagnosticIdentityKey(a)).toBe('cycle\0n-a\0n-b\0n-c');
  });

  it('contradiction — same (nodeA, nodeB) pair produces the same key regardless of `edges` content', () => {
    const a = contradictionPayload(NODE_A, NODE_B, [EDGE_1]);
    const b = contradictionPayload(NODE_A, NODE_B, [EDGE_1, EDGE_2]);
    expect(diagnosticIdentityKey(a)).toBe(diagnosticIdentityKey(b));
    expect(diagnosticIdentityKey(a)).toBe(`contradiction\0${NODE_A}\0${NODE_B}`);
  });

  it('multi-warrant — warrant id order is canonicalized via sort; adding a warrant changes the key', () => {
    // Same set of warrants in different orders produces the same key
    // (the formula sorts the warrants before joining); adding a fresh
    // warrant id flips the key.
    const a = multiWarrantPayload(NODE_A, NODE_B, ['w-3', 'w-1', 'w-2']);
    const b = multiWarrantPayload(NODE_A, NODE_B, ['w-1', 'w-2', 'w-3']);
    const c = multiWarrantPayload(NODE_A, NODE_B, ['w-1', 'w-2', 'w-3', 'w-4']);
    expect(diagnosticIdentityKey(a)).toBe(diagnosticIdentityKey(b));
    expect(diagnosticIdentityKey(a)).toBe(`multi-warrant\0${NODE_A}\0${NODE_B}\0w-1\0w-2\0w-3`);
    expect(diagnosticIdentityKey(a)).not.toBe(diagnosticIdentityKey(c));
  });

  it('dangling-claim — node id is the full identity', () => {
    const a = danglingClaimPayload(NODE_A);
    const b = danglingClaimPayload(NODE_B);
    expect(diagnosticIdentityKey(a)).toBe(`dangling-claim\0${NODE_A}`);
    expect(diagnosticIdentityKey(a)).not.toBe(diagnosticIdentityKey(b));
  });

  it('coherency-hint — top-level kind discriminator pins distinct sub-kind keys', () => {
    // Smoke-test that a coherency-hint envelope routes through the
    // sub-kind branch (the explicit per-sub-kind formula is locked in
    // the next case). Two `to`-flavoured payloads with identical
    // ids must produce the same key.
    const to1 = coherencyHintToPayload('w-1', 'd-1');
    const to2 = coherencyHintToPayload('w-1', 'd-1');
    expect(diagnosticIdentityKey(to1)).toBe(diagnosticIdentityKey(to2));
  });

  it('coherency-hint sub-kinds — each sub-kind has a distinct identity formula', () => {
    const to = coherencyHintToPayload('w-1', 'd-1');
    const from = coherencyHintFromPayload('w-1', 'c-1');
    const self = coherencyHintSelfContradictsPayload('e-1', 'n-1');
    expect(diagnosticIdentityKey(to)).toBe(
      'coherency-hint\0incomplete-warrant-missing-bridges-to\0w-1\0d-1',
    );
    expect(diagnosticIdentityKey(from)).toBe(
      'coherency-hint\0incomplete-warrant-missing-bridges-from\0w-1\0c-1',
    );
    expect(diagnosticIdentityKey(self)).toBe('coherency-hint\0self-contradicts\0e-1');
    expect(diagnosticIdentityKey(to)).not.toBe(diagnosticIdentityKey(from));
    expect(diagnosticIdentityKey(to)).not.toBe(diagnosticIdentityKey(self));
    expect(diagnosticIdentityKey(from)).not.toBe(diagnosticIdentityKey(self));
  });
});

describe('affectedEntities — per-kind extraction', () => {
  it('extracts the documented entity ids per top-level diagnostic kind', () => {
    // Per-kind table (mirrors the refinement's affected-entities matrix
    // in Decision §1):
    //   cycle           → nodes only
    //   contradiction   → nodes (the contradicting pair) AND edges
    //   multi-warrant   → nodes only (data + claim + warrants)
    //   dangling-claim  → single node
    //   coherency-hint  → routes through the sub-kind helper (pinned
    //                     in the next case)
    expect(affectedEntities(cyclePayload([NODE_A, NODE_B, NODE_C]))).toEqual({
      nodes: [NODE_A, NODE_B, NODE_C],
      edges: [],
    });
    expect(affectedEntities(contradictionPayload(NODE_A, NODE_B, [EDGE_1, EDGE_2]))).toEqual({
      nodes: [NODE_A, NODE_B],
      edges: [EDGE_1, EDGE_2],
    });
    expect(affectedEntities(multiWarrantPayload(NODE_A, NODE_B, [NODE_C, 'node-d']))).toEqual({
      nodes: [NODE_A, NODE_B, NODE_C, 'node-d'],
      edges: [],
    });
    expect(affectedEntities(danglingClaimPayload(NODE_A))).toEqual({
      nodes: [NODE_A],
      edges: [],
    });
  });

  it('extracts the documented entity ids per coherency-hint sub-kind', () => {
    expect(affectedEntities(coherencyHintToPayload('w-1', 'd-1'))).toEqual({
      nodes: ['w-1', 'd-1'],
      edges: [],
    });
    expect(affectedEntities(coherencyHintFromPayload('w-1', 'c-1'))).toEqual({
      nodes: ['w-1', 'c-1'],
      edges: [],
    });
    // self-contradicts is the only kind/sub-kind combination besides
    // contradiction that puts an edge into the index.
    expect(affectedEntities(coherencyHintSelfContradictsPayload('e-1', 'n-1'))).toEqual({
      nodes: ['n-1'],
      edges: ['e-1'],
    });
  });
});

describe('projectDiagnosticHighlights — rollup semantics', () => {
  it('blocking wins over advisory when an entity appears in both (one-way demotion)', () => {
    // Same node id is hit by a blocking cycle AND an advisory
    // coherency-hint; the rollup must resolve to blocking regardless
    // of insertion order.
    const cycle = cyclePayload([NODE_A, NODE_B], 'blocking');
    const hint = coherencyHintSelfContradictsPayload(EDGE_1, NODE_A);
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(cycle), cycle],
      [diagnosticIdentityKey(hint), hint],
    ]);
    const index = projectDiagnosticHighlights(map);
    expect(index.nodes.get(NODE_A)?.severity).toBe('blocking');
    // Both kinds are recorded, in encounter order (cycle first).
    expect(index.nodes.get(NODE_A)?.kinds).toEqual(['cycle', 'coherency-hint']);

    // Insertion-order-flipped: advisory hint first, blocking cycle
    // second. Result still resolves to blocking.
    const flipped = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(hint), hint],
      [diagnosticIdentityKey(cycle), cycle],
    ]);
    const flippedIndex = projectDiagnosticHighlights(flipped);
    expect(flippedIndex.nodes.get(NODE_A)?.severity).toBe('blocking');
    expect(flippedIndex.nodes.get(NODE_A)?.kinds).toEqual(['coherency-hint', 'cycle']);
  });

  it('kinds dedupe across multiple diagnostics of the same kind, preserve encounter order across kinds', () => {
    // Two different cycles both include NODE_A → kinds: ['cycle'].
    const c1 = cyclePayload([NODE_A, NODE_B], 'blocking');
    const c2 = cyclePayload([NODE_A, NODE_C], 'blocking');
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(c1), c1],
      [diagnosticIdentityKey(c2), c2],
    ]);
    const index = projectDiagnosticHighlights(map);
    expect(index.nodes.get(NODE_A)?.kinds).toEqual(['cycle']);

    // Then add a multi-warrant on the same node → kinds in encounter
    // order: ['cycle', 'multi-warrant'].
    const mw = multiWarrantPayload(NODE_A, 'node-d', ['node-w'], 'advisory');
    const map2 = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(c1), c1],
      [diagnosticIdentityKey(mw), mw],
    ]);
    const index2 = projectDiagnosticHighlights(map2);
    expect(index2.nodes.get(NODE_A)?.kinds).toEqual(['cycle', 'multi-warrant']);
  });

  it('empty input returns the stable EMPTY_DIAGNOSTIC_HIGHLIGHTS reference', () => {
    const result = projectDiagnosticHighlights(new Map());
    // Reference equality — the empty-input fast path returns the
    // module-level constant so React / Cytoscape memoization stays
    // stable for the no-diagnostic baseline.
    expect(result).toBe(EMPTY_DIAGNOSTIC_HIGHLIGHTS);
  });
});

describe('nodeHasDiagnostic / edgeHasDiagnostic / diagnosticSeverityFor — thin helpers', () => {
  it('return presence + severity for entities in the index, "none"/false otherwise', () => {
    // Self-contradicts is the cheapest construction touching BOTH a
    // node AND an edge (the helpers' symmetry pin).
    const hint = coherencyHintSelfContradictsPayload(EDGE_1, NODE_A);
    const blocking = cyclePayload([NODE_A], 'blocking');
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(hint), hint],
      [diagnosticIdentityKey(blocking), blocking],
    ]);
    const index = projectDiagnosticHighlights(map);

    // Presence helpers.
    expect(nodeHasDiagnostic(index, NODE_A)).toBe(true);
    expect(nodeHasDiagnostic(index, NODE_B)).toBe(false);
    expect(edgeHasDiagnostic(index, EDGE_1)).toBe(true);
    expect(edgeHasDiagnostic(index, EDGE_2)).toBe(false);

    // Severity helper (with the `'none'` sentinel).
    expect(diagnosticSeverityFor(index, 'node', NODE_A)).toBe('blocking');
    expect(diagnosticSeverityFor(index, 'node', NODE_B)).toBe('none');
    expect(diagnosticSeverityFor(index, 'edge', EDGE_1)).toBe('advisory');
    expect(diagnosticSeverityFor(index, 'edge', EDGE_2)).toBe('none');
  });
});
