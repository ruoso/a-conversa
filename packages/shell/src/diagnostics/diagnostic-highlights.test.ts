// Consolidated Vitest suite for the shell's `diagnostic-highlights.ts`
// module — identity-key parity with the server, per-kind
// `affectedEntities` extraction, `projectDiagnosticHighlights` rollup
// semantics, thin presence/severity helpers, and the audience-side
// `flattenActiveDiagnosticsForFire` / `flattenActiveDiagnosticsForEdgeFire`
// overlay-feeders.
//
// Refinement: tasks/refinements/shell-package/shell_diagnostic_highlights_extract.md
//   (union of the three predecessor suites at the canonical home).
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// The cases reproduce the server's identityKeyFor formula by
// string-construction so the test does not depend on importing from
// `apps/server/*` (the workspace-boundary discipline). A server-side
// identity-key drift fails this one shell suite (instead of three
// pre-lift per-app suites).

import { describe, expect, it } from 'vitest';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import {
  affectedEntities,
  diagnosticIdentityKey,
  diagnosticSeverityFor,
  edgeHasDiagnostic,
  EMPTY_DIAGNOSTIC_HIGHLIGHTS,
  flattenActiveDiagnosticsForEdgeFire,
  flattenActiveDiagnosticsForFire,
  nodeHasDiagnostic,
  projectDiagnosticHighlights,
} from './diagnostic-highlights.js';

const SESSION = '00000000-0000-4000-8000-000000000001';
const NODE_A = 'node-a';
const NODE_B = 'node-b';
const NODE_C = 'node-c';
const NODE_D = 'node-d';
const EDGE_1 = 'edge-1';
const EDGE_2 = 'edge-2';
const EDGE_3 = 'edge-3';

function cyclePayload(
  nodes: readonly string[],
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
  edges: readonly string[],
  severity: 'blocking' | 'advisory' = 'blocking',
): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'contradiction',
    severity,
    status: 'fired',
    sequence: 2,
    diagnostic: { kind: 'contradiction', nodeA, nodeB, edges },
  };
}

function multiWarrantPayload(
  dataNodeId: string,
  claimNodeId: string,
  warrantNodeIds: readonly string[],
  severity: 'blocking' | 'advisory' = 'advisory',
): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'multi-warrant',
    severity,
    status: 'fired',
    sequence: 3,
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
    sequence: 4,
    diagnostic: { kind: 'dangling-claim', nodeId },
  };
}

function coherencyHintToPayload(warrantNodeId: string, dataNodeId: string): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'coherency-hint',
    severity: 'advisory',
    status: 'fired',
    sequence: 5,
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
    sequence: 6,
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
    sequence: 7,
    diagnostic: {
      kind: 'coherency-hint',
      hint: { kind: 'self-contradicts', edgeId, nodeId },
    },
  };
}

describe('diagnosticIdentityKey — round-trip parity with the server', () => {
  it('cycle — same node set in two adjacency walks produces the same key (sort-invariant)', () => {
    const a = cyclePayload(['n-c', 'n-a', 'n-b']);
    const b = cyclePayload(['n-b', 'n-c', 'n-a']);
    expect(diagnosticIdentityKey(a)).toBe(diagnosticIdentityKey(b));
    expect(diagnosticIdentityKey(a)).toBe('cycle\0n-a\0n-b\0n-c');
  });

  it('contradiction — same (nodeA, nodeB) pair produces the same key regardless of `edges` content (directional preservation)', () => {
    const a = contradictionPayload(NODE_A, NODE_B, [EDGE_1]);
    const b = contradictionPayload(NODE_A, NODE_B, [EDGE_1, EDGE_2]);
    expect(diagnosticIdentityKey(a)).toBe(diagnosticIdentityKey(b));
    expect(diagnosticIdentityKey(a)).toBe(`contradiction\0${NODE_A}\0${NODE_B}`);
  });

  it('multi-warrant — adding a warrant changes the key', () => {
    const a = multiWarrantPayload(NODE_A, NODE_B, [NODE_C]);
    const b = multiWarrantPayload(NODE_A, NODE_B, [NODE_C, NODE_D]);
    expect(diagnosticIdentityKey(a)).not.toBe(diagnosticIdentityKey(b));
    expect(diagnosticIdentityKey(a)).toBe(`multi-warrant\0${NODE_A}\0${NODE_B}\0${NODE_C}`);
  });

  it('multi-warrant — warrant id order is canonicalized via sort', () => {
    const a = multiWarrantPayload(NODE_A, NODE_B, ['w-3', 'w-1', 'w-2']);
    const b = multiWarrantPayload(NODE_A, NODE_B, ['w-1', 'w-2', 'w-3']);
    expect(diagnosticIdentityKey(a)).toBe(diagnosticIdentityKey(b));
    expect(diagnosticIdentityKey(a)).toBe(`multi-warrant\0${NODE_A}\0${NODE_B}\0w-1\0w-2\0w-3`);
  });

  it('dangling-claim — node id is the full identity', () => {
    const a = danglingClaimPayload(NODE_A);
    const b = danglingClaimPayload(NODE_B);
    expect(diagnosticIdentityKey(a)).toBe(`dangling-claim\0${NODE_A}`);
    expect(diagnosticIdentityKey(a)).not.toBe(diagnosticIdentityKey(b));
  });

  it('coherency-hint / incomplete-warrant-missing-bridges-to — pins the explicit sub-kind formula', () => {
    const to1 = coherencyHintToPayload('w-1', 'd-1');
    const to2 = coherencyHintToPayload('w-1', 'd-1');
    expect(diagnosticIdentityKey(to1)).toBe(diagnosticIdentityKey(to2));
    expect(diagnosticIdentityKey(to1)).toBe(
      'coherency-hint\0incomplete-warrant-missing-bridges-to\0w-1\0d-1',
    );
  });

  it('coherency-hint / incomplete-warrant-missing-bridges-from — pins the explicit sub-kind formula', () => {
    const from1 = coherencyHintFromPayload('w-1', 'c-1');
    expect(diagnosticIdentityKey(from1)).toBe(
      'coherency-hint\0incomplete-warrant-missing-bridges-from\0w-1\0c-1',
    );
  });

  it('coherency-hint / self-contradicts — pins the explicit sub-kind formula and distinguishes from siblings', () => {
    const to1 = coherencyHintToPayload('w-1', 'd-1');
    const from1 = coherencyHintFromPayload('w-1', 'c-1');
    const self1 = coherencyHintSelfContradictsPayload('e-1', 'n-1');
    expect(diagnosticIdentityKey(self1)).toBe('coherency-hint\0self-contradicts\0e-1');
    expect(diagnosticIdentityKey(to1)).not.toBe(diagnosticIdentityKey(self1));
    expect(diagnosticIdentityKey(from1)).not.toBe(diagnosticIdentityKey(self1));
  });
});

describe('affectedEntities — per-kind extraction', () => {
  it('cycle → all nodes, zero edges', () => {
    const ids = affectedEntities(cyclePayload([NODE_A, NODE_B, NODE_C]));
    expect(ids.nodes).toEqual([NODE_A, NODE_B, NODE_C]);
    expect(ids.edges).toEqual([]);
  });

  it('contradiction → nodeA + nodeB + every edge id', () => {
    const ids = affectedEntities(contradictionPayload(NODE_A, NODE_B, [EDGE_1, EDGE_2]));
    expect(ids.nodes).toEqual([NODE_A, NODE_B]);
    expect(ids.edges).toEqual([EDGE_1, EDGE_2]);
  });

  it('multi-warrant → dataNodeId + claimNodeId + every warrantNodeId', () => {
    const ids = affectedEntities(multiWarrantPayload(NODE_A, NODE_B, [NODE_C, NODE_D]));
    expect(ids.nodes).toEqual([NODE_A, NODE_B, NODE_C, NODE_D]);
    expect(ids.edges).toEqual([]);
  });

  it('dangling-claim → just the nodeId', () => {
    const ids = affectedEntities(danglingClaimPayload(NODE_A));
    expect(ids.nodes).toEqual([NODE_A]);
    expect(ids.edges).toEqual([]);
  });

  it('coherency-hint / incomplete-warrant-missing-bridges-to → [warrantNodeId, dataNodeId]', () => {
    const ids = affectedEntities(coherencyHintToPayload('w-1', 'd-1'));
    expect(ids.nodes).toEqual(['w-1', 'd-1']);
    expect(ids.edges).toEqual([]);
  });

  it('coherency-hint / incomplete-warrant-missing-bridges-from → [warrantNodeId, claimNodeId]', () => {
    const ids = affectedEntities(coherencyHintFromPayload('w-1', 'c-1'));
    expect(ids.nodes).toEqual(['w-1', 'c-1']);
    expect(ids.edges).toEqual([]);
  });

  it('coherency-hint / self-contradicts → { nodes: [nodeId], edges: [edgeId] }', () => {
    const ids = affectedEntities(coherencyHintSelfContradictsPayload('e-1', 'n-1'));
    expect(ids.nodes).toEqual(['n-1']);
    expect(ids.edges).toEqual(['e-1']);
  });
});

describe('projectDiagnosticHighlights — per-kind index population', () => {
  it('cycle: every node id hits the index with severity=blocking + kinds=[cycle]', () => {
    const payload = cyclePayload([NODE_A, NODE_B, NODE_C], 'blocking');
    const map = new Map([[diagnosticIdentityKey(payload), payload]]);
    const index = projectDiagnosticHighlights(map);
    expect(index.nodes.size).toBe(3);
    expect(index.edges.size).toBe(0);
    expect(index.nodes.get(NODE_A)).toEqual({ severity: 'blocking', kinds: ['cycle'] });
    expect(index.nodes.get(NODE_B)).toEqual({ severity: 'blocking', kinds: ['cycle'] });
    expect(index.nodes.get(NODE_C)).toEqual({ severity: 'blocking', kinds: ['cycle'] });
  });

  it('contradiction: nodes get severity=blocking + kinds=[contradiction]; edges get the same', () => {
    const payload = contradictionPayload(NODE_A, NODE_B, [EDGE_1, EDGE_2], 'blocking');
    const map = new Map([[diagnosticIdentityKey(payload), payload]]);
    const index = projectDiagnosticHighlights(map);
    expect(index.nodes.get(NODE_A)).toEqual({ severity: 'blocking', kinds: ['contradiction'] });
    expect(index.nodes.get(NODE_B)).toEqual({ severity: 'blocking', kinds: ['contradiction'] });
    expect(index.edges.get(EDGE_1)).toEqual({ severity: 'blocking', kinds: ['contradiction'] });
    expect(index.edges.get(EDGE_2)).toEqual({ severity: 'blocking', kinds: ['contradiction'] });
  });

  it('multi-warrant: dataNodeId + claimNodeId + warrants all hit with severity=advisory', () => {
    const payload = multiWarrantPayload(NODE_A, NODE_B, [NODE_C], 'advisory');
    const map = new Map([[diagnosticIdentityKey(payload), payload]]);
    const index = projectDiagnosticHighlights(map);
    expect(index.nodes.get(NODE_A)).toEqual({ severity: 'advisory', kinds: ['multi-warrant'] });
    expect(index.nodes.get(NODE_B)).toEqual({ severity: 'advisory', kinds: ['multi-warrant'] });
    expect(index.nodes.get(NODE_C)).toEqual({ severity: 'advisory', kinds: ['multi-warrant'] });
  });

  it('dangling-claim: the single nodeId hits with severity=advisory', () => {
    const payload = danglingClaimPayload(NODE_A, 'advisory');
    const map = new Map([[diagnosticIdentityKey(payload), payload]]);
    const index = projectDiagnosticHighlights(map);
    expect(index.nodes.get(NODE_A)).toEqual({
      severity: 'advisory',
      kinds: ['dangling-claim'],
    });
  });

  it('coherency-hint: self-contradicts puts both node + edge into the index', () => {
    const payload = coherencyHintSelfContradictsPayload(EDGE_1, NODE_A);
    const map = new Map([[diagnosticIdentityKey(payload), payload]]);
    const index = projectDiagnosticHighlights(map);
    expect(index.nodes.get(NODE_A)).toEqual({
      severity: 'advisory',
      kinds: ['coherency-hint'],
    });
    expect(index.edges.get(EDGE_1)).toEqual({
      severity: 'advisory',
      kinds: ['coherency-hint'],
    });
  });
});

describe('projectDiagnosticHighlights — rollup semantics', () => {
  it('blocking wins over advisory when an entity appears in both', () => {
    const cycle = cyclePayload([NODE_A, NODE_B], 'blocking');
    const hint = coherencyHintSelfContradictsPayload(EDGE_1, NODE_A);
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(cycle), cycle],
      [diagnosticIdentityKey(hint), hint],
    ]);
    const index = projectDiagnosticHighlights(map);
    const a = index.nodes.get(NODE_A);
    expect(a?.severity).toBe('blocking');
    expect(a?.kinds).toEqual(['cycle', 'coherency-hint']);
  });

  it('advisory-then-blocking still resolves to blocking (one-way demotion)', () => {
    const hint = coherencyHintSelfContradictsPayload(EDGE_1, NODE_A);
    const cycle = cyclePayload([NODE_A, NODE_B], 'blocking');
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(hint), hint],
      [diagnosticIdentityKey(cycle), cycle],
    ]);
    const index = projectDiagnosticHighlights(map);
    expect(index.nodes.get(NODE_A)?.severity).toBe('blocking');
    expect(index.nodes.get(NODE_A)?.kinds).toEqual(['coherency-hint', 'cycle']);
  });

  it('kinds dedupe: an entity appearing in two cycles resolves to kinds: [cycle]', () => {
    const c1 = cyclePayload([NODE_A, NODE_B], 'blocking');
    const c2 = cyclePayload([NODE_A, NODE_C], 'blocking');
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(c1), c1],
      [diagnosticIdentityKey(c2), c2],
    ]);
    const index = projectDiagnosticHighlights(map);
    expect(index.nodes.get(NODE_A)?.kinds).toEqual(['cycle']);
  });

  it('kinds preserve encounter order: cycle then multi-warrant on the same node', () => {
    const c = cyclePayload([NODE_A, NODE_B], 'blocking');
    const mw = multiWarrantPayload(NODE_A, 'node-d', ['node-w'], 'advisory');
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(c), c],
      [diagnosticIdentityKey(mw), mw],
    ]);
    const index = projectDiagnosticHighlights(map);
    expect(index.nodes.get(NODE_A)?.kinds).toEqual(['cycle', 'multi-warrant']);
  });

  it('edges and nodes are bucketed separately (contradiction puts ids in both buckets)', () => {
    const payload = contradictionPayload(NODE_A, NODE_B, [EDGE_1], 'blocking');
    const map = new Map([[diagnosticIdentityKey(payload), payload]]);
    const index = projectDiagnosticHighlights(map);
    // Same id namespace would collide; the projector keeps them apart.
    expect(index.nodes.size).toBe(2);
    expect(index.edges.size).toBe(1);
    expect(index.edges.get(EDGE_1)?.kinds).toEqual(['contradiction']);
    expect(index.nodes.get(EDGE_1)).toBeUndefined();
  });

  it('empty input returns the stable EMPTY_DIAGNOSTIC_HIGHLIGHTS reference', () => {
    const result = projectDiagnosticHighlights(new Map());
    expect(result).toBe(EMPTY_DIAGNOSTIC_HIGHLIGHTS);
  });
});

describe('nodeHasDiagnostic / edgeHasDiagnostic / diagnosticSeverityFor — thin helpers', () => {
  it('return presence + severity for entities in the index, "none"/false otherwise', () => {
    const hint = coherencyHintSelfContradictsPayload(EDGE_1, NODE_A);
    const blocking = cyclePayload([NODE_A], 'blocking');
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(hint), hint],
      [diagnosticIdentityKey(blocking), blocking],
    ]);
    const index = projectDiagnosticHighlights(map);

    expect(nodeHasDiagnostic(index, NODE_A)).toBe(true);
    expect(nodeHasDiagnostic(index, NODE_B)).toBe(false);
    expect(edgeHasDiagnostic(index, EDGE_1)).toBe(true);
    expect(edgeHasDiagnostic(index, EDGE_2)).toBe(false);

    expect(diagnosticSeverityFor(index, 'node', NODE_A)).toBe('blocking');
    expect(diagnosticSeverityFor(index, 'node', NODE_B)).toBe('none');
    expect(diagnosticSeverityFor(index, 'edge', EDGE_1)).toBe('advisory');
    expect(diagnosticSeverityFor(index, 'edge', EDGE_2)).toBe('none');
  });

  it('diagnosticSeverityFor reports the rolled-up (blocking-wins) severity for blended entities', () => {
    const blockingHit = cyclePayload([NODE_A], 'blocking');
    const advisoryHit = multiWarrantPayload(NODE_A, NODE_B, [NODE_C], 'advisory');
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(blockingHit), blockingHit],
      [diagnosticIdentityKey(advisoryHit), advisoryHit],
    ]);
    const index = projectDiagnosticHighlights(map);
    expect(diagnosticSeverityFor(index, 'node', NODE_A)).toBe('blocking');
    expect(diagnosticSeverityFor(index, 'node', NODE_B)).toBe('advisory');
    expect(diagnosticSeverityFor(index, 'node', NODE_C)).toBe('advisory');
  });
});

describe('flattenActiveDiagnosticsForFire', () => {
  it('empty input → empty tuples array', () => {
    expect(flattenActiveDiagnosticsForFire(new Map())).toEqual([]);
  });

  it('a single cycle of three nodes → three tuples sharing the same identityKey', () => {
    const payload = cyclePayload([NODE_A, NODE_B, NODE_C]);
    const key = diagnosticIdentityKey(payload);
    const map = new Map<string, DiagnosticPayload>([[key, payload]]);
    const tuples = flattenActiveDiagnosticsForFire(map);
    expect(tuples).toHaveLength(3);
    for (const t of tuples) {
      expect(t.identityKey).toBe(key);
      expect(t.severity).toBe('blocking');
    }
    expect(tuples.map((t) => t.nodeId).sort()).toEqual([NODE_A, NODE_B, NODE_C].sort());
  });

  it('mixed-severity map: severity is carried verbatim from each payload', () => {
    const cycle = cyclePayload([NODE_A, NODE_B]);
    const dangling = danglingClaimPayload(NODE_C);
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(cycle), cycle],
      [diagnosticIdentityKey(dangling), dangling],
    ]);
    const tuples = flattenActiveDiagnosticsForFire(map);
    expect(tuples).toHaveLength(3);
    const blockingNodes = tuples.filter((t) => t.severity === 'blocking').map((t) => t.nodeId);
    const advisoryNodes = tuples.filter((t) => t.severity === 'advisory').map((t) => t.nodeId);
    expect(blockingNodes.sort()).toEqual([NODE_A, NODE_B].sort());
    expect(advisoryNodes).toEqual([NODE_C]);
  });

  it('two diagnostics referencing the same node yield two distinct tuples with different identityKeys', () => {
    const cycle = cyclePayload([NODE_A, NODE_B, NODE_C]);
    const dangling = danglingClaimPayload(NODE_A);
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(cycle), cycle],
      [diagnosticIdentityKey(dangling), dangling],
    ]);
    const tuples = flattenActiveDiagnosticsForFire(map);
    const aTuples = tuples.filter((t) => t.nodeId === NODE_A);
    expect(aTuples).toHaveLength(2);
    const identityKeys = new Set(aTuples.map((t) => t.identityKey));
    expect(identityKeys.size).toBe(2);
  });
});

describe('flattenActiveDiagnosticsForEdgeFire', () => {
  it('empty input → empty tuples array', () => {
    expect(flattenActiveDiagnosticsForEdgeFire(new Map())).toEqual([]);
  });

  it('cycle / multi-warrant / dangling-claim payloads → empty (no edges projected)', () => {
    const cycle = cyclePayload([NODE_A, NODE_B, NODE_C]);
    const multi = multiWarrantPayload(NODE_A, NODE_B, [NODE_C, NODE_D]);
    const dangling = danglingClaimPayload(NODE_A);
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(cycle), cycle],
      [diagnosticIdentityKey(multi), multi],
      [diagnosticIdentityKey(dangling), dangling],
    ]);
    expect(flattenActiveDiagnosticsForEdgeFire(map)).toEqual([]);
  });

  it('contradiction with 2 edges → 2 tuples sharing identityKey and blocking severity', () => {
    const payload = contradictionPayload(NODE_A, NODE_B, [EDGE_1, EDGE_2]);
    const key = diagnosticIdentityKey(payload);
    const map = new Map<string, DiagnosticPayload>([[key, payload]]);
    const tuples = flattenActiveDiagnosticsForEdgeFire(map);
    expect(tuples).toHaveLength(2);
    for (const t of tuples) {
      expect(t.identityKey).toBe(key);
      expect(t.severity).toBe('blocking');
    }
    expect(tuples.map((t) => t.edgeId).sort()).toEqual([EDGE_1, EDGE_2].sort());
  });

  it('self-contradicts coherency-hint → 1 advisory tuple carrying the warrant-bridge edge id', () => {
    const payload = coherencyHintSelfContradictsPayload(EDGE_3, NODE_A);
    const key = diagnosticIdentityKey(payload);
    const map = new Map<string, DiagnosticPayload>([[key, payload]]);
    const tuples = flattenActiveDiagnosticsForEdgeFire(map);
    expect(tuples).toHaveLength(1);
    expect(tuples[0]).toEqual({ identityKey: key, edgeId: EDGE_3, severity: 'advisory' });
  });

  it('mixed map (one contradiction + one self-contradicts) → 3 tuples with mixed severity', () => {
    const contra = contradictionPayload(NODE_A, NODE_B, [EDGE_1, EDGE_2]);
    const hint = coherencyHintSelfContradictsPayload(EDGE_3, NODE_A);
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(contra), contra],
      [diagnosticIdentityKey(hint), hint],
    ]);
    const tuples = flattenActiveDiagnosticsForEdgeFire(map);
    expect(tuples).toHaveLength(3);
    const blocking = tuples.filter((t) => t.severity === 'blocking').map((t) => t.edgeId);
    const advisory = tuples.filter((t) => t.severity === 'advisory').map((t) => t.edgeId);
    expect(blocking.sort()).toEqual([EDGE_1, EDGE_2].sort());
    expect(advisory).toEqual([EDGE_3]);
  });
});
