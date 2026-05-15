// Tests for `diagnosticHighlights.ts` — per-entity diagnostic-highlight
// projection + identity-key parity with the server's `identityKeyFor`.
//
// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//
//   1. `diagnosticIdentityKey` produces the same string as the server's
//      `identityKeyFor` for every diagnostic kind (round-trip), AND is
//      stable under adjacency-walk start-point variation for `cycle`,
//      under `edges` content for `contradiction`, under `warrantNodeIds`
//      order for `multi-warrant`. The moderator-side helper MUST stay in
//      lockstep with the server's formula — a drift breaks `fired` /
//      `cleared` matching in the store.
//   2. `affectedEntities` extracts the documented entity ids per kind +
//      per coherency-hint sub-kind.
//   3. `projectDiagnosticHighlights` rolls up per-entity severity
//      (blocking wins over advisory), deduplicates kinds, preserves
//      encounter order, and returns the stable empty reference for
//      empty input.

import { describe, expect, it } from 'vitest';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import {
  affectedEntities,
  diagnosticIdentityKey,
  EMPTY_DIAGNOSTIC_HIGHLIGHTS,
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
    // Cycle nodes are sorted lexicographically before joining, so two
    // adjacency walks that start at different nodes (and surface in
    // different orders) canonicalize to the same key.
    const a = cyclePayload(['n-c', 'n-a', 'n-b']);
    const b = cyclePayload(['n-b', 'n-c', 'n-a']);
    expect(diagnosticIdentityKey(a)).toBe(diagnosticIdentityKey(b));
    // And matches the explicit formula.
    expect(diagnosticIdentityKey(a)).toBe('cycle\0n-a\0n-b\0n-c');
  });

  it('contradiction — same (nodeA, nodeB) pair produces the same key regardless of `edges` content', () => {
    // The server canonicalizes the pair lexicographically before
    // emission; identity is the pair only, NOT the edges array.
    const a = contradictionPayload(NODE_A, NODE_B, [EDGE_1]);
    const b = contradictionPayload(NODE_A, NODE_B, [EDGE_1, EDGE_2]);
    expect(diagnosticIdentityKey(a)).toBe(diagnosticIdentityKey(b));
    expect(diagnosticIdentityKey(a)).toBe(`contradiction\0${NODE_A}\0${NODE_B}`);
  });

  it('multi-warrant — adding a warrant changes the key', () => {
    const a = multiWarrantPayload(NODE_A, NODE_B, [NODE_C]);
    const b = multiWarrantPayload(NODE_A, NODE_B, [NODE_C, 'node-d']);
    expect(diagnosticIdentityKey(a)).not.toBe(diagnosticIdentityKey(b));
    expect(diagnosticIdentityKey(a)).toBe(`multi-warrant\0${NODE_A}\0${NODE_B}\0${NODE_C}`);
  });

  it('multi-warrant — warrant id order is canonicalized via sort', () => {
    // Same set of warrants in different orders produces the same key
    // (the formula sorts the warrants before joining).
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

  it('coherency-hint — each sub-kind produces a distinct key, same sub-kind + same ids produces the same key', () => {
    const to1 = coherencyHintToPayload('w-1', 'd-1');
    const to2 = coherencyHintToPayload('w-1', 'd-1');
    const from1 = coherencyHintFromPayload('w-1', 'c-1');
    const self1 = coherencyHintSelfContradictsPayload('e-1', 'n-1');
    expect(diagnosticIdentityKey(to1)).toBe(diagnosticIdentityKey(to2));
    expect(diagnosticIdentityKey(to1)).not.toBe(diagnosticIdentityKey(from1));
    expect(diagnosticIdentityKey(to1)).not.toBe(diagnosticIdentityKey(self1));
    expect(diagnosticIdentityKey(from1)).not.toBe(diagnosticIdentityKey(self1));
    expect(diagnosticIdentityKey(to1)).toBe(
      'coherency-hint\0incomplete-warrant-missing-bridges-to\0w-1\0d-1',
    );
    expect(diagnosticIdentityKey(from1)).toBe(
      'coherency-hint\0incomplete-warrant-missing-bridges-from\0w-1\0c-1',
    );
    expect(diagnosticIdentityKey(self1)).toBe('coherency-hint\0self-contradicts\0e-1');
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
    const ids = affectedEntities(multiWarrantPayload(NODE_A, NODE_B, [NODE_C, 'node-d']));
    expect(ids.nodes).toEqual([NODE_A, NODE_B, NODE_C, 'node-d']);
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
    // Same node id is hit by a blocking cycle AND an advisory
    // coherency-hint; the rollup must resolve to blocking.
    const cycle = cyclePayload([NODE_A, NODE_B], 'blocking');
    const hint = coherencyHintSelfContradictsPayload(EDGE_1, NODE_A);
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(cycle), cycle],
      [diagnosticIdentityKey(hint), hint],
    ]);
    const index = projectDiagnosticHighlights(map);
    const a = index.nodes.get(NODE_A);
    expect(a?.severity).toBe('blocking');
    // Both kinds are recorded, in encounter order (cycle first).
    expect(a?.kinds).toEqual(['cycle', 'coherency-hint']);
  });

  it('advisory-then-blocking still resolves to blocking (one-way demotion)', () => {
    // Insertion-order-flipped: advisory hint first, blocking cycle
    // second. Result still resolves to blocking — the rollup is
    // demote-only-upward.
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
    // Two different cycles both include NODE_A. The rollup must
    // dedupe the kind — the per-entity `kinds` is "every distinct
    // kind that touches this entity", not "every diagnostic".
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
    // The diagnostic envelopes land in a defined order (the map
    // iteration order is insertion order); the per-entity `kinds`
    // array reflects that order so a downstream tooltip reads the
    // kinds in the order the moderator received them.
    const c = cyclePayload([NODE_A, NODE_B], 'blocking');
    const mw = multiWarrantPayload(NODE_A, 'node-d', ['node-w'], 'advisory');
    const map = new Map<string, DiagnosticPayload>([
      [diagnosticIdentityKey(c), c],
      [diagnosticIdentityKey(mw), mw],
    ]);
    const index = projectDiagnosticHighlights(map);
    expect(index.nodes.get(NODE_A)?.kinds).toEqual(['cycle', 'multi-warrant']);
  });

  it('empty input returns the stable EMPTY_DIAGNOSTIC_HIGHLIGHTS reference', () => {
    const result = projectDiagnosticHighlights(new Map());
    // Reference equality — the empty-input fast path returns the
    // module-level constant so React / ReactFlow memoization stays
    // stable for the no-diagnostic baseline.
    expect(result).toBe(EMPTY_DIAGNOSTIC_HIGHLIGHTS);
  });
});
