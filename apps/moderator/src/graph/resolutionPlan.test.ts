// Tests for `resolutionPlanForMove` — the pure `(move, diagnostic)` →
// action-descriptor router behind the F7 resolution-path picker.
//
// Refinement: tasks/refinements/moderator-ui/mod_resolution_path_picker.md
//             (Acceptance §1-§3, Decisions §D3/§D4/§D5)
//
// Per ADR 0022 these are committed Vitest cases. They pin, for every
// `(diagnostic kind, move)` pair in the methodology catalog:
//
//   - the disposition class (mode-entry / proposal-submenu / focus-only),
//   - the resolved capture mode or proposal submenu,
//   - the target (direct vs inline chooser) and its candidate node ids,
//   - the affected-region focus set (deduped, derived from
//     `affectedEntities`).
//
// Single-target diagnostics (multi-warrant → claim, dangling-claim) yield
// direct-dispatch plans; multi-candidate diagnostics (cycle, contradiction)
// yield chooser plans listing the candidate node ids (Decision §D4).

import { describe, expect, it } from 'vitest';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { suggestionsForDiagnostic, type SuggestionMove } from './diagnosticSuggestions.js';
import { resolutionPlanForMove } from './resolutionPlan.js';

const SESSION = '00000000-0000-4000-8000-000000000099';
const NODE_A = 'node-a';
const NODE_B = 'node-b';
const NODE_C = 'node-c';
const EDGE_1 = 'edge-1';
const EDGE_2 = 'edge-2';

function cyclePayload(nodes: readonly string[] = [NODE_A, NODE_B, NODE_C]): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'cycle',
    severity: 'blocking',
    status: 'fired',
    sequence: 1,
    diagnostic: { kind: 'cycle', nodes },
  };
}

function contradictionPayload(): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'contradiction',
    severity: 'blocking',
    status: 'fired',
    sequence: 1,
    diagnostic: { kind: 'contradiction', nodeA: NODE_A, nodeB: NODE_B, edges: [EDGE_1, EDGE_2] },
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
      warrantNodeIds: [NODE_C],
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

function coherencyHintPayload(): DiagnosticPayload {
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
        warrantNodeId: NODE_A,
        dataNodeId: NODE_B,
      },
    },
  };
}

describe('resolutionPlanForMove — cycle catalog', () => {
  const payload = cyclePayload();

  it('break-edge is focus-only and frames the cycle nodes (deferred dispatch, Decision §D5)', () => {
    const plan = resolutionPlanForMove('break-edge', payload);
    expect(plan.disposition).toBe('focus-only');
    expect(plan.focus.nodeIds).toEqual([NODE_A, NODE_B, NODE_C]);
    expect(plan.focus.edgeIds).toEqual([]);
  });

  it('decompose enters decompose mode with a chooser over the cycle nodes', () => {
    const plan = resolutionPlanForMove('decompose', payload);
    if (plan.disposition !== 'mode-entry') throw new Error('expected mode-entry');
    expect(plan.mode).toBe('decompose');
    expect(plan.target).toEqual({ kind: 'chooser', candidateNodeIds: [NODE_A, NODE_B, NODE_C] });
  });

  it('axiom-mark opens the axiom-mark submenu via a chooser over the cycle nodes', () => {
    const plan = resolutionPlanForMove('axiom-mark', payload);
    if (plan.disposition !== 'proposal-submenu') throw new Error('expected proposal-submenu');
    expect(plan.submenu).toBe('axiom-mark');
    expect(plan.target).toEqual({ kind: 'chooser', candidateNodeIds: [NODE_A, NODE_B, NODE_C] });
  });

  it('dedupes repeated cycle nodes in the chooser candidates', () => {
    const plan = resolutionPlanForMove('decompose', cyclePayload([NODE_A, NODE_B, NODE_A]));
    if (plan.disposition !== 'mode-entry') throw new Error('expected mode-entry');
    expect(plan.target).toEqual({ kind: 'chooser', candidateNodeIds: [NODE_A, NODE_B] });
  });
});

describe('resolutionPlanForMove — contradiction catalog', () => {
  const payload = contradictionPayload();

  it('decompose enters decompose mode with a chooser over both nodes', () => {
    const plan = resolutionPlanForMove('decompose', payload);
    if (plan.disposition !== 'mode-entry') throw new Error('expected mode-entry');
    expect(plan.mode).toBe('decompose');
    expect(plan.target).toEqual({ kind: 'chooser', candidateNodeIds: [NODE_A, NODE_B] });
    // Focus frames both nodes AND the contradiction edges.
    expect(plan.focus.nodeIds).toEqual([NODE_A, NODE_B]);
    expect(plan.focus.edgeIds).toEqual([EDGE_1, EDGE_2]);
  });

  it('amend opens the edit-wording submenu via a chooser over both nodes', () => {
    const plan = resolutionPlanForMove('amend', payload);
    if (plan.disposition !== 'proposal-submenu') throw new Error('expected proposal-submenu');
    expect(plan.submenu).toBe('edit-wording');
    expect(plan.target).toEqual({ kind: 'chooser', candidateNodeIds: [NODE_A, NODE_B] });
  });

  it('axiom-mark-both opens the axiom-mark submenu via a chooser over BOTH nodes', () => {
    const plan = resolutionPlanForMove('axiom-mark-both', payload);
    if (plan.disposition !== 'proposal-submenu') throw new Error('expected proposal-submenu');
    expect(plan.submenu).toBe('axiom-mark');
    expect(plan.target).toEqual({ kind: 'chooser', candidateNodeIds: [NODE_A, NODE_B] });
  });
});

describe('resolutionPlanForMove — single-target dispatch (Decision §D4)', () => {
  it('multi-warrant decompose dispatches directly on the claim node', () => {
    const plan = resolutionPlanForMove('decompose', multiWarrantPayload());
    if (plan.disposition !== 'mode-entry') throw new Error('expected mode-entry');
    expect(plan.mode).toBe('decompose');
    expect(plan.target).toEqual({ kind: 'direct', nodeId: NODE_B });
    // Focus still frames the whole implicated set (data + claim + warrants).
    expect(plan.focus.nodeIds).toEqual([NODE_A, NODE_B, NODE_C]);
  });

  it('dangling-claim prompt-for-support enters warrant-elicitation directly on the claim node', () => {
    const plan = resolutionPlanForMove('prompt-for-support', danglingClaimPayload());
    if (plan.disposition !== 'mode-entry') throw new Error('expected mode-entry');
    expect(plan.mode).toBe('warrant-elicitation');
    expect(plan.target).toEqual({ kind: 'direct', nodeId: NODE_A });
  });
});

describe('resolutionPlanForMove — focus-only advisory + deferred moves (Decision §D5)', () => {
  it('dangling-claim mark-conceded is focus-only', () => {
    const plan = resolutionPlanForMove('mark-conceded', danglingClaimPayload());
    expect(plan.disposition).toBe('focus-only');
    expect(plan.focus.nodeIds).toEqual([NODE_A]);
  });

  it.each(['review-configuration', 'repair-configuration', 'leave-as-intentional'] as const)(
    'coherency-hint %s is focus-only',
    (move) => {
      const plan = resolutionPlanForMove(move, coherencyHintPayload());
      expect(plan.disposition).toBe('focus-only');
      expect(plan.focus.nodeIds).toEqual([NODE_A, NODE_B]);
    },
  );
});

describe('resolutionPlanForMove — exhaustiveness over the catalog', () => {
  // Every move the catalog actually surfaces for a diagnostic must route
  // to a non-throwing plan. Walking `suggestionsForDiagnostic` for one
  // payload per kind exercises every `(kind, move)` pair the picker can
  // ever render, so an unrouted catalog move is a test break here (the
  // compile-time `assertNever` covers an unrouted union member).
  const payloads: readonly DiagnosticPayload[] = [
    cyclePayload(),
    contradictionPayload(),
    multiWarrantPayload(),
    danglingClaimPayload(),
    coherencyHintPayload(),
  ];

  it('routes every catalog move for every diagnostic kind', () => {
    const dispositions = new Set<string>();
    for (const payload of payloads) {
      for (const move of suggestionsForDiagnostic(payload)) {
        const plan = resolutionPlanForMove(move, payload);
        expect(plan.focus).toBeDefined();
        dispositions.add(plan.disposition);
      }
    }
    // Representative of each disposition class is observed (Acceptance §2).
    expect(dispositions).toEqual(new Set(['mode-entry', 'proposal-submenu', 'focus-only']));
  });

  it('every SuggestionMove member routes without throwing (union exhaustiveness)', () => {
    // A representative payload per move so the typed-field access in the
    // router sees a compatible diagnostic.
    const moveToPayload: Record<SuggestionMove, DiagnosticPayload> = {
      'break-edge': cyclePayload(),
      decompose: cyclePayload(),
      'axiom-mark': cyclePayload(),
      amend: contradictionPayload(),
      'axiom-mark-both': contradictionPayload(),
      'prompt-for-support': danglingClaimPayload(),
      'mark-conceded': danglingClaimPayload(),
      'review-configuration': coherencyHintPayload(),
      'repair-configuration': coherencyHintPayload(),
      'leave-as-intentional': coherencyHintPayload(),
    };
    for (const [move, payload] of Object.entries(moveToPayload) as [
      SuggestionMove,
      DiagnosticPayload,
    ][]) {
      expect(() => resolutionPlanForMove(move, payload)).not.toThrow();
    }
  });
});
