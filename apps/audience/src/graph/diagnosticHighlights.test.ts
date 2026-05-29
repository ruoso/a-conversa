// Vitest cases pinning the audience-side `diagnosticHighlights.ts`
// helpers — the identity-key formula, the per-kind `affectedEntities`
// projection, and the `flattenActiveDiagnosticsForFire` overlay-feeder.
//
// Refinement: tasks/refinements/audience/aud_diagnostic_fire_animation.md
//   (Acceptance — ~12 cases. The identity-key formula MUST round-trip
//   byte-identical to the participant's port; if a server-side identity
//   key changes without this file updating, the diagnostic `fired` /
//   `cleared` matching at the WS-store layer silently breaks and leaks
//   active entries forever. The hand-built payloads here are the same
//   shape the participant's own suite uses; a future server-side drift
//   fails both suites at once.)
//
// ADRs: 0022 (no throwaway verifications).

import { describe, expect, it } from 'vitest';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import {
  affectedEntities,
  diagnosticIdentityKey,
  flattenActiveDiagnosticsForEdgeFire,
  flattenActiveDiagnosticsForFire,
} from './diagnosticHighlights';

const SESSION = '00000000-0000-4000-8000-000000000001';
const N_A = '00000000-0000-4000-8000-0000000000a1';
const N_B = '00000000-0000-4000-8000-0000000000a2';
const N_C = '00000000-0000-4000-8000-0000000000a3';
const N_D = '00000000-0000-4000-8000-0000000000a4';
const E_1 = '00000000-0000-4000-8000-0000000000e1';

function cyclePayload(nodes: readonly string[]): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'cycle',
    severity: 'blocking',
    status: 'fired',
    sequence: 1,
    diagnostic: { kind: 'cycle', nodes },
  };
}

function contradictionPayload(
  nodeA: string,
  nodeB: string,
  edges: readonly string[],
): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'contradiction',
    severity: 'blocking',
    status: 'fired',
    sequence: 2,
    diagnostic: { kind: 'contradiction', nodeA, nodeB, edges },
  };
}

function multiWarrantPayload(
  dataNodeId: string,
  claimNodeId: string,
  warrantNodeIds: readonly string[],
): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'multi-warrant',
    severity: 'advisory',
    status: 'fired',
    sequence: 3,
    diagnostic: { kind: 'multi-warrant', dataNodeId, claimNodeId, warrantNodeIds },
  };
}

function danglingClaimPayload(nodeId: string): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'dangling-claim',
    severity: 'advisory',
    status: 'fired',
    sequence: 4,
    diagnostic: { kind: 'dangling-claim', nodeId },
  };
}

function coherencyHintBridgesToPayload(
  warrantNodeId: string,
  dataNodeId: string,
): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'coherency-hint',
    severity: 'advisory',
    status: 'fired',
    sequence: 5,
    diagnostic: {
      kind: 'coherency-hint',
      hint: { kind: 'incomplete-warrant-missing-bridges-to', warrantNodeId, dataNodeId },
    },
  };
}

function coherencyHintBridgesFromPayload(
  warrantNodeId: string,
  claimNodeId: string,
): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'coherency-hint',
    severity: 'advisory',
    status: 'fired',
    sequence: 6,
    diagnostic: {
      kind: 'coherency-hint',
      hint: { kind: 'incomplete-warrant-missing-bridges-from', warrantNodeId, claimNodeId },
    },
  };
}

function coherencyHintSelfContradictsPayload(edgeId: string, nodeId: string): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'coherency-hint',
    severity: 'advisory',
    status: 'fired',
    sequence: 7,
    diagnostic: {
      kind: 'coherency-hint',
      hint: { kind: 'self-contradicts', edgeId, nodeId },
    },
  };
}

describe('diagnosticIdentityKey', () => {
  it('cycle: sorts node ids and joins with the kind prefix + NUL separators', () => {
    // Order independence: a cycle is the same diagnostic no matter the
    // server-side traversal order; the sort ensures `fired` and a
    // later `cleared` (different traversal order) match.
    expect(diagnosticIdentityKey(cyclePayload([N_B, N_A, N_C]))).toBe(
      `cycle\0${N_A}\0${N_B}\0${N_C}`,
    );
    expect(diagnosticIdentityKey(cyclePayload([N_C, N_B, N_A]))).toBe(
      `cycle\0${N_A}\0${N_B}\0${N_C}`,
    );
  });

  it('contradiction: kind prefix + nodeA + nodeB (NOT sorted — directional pair)', () => {
    expect(diagnosticIdentityKey(contradictionPayload(N_A, N_B, [E_1]))).toBe(
      `contradiction\0${N_A}\0${N_B}`,
    );
  });

  it('multi-warrant: kind prefix + data node + claim node + sorted warrant ids', () => {
    expect(diagnosticIdentityKey(multiWarrantPayload(N_A, N_B, [N_D, N_C]))).toBe(
      `multi-warrant\0${N_A}\0${N_B}\0${N_C}\0${N_D}`,
    );
  });

  it('dangling-claim: kind prefix + node id', () => {
    expect(diagnosticIdentityKey(danglingClaimPayload(N_A))).toBe(`dangling-claim\0${N_A}`);
  });

  it('coherency-hint sub-kinds: each sub-kind serializes with its own discriminator + ids', () => {
    expect(diagnosticIdentityKey(coherencyHintBridgesToPayload(N_A, N_B))).toBe(
      `coherency-hint\0incomplete-warrant-missing-bridges-to\0${N_A}\0${N_B}`,
    );
    expect(diagnosticIdentityKey(coherencyHintBridgesFromPayload(N_A, N_B))).toBe(
      `coherency-hint\0incomplete-warrant-missing-bridges-from\0${N_A}\0${N_B}`,
    );
    expect(diagnosticIdentityKey(coherencyHintSelfContradictsPayload(E_1, N_A))).toBe(
      `coherency-hint\0self-contradicts\0${E_1}`,
    );
  });
});

describe('affectedEntities', () => {
  it('cycle: returns the nodes array and no edges', () => {
    expect(affectedEntities(cyclePayload([N_A, N_B, N_C]))).toEqual({
      nodes: [N_A, N_B, N_C],
      edges: [],
    });
  });

  it('contradiction: returns [nodeA, nodeB] and the contradicting edges', () => {
    expect(affectedEntities(contradictionPayload(N_A, N_B, [E_1]))).toEqual({
      nodes: [N_A, N_B],
      edges: [E_1],
    });
  });

  it('multi-warrant: returns [dataNode, claimNode, ...warrants] and no edges', () => {
    expect(affectedEntities(multiWarrantPayload(N_A, N_B, [N_C, N_D]))).toEqual({
      nodes: [N_A, N_B, N_C, N_D],
      edges: [],
    });
  });

  it('dangling-claim: returns the single node and no edges', () => {
    expect(affectedEntities(danglingClaimPayload(N_A))).toEqual({
      nodes: [N_A],
      edges: [],
    });
  });

  it('coherency-hint sub-kinds: each sub-kind surfaces its expected node/edge set', () => {
    expect(affectedEntities(coherencyHintBridgesToPayload(N_A, N_B))).toEqual({
      nodes: [N_A, N_B],
      edges: [],
    });
    expect(affectedEntities(coherencyHintBridgesFromPayload(N_A, N_B))).toEqual({
      nodes: [N_A, N_B],
      edges: [],
    });
    expect(affectedEntities(coherencyHintSelfContradictsPayload(E_1, N_A))).toEqual({
      nodes: [N_A],
      edges: [E_1],
    });
  });
});

describe('flattenActiveDiagnosticsForFire', () => {
  it('empty input → empty tuples array', () => {
    expect(flattenActiveDiagnosticsForFire(new Map())).toEqual([]);
  });

  it('a single cycle of three nodes → three tuples sharing the same identityKey', () => {
    const payload = cyclePayload([N_A, N_B, N_C]);
    const key = diagnosticIdentityKey(payload);
    const map = new Map<string, DiagnosticPayload>([[key, payload]]);
    const tuples = flattenActiveDiagnosticsForFire(map);
    expect(tuples).toHaveLength(3);
    for (const t of tuples) {
      expect(t.identityKey).toBe(key);
      expect(t.severity).toBe('blocking');
    }
    expect(tuples.map((t) => t.nodeId).sort()).toEqual([N_A, N_B, N_C].sort());
  });

  it('mixed-severity map: severity is carried verbatim from each payload', () => {
    const cycle = cyclePayload([N_A, N_B]);
    const dangling = danglingClaimPayload(N_C);
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(cycle), cycle],
      [diagnosticIdentityKey(dangling), dangling],
    ]);
    const tuples = flattenActiveDiagnosticsForFire(map);
    expect(tuples).toHaveLength(3);
    // Blocking entries come from the cycle, advisory from dangling-claim.
    const blockingNodes = tuples.filter((t) => t.severity === 'blocking').map((t) => t.nodeId);
    const advisoryNodes = tuples.filter((t) => t.severity === 'advisory').map((t) => t.nodeId);
    expect(blockingNodes.sort()).toEqual([N_A, N_B].sort());
    expect(advisoryNodes).toEqual([N_C]);
  });

  it('two diagnostics referencing the same node yield two distinct tuples with different identityKeys', () => {
    // A cycle [A,B,C] AND a dangling-claim on A; A appears in both,
    // but the composite (identityKey, nodeId) pairs differ, so the
    // overlay's gate animates them independently.
    const cycle = cyclePayload([N_A, N_B, N_C]);
    const dangling = danglingClaimPayload(N_A);
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(cycle), cycle],
      [diagnosticIdentityKey(dangling), dangling],
    ]);
    const tuples = flattenActiveDiagnosticsForFire(map);
    const aTuples = tuples.filter((t) => t.nodeId === N_A);
    expect(aTuples).toHaveLength(2);
    const identityKeys = new Set(aTuples.map((t) => t.identityKey));
    expect(identityKeys.size).toBe(2);
  });
});

describe('flattenActiveDiagnosticsForEdgeFire', () => {
  const E_2 = '00000000-0000-4000-8000-0000000000e2';
  const E_3 = '00000000-0000-4000-8000-0000000000e3';

  it('empty input → empty tuples array', () => {
    expect(flattenActiveDiagnosticsForEdgeFire(new Map())).toEqual([]);
  });

  it('cycle / multi-warrant / dangling-claim payloads → empty (no edges projected)', () => {
    const cycle = cyclePayload([N_A, N_B, N_C]);
    const multi = multiWarrantPayload(N_A, N_B, [N_C, N_D]);
    const dangling = danglingClaimPayload(N_A);
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(cycle), cycle],
      [diagnosticIdentityKey(multi), multi],
      [diagnosticIdentityKey(dangling), dangling],
    ]);
    expect(flattenActiveDiagnosticsForEdgeFire(map)).toEqual([]);
  });

  it('contradiction with 2 edges → 2 tuples sharing identityKey and blocking severity', () => {
    const payload = contradictionPayload(N_A, N_B, [E_1, E_2]);
    const key = diagnosticIdentityKey(payload);
    const map = new Map<string, DiagnosticPayload>([[key, payload]]);
    const tuples = flattenActiveDiagnosticsForEdgeFire(map);
    expect(tuples).toHaveLength(2);
    for (const t of tuples) {
      expect(t.identityKey).toBe(key);
      expect(t.severity).toBe('blocking');
    }
    expect(tuples.map((t) => t.edgeId).sort()).toEqual([E_1, E_2].sort());
  });

  it('self-contradicts coherency-hint → 1 advisory tuple carrying the warrant-bridge edge id', () => {
    const payload = coherencyHintSelfContradictsPayload(E_3, N_A);
    const key = diagnosticIdentityKey(payload);
    const map = new Map<string, DiagnosticPayload>([[key, payload]]);
    const tuples = flattenActiveDiagnosticsForEdgeFire(map);
    expect(tuples).toHaveLength(1);
    expect(tuples[0]).toEqual({ identityKey: key, edgeId: E_3, severity: 'advisory' });
  });

  it('mixed map (one contradiction + one self-contradicts) → 3 tuples with mixed severity', () => {
    const contra = contradictionPayload(N_A, N_B, [E_1, E_2]);
    const hint = coherencyHintSelfContradictsPayload(E_3, N_A);
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(contra), contra],
      [diagnosticIdentityKey(hint), hint],
    ]);
    const tuples = flattenActiveDiagnosticsForEdgeFire(map);
    expect(tuples).toHaveLength(3);
    const blocking = tuples.filter((t) => t.severity === 'blocking').map((t) => t.edgeId);
    const advisory = tuples.filter((t) => t.severity === 'advisory').map((t) => t.edgeId);
    expect(blocking.sort()).toEqual([E_1, E_2].sort());
    expect(advisory).toEqual([E_3]);
  });
});
