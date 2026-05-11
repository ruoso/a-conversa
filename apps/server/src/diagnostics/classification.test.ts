// Tests for `classifyDiagnostic` and `partitionBySeverity`.
//
// Refinement: tasks/refinements/data-and-methodology/blocking_vs_advisory_classification.md
// TaskJuggler: data_and_methodology.diagnostics.blocking_vs_advisory_classification
//
// Coverage (Vitest layer — pure-function checks over synthetic
// DiagnosticEntry literals; no projection, no DB):
//
//   - classifyDiagnostic per kind (5 cases):
//     cycle → blocking; contradiction → blocking;
//     multi-warrant → advisory; dangling-claim → advisory;
//     coherency-hint → advisory.
//   - classifyDiagnostic per coherency-hint sub-kind (3 cases):
//     incomplete-warrant-missing-bridges-to → advisory;
//     incomplete-warrant-missing-bridges-from → advisory;
//     self-contradicts → advisory. Documents the explicit decision
//     that all three sub-kinds classify the same way per the
//     methodology doc's line-227 blanket-advisory rule. A future
//     variant with different severity changes one branch and one
//     test.
//   - partitionBySeverity round-trip (1 case): a mixed list of all
//     five kinds partitions into [cycle, contradiction] (blocking) and
//     [multi-warrant, dangling-claim, coherency-hint] (advisory);
//     order within each bucket preserves input order; every entry
//     lands in exactly one bucket; the union of buckets equals the
//     input as a multiset.
//   - partitionBySeverity empty input → empty buckets (1 case).
//
// The Cucumber feature at tests/behavior/diagnostics/classification.feature
// exercises the round-tripped path through pglite's session_events table
// — projection → computeAllDiagnostics → partitionBySeverity.

import { describe, expect, it } from 'vitest';

import { classifyDiagnostic, partitionBySeverity } from './classification.js';
import type {
  DiagnosticEntry,
  CycleDiagnosticEntry,
  ContradictionDiagnosticEntry,
  MultiWarrantDiagnosticEntry,
  DanglingClaimDiagnosticEntry,
  CoherencyHintDiagnosticEntry,
} from './event-emission.js';

// Synthetic ids — the classifier is pure over the entry's `kind` (and
// the inner `hint.kind` for coherency-hint), so the payload field
// values are immaterial. Stable strings keep the tests readable.
const NODE_A = '66666666-6666-4666-8666-666666666601';
const NODE_B = '66666666-6666-4666-8666-666666666602';
const NODE_C = '66666666-6666-4666-8666-666666666603';
const NODE_D = '66666666-6666-4666-8666-666666666604';
const NODE_W1 = '66666666-6666-4666-8666-666666666611';
const NODE_W2 = '66666666-6666-4666-8666-666666666612';
const EDGE_AB_C = '77777777-7777-4777-8777-77777aabbccd';
const EDGE_SELF = '77777777-7777-4777-8777-77777aabbcc0';

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

function danglingClaimEntry(nodeId: string): DanglingClaimDiagnosticEntry {
  return { kind: 'dangling-claim', nodeId };
}

function coherencyHintToEntry(
  warrantNodeId: string,
  dataNodeId: string,
): CoherencyHintDiagnosticEntry {
  return {
    kind: 'coherency-hint',
    hint: {
      kind: 'incomplete-warrant-missing-bridges-to',
      warrantNodeId,
      dataNodeId,
    },
  };
}

function coherencyHintFromEntry(
  warrantNodeId: string,
  claimNodeId: string,
): CoherencyHintDiagnosticEntry {
  return {
    kind: 'coherency-hint',
    hint: {
      kind: 'incomplete-warrant-missing-bridges-from',
      warrantNodeId,
      claimNodeId,
    },
  };
}

function coherencyHintSelfContradictsEntry(
  edgeId: string,
  nodeId: string,
): CoherencyHintDiagnosticEntry {
  return {
    kind: 'coherency-hint',
    hint: {
      kind: 'self-contradicts',
      edgeId,
      nodeId,
    },
  };
}

// ---------------------------------------------------------------
// classifyDiagnostic — per kind.
// ---------------------------------------------------------------

describe('classifyDiagnostic per kind', () => {
  it('cycle → blocking (methodology.md line 218)', () => {
    expect(classifyDiagnostic(cycleEntry(NODE_A, NODE_B, NODE_C))).toBe('blocking');
  });

  it('contradiction → blocking (methodology.md line 219)', () => {
    expect(classifyDiagnostic(contradictionEntry(NODE_A, NODE_B, EDGE_AB_C))).toBe('blocking');
  });

  it('multi-warrant → advisory (methodology.md line 225)', () => {
    expect(classifyDiagnostic(multiWarrantEntry(NODE_D, NODE_C, [NODE_W1, NODE_W2]))).toBe(
      'advisory',
    );
  });

  it('dangling-claim → advisory (methodology.md line 226)', () => {
    expect(classifyDiagnostic(danglingClaimEntry(NODE_A))).toBe('advisory');
  });

  it('coherency-hint → advisory (methodology.md line 227; data-model.md line 197)', () => {
    expect(classifyDiagnostic(coherencyHintToEntry(NODE_W1, NODE_D))).toBe('advisory');
  });
});

// ---------------------------------------------------------------
// classifyDiagnostic — per coherency-hint sub-kind. Documents the
// explicit per-sub-kind decision (all three classify the same way) so
// a future variant change is a one-line code change plus one new
// test.
// ---------------------------------------------------------------

describe('classifyDiagnostic per coherency-hint sub-kind', () => {
  it('incomplete-warrant-missing-bridges-to → advisory', () => {
    expect(classifyDiagnostic(coherencyHintToEntry(NODE_W1, NODE_D))).toBe('advisory');
  });

  it('incomplete-warrant-missing-bridges-from → advisory', () => {
    expect(classifyDiagnostic(coherencyHintFromEntry(NODE_W1, NODE_C))).toBe('advisory');
  });

  it('self-contradicts → advisory', () => {
    expect(classifyDiagnostic(coherencyHintSelfContradictsEntry(EDGE_SELF, NODE_A))).toBe(
      'advisory',
    );
  });
});

// ---------------------------------------------------------------
// partitionBySeverity — round-trip and edge cases.
// ---------------------------------------------------------------

describe('partitionBySeverity', () => {
  it('partitions a mixed list into the correct buckets; preserves order; round-trips by multiset', () => {
    const cycle = cycleEntry(NODE_A, NODE_B, NODE_C);
    const multiWarrant = multiWarrantEntry(NODE_D, NODE_C, [NODE_W1, NODE_W2]);
    const contradiction = contradictionEntry(NODE_A, NODE_B, EDGE_AB_C);
    const danglingClaim = danglingClaimEntry(NODE_A);
    const coherencyHint = coherencyHintToEntry(NODE_W1, NODE_D);

    const entries: DiagnosticEntry[] = [
      cycle,
      multiWarrant,
      contradiction,
      danglingClaim,
      coherencyHint,
    ];
    const { blocking, advisory } = partitionBySeverity(entries);

    // Per-bucket contents — order preserves input order.
    expect(blocking).toEqual([cycle, contradiction]);
    expect(advisory).toEqual([multiWarrant, danglingClaim, coherencyHint]);

    // Round-trip: the union of the two buckets equals the input
    // multiset. Reference-equality on entries (since the classifier
    // does not copy them).
    const recombined = new Set<DiagnosticEntry>([...blocking, ...advisory]);
    expect(recombined.size).toBe(entries.length);
    for (const entry of entries) {
      expect(recombined.has(entry)).toBe(true);
    }

    // Each entry appears in exactly one bucket — no overlap.
    const blockingSet = new Set(blocking);
    const advisorySet = new Set(advisory);
    for (const entry of entries) {
      const inBlocking = blockingSet.has(entry);
      const inAdvisory = advisorySet.has(entry);
      expect(inBlocking !== inAdvisory).toBe(true);
    }
  });

  it('empty input → empty buckets', () => {
    const { blocking, advisory } = partitionBySeverity([]);
    expect(blocking).toEqual([]);
    expect(advisory).toEqual([]);
  });
});
