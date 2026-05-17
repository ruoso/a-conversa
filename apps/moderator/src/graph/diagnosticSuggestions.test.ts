// Tests for `suggestionsForDiagnostic` — the pure derivation helper that
// maps a `DiagnosticPayload` to the methodology's ordered list of
// next-action moves.
//
// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_methodology_suggestions.md
//
// Per ADR 0022 these are committed Vitest cases. They pin:
//
//   - The per-kind move catalog (load-bearing — grounded in
//     `docs/methodology.md` L216-233; drift here is a
//     methodology-engine-level discrepancy).
//   - The coherency-hint sub-kind invariant: all three sub-kinds map to
//     the same triple in v1. A future per-sub-kind divergence is a
//     deliberate compile-or-test break.
//   - An exhaustive-narrow guard: every value of `WsDiagnosticKind` from
//     the canonical `wsDiagnosticKinds` tuple yields a non-empty array.
//     A future enum addition trips this test.
//   - Order-determinism: repeated calls with the same payload produce
//     identical orderings (pinned canonical order).

import { describe, expect, it } from 'vitest';
import type { DiagnosticPayload, WsDiagnosticKind } from '@a-conversa/shared-types';
import { wsDiagnosticKinds } from '@a-conversa/shared-types';

import { suggestionsForDiagnostic, type SuggestionMove } from './diagnosticSuggestions';

const SESSION = '00000000-0000-4000-8000-000000000001';
const NODE_A = 'node-a';
const NODE_B = 'node-b';
const NODE_C = 'node-c';
const EDGE_1 = 'edge-1';

// Tiny per-kind payload helpers — the wire `diagnostic` field is
// `unknown`, so the per-kind inline shape is hand-built. The outer
// envelope (sessionId / severity / status / sequence) is shared.

function cyclePayload(): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'cycle',
    severity: 'blocking',
    status: 'fired',
    sequence: 1,
    diagnostic: { kind: 'cycle', nodes: [NODE_A, NODE_B, NODE_C] },
  };
}

function contradictionPayload(): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'contradiction',
    severity: 'blocking',
    status: 'fired',
    sequence: 1,
    diagnostic: { kind: 'contradiction', nodeA: NODE_A, nodeB: NODE_B, edges: [EDGE_1] },
  };
}

function multiWarrantPayload(): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'multi-warrant',
    severity: 'advisory',
    status: 'fired',
    sequence: 1,
    diagnostic: {
      kind: 'multi-warrant',
      dataNodeId: NODE_A,
      claimNodeId: NODE_B,
      warrantNodeIds: [NODE_C, 'node-d'],
    },
  };
}

function danglingClaimPayload(): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'dangling-claim',
    severity: 'advisory',
    status: 'fired',
    sequence: 1,
    diagnostic: { kind: 'dangling-claim', nodeId: NODE_A },
  };
}

function coherencyHintToPayload(): DiagnosticPayload {
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
        warrantNodeId: 'w-1',
        dataNodeId: 'd-1',
      },
    },
  };
}

function coherencyHintFromPayload(): DiagnosticPayload {
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
        warrantNodeId: 'w-1',
        claimNodeId: 'c-1',
      },
    },
  };
}

function coherencyHintSelfContradictsPayload(): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'coherency-hint',
    severity: 'advisory',
    status: 'fired',
    sequence: 1,
    diagnostic: {
      kind: 'coherency-hint',
      hint: { kind: 'self-contradicts', edgeId: EDGE_1, nodeId: NODE_A },
    },
  };
}

function payloadForKind(kind: WsDiagnosticKind): DiagnosticPayload {
  switch (kind) {
    case 'cycle':
      return cyclePayload();
    case 'contradiction':
      return contradictionPayload();
    case 'multi-warrant':
      return multiWarrantPayload();
    case 'dangling-claim':
      return danglingClaimPayload();
    case 'coherency-hint':
      return coherencyHintToPayload();
  }
}

describe('suggestionsForDiagnostic — canonical per-kind catalog', () => {
  it('cycle → [break-edge, decompose, axiom-mark]', () => {
    // `docs/methodology.md` L222: cycle resolution paths are break-edge,
    // decompose, axiom-mark — in that documentation order.
    expect(suggestionsForDiagnostic(cyclePayload())).toEqual([
      'break-edge',
      'decompose',
      'axiom-mark',
    ] satisfies SuggestionMove[]);
  });

  it('contradiction → [decompose, amend, axiom-mark-both]', () => {
    // `docs/methodology.md` L223: contradiction resolution paths are
    // decompose, amend, accept-as-bedrock (each side axiom-marks).
    expect(suggestionsForDiagnostic(contradictionPayload())).toEqual([
      'decompose',
      'amend',
      'axiom-mark-both',
    ] satisfies SuggestionMove[]);
  });

  it('multi-warrant → [decompose]', () => {
    // `docs/methodology.md` L225: multi-warrant has a single canonical
    // move (decompose the claim). The advisory "no requirement to act"
    // framing is communicated by the panel-level
    // `data-diagnostic-severity="advisory"` chrome, not by adding a
    // no-op move here.
    expect(suggestionsForDiagnostic(multiWarrantPayload())).toEqual([
      'decompose',
    ] satisfies SuggestionMove[]);
  });

  it('dangling-claim → [prompt-for-support, mark-conceded]', () => {
    // `docs/methodology.md` L226: dangling-claim is a soft prompt —
    // ask for support or ask whether the claim is being conceded.
    expect(suggestionsForDiagnostic(danglingClaimPayload())).toEqual([
      'prompt-for-support',
      'mark-conceded',
    ] satisfies SuggestionMove[]);
  });
});

describe('suggestionsForDiagnostic — coherency-hint sub-kind invariant', () => {
  // `docs/methodology.md` L227 + `docs/data-model.md` L197: all three
  // coherency-hint sub-kinds are advisory-equivalent with the same
  // generic guidance. The helper narrows on sub-kind to surface the
  // seam, but currently returns the same triple. A future per-sub-kind
  // divergence is a deliberate change.

  const EXPECTED: readonly SuggestionMove[] = [
    'review-configuration',
    'repair-configuration',
    'leave-as-intentional',
  ];

  it('incomplete-warrant-missing-bridges-to → [review, repair, leave-as-intentional]', () => {
    expect(suggestionsForDiagnostic(coherencyHintToPayload())).toEqual(EXPECTED);
  });

  it('incomplete-warrant-missing-bridges-from → [review, repair, leave-as-intentional]', () => {
    expect(suggestionsForDiagnostic(coherencyHintFromPayload())).toEqual(EXPECTED);
  });

  it('self-contradicts → [review, repair, leave-as-intentional]', () => {
    expect(suggestionsForDiagnostic(coherencyHintSelfContradictsPayload())).toEqual(EXPECTED);
  });
});

describe('suggestionsForDiagnostic — exhaustive-narrow guard', () => {
  it('every wsDiagnosticKinds value yields a non-empty array', () => {
    // If a future kind addition lands in `wsDiagnosticKinds` without
    // growing the helper's switch, the switch falls through with no
    // return — `suggestionsForDiagnostic` returns `undefined` at
    // runtime and this assertion fails for the new kind.
    for (const kind of wsDiagnosticKinds) {
      const payload = payloadForKind(kind);
      const moves = suggestionsForDiagnostic(payload);
      expect(moves, `suggestionsForDiagnostic(${kind}) must be defined`).toBeDefined();
      expect(moves.length, `suggestionsForDiagnostic(${kind}) must be non-empty`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe('suggestionsForDiagnostic — order-determinism', () => {
  it('repeated calls with the same payload reference produce identical orderings', () => {
    // Pins the canonical-order discipline: the helper returns a fresh
    // array per call, but the membership and ordering must be stable.
    // The `.join('\0')` comparison surfaces any ordering churn.
    const payload = cyclePayload();
    const a = suggestionsForDiagnostic(payload);
    const b = suggestionsForDiagnostic(payload);
    expect(a.join('\0')).toBe(b.join('\0'));
  });

  it('different payload instances of the same kind produce identical orderings', () => {
    const a = suggestionsForDiagnostic(contradictionPayload());
    const b = suggestionsForDiagnostic(contradictionPayload());
    expect(a.join('\0')).toBe(b.join('\0'));
  });
});
