// Tests for `orderActiveDiagnostics` — the shared total order over the
// active-diagnostics map consumed by both `<DiagnosticSuggestionsPanel>`
// (focuses the head) and `<DiagnosticFlagPane>` (lists the whole order).
//
// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_flag_pane.md
//             (Acceptance §1, Decision §D2)
//
// Per ADR 0022 these are committed Vitest cases. They pin the order rule
// the suggestions panel's focus-pick used to own inline:
//
//   - blocking sorts before advisory;
//   - within a severity, ascending `sequence`;
//   - identity-key lexicographic tiebreak for equal sequence;
//   - empty map → [].

import { describe, expect, it } from 'vitest';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { diagnosticIdentityKey } from '@a-conversa/shell';

import { orderActiveDiagnostics } from './orderActiveDiagnostics';

const SESSION = '00000000-0000-4000-8000-000000000099';

function cyclePayload(nodes: readonly string[], sequence: number): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'cycle',
    severity: 'blocking',
    status: 'fired',
    sequence,
    diagnostic: { kind: 'cycle', nodes },
  };
}

function multiWarrantPayload(sequence: number): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'multi-warrant',
    severity: 'advisory',
    status: 'fired',
    sequence,
    diagnostic: {
      kind: 'multi-warrant',
      dataNodeId: 'node-a',
      claimNodeId: 'node-b',
      warrantNodeIds: ['node-c'],
    },
  };
}

function contradictionPayload(nodeA: string, nodeB: string, sequence: number): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'contradiction',
    severity: 'blocking',
    status: 'fired',
    sequence,
    diagnostic: { kind: 'contradiction', nodeA, nodeB, edges: ['edge-1'] },
  };
}

/** Build the keyed active-diagnostics map the WS store maintains. */
function mapOf(...payloads: readonly DiagnosticPayload[]): Map<string, DiagnosticPayload> {
  const map = new Map<string, DiagnosticPayload>();
  for (const payload of payloads) {
    map.set(diagnosticIdentityKey(payload), payload);
  }
  return map;
}

describe('orderActiveDiagnostics', () => {
  it('returns [] for an empty map', () => {
    expect(orderActiveDiagnostics(new Map())).toEqual([]);
  });

  it('sorts blocking before advisory regardless of sequence', () => {
    // Advisory has the lower sequence — blocking must still come first.
    const advisory = multiWarrantPayload(1);
    const blocking = cyclePayload(['node-a', 'node-b'], 5);
    const ordered = orderActiveDiagnostics(mapOf(advisory, blocking));
    expect(ordered).toHaveLength(2);
    expect(ordered[0]?.severity).toBe('blocking');
    expect(ordered[1]?.severity).toBe('advisory');
  });

  it('sorts ascending by sequence within the same severity', () => {
    const later = cyclePayload(['node-a', 'node-b'], 7);
    const earlier = cyclePayload(['node-a', 'node-c'], 3);
    const ordered = orderActiveDiagnostics(mapOf(later, earlier));
    expect(ordered[0]?.sequence).toBe(3);
    expect(ordered[1]?.sequence).toBe(7);
  });

  it('breaks equal-sequence ties by identity key lexicographically', () => {
    const earlier = contradictionPayload('node-aa', 'node-ab', 4);
    const later = contradictionPayload('node-ba', 'node-bb', 4);
    const ordered = orderActiveDiagnostics(mapOf(later, earlier));
    expect(diagnosticIdentityKey(ordered[0] as DiagnosticPayload)).toBe(
      diagnosticIdentityKey(earlier),
    );
    expect(diagnosticIdentityKey(ordered[1] as DiagnosticPayload)).toBe(
      diagnosticIdentityKey(later),
    );
  });

  it('produces a single deterministic order across blocking + advisory + ties', () => {
    const ordered = orderActiveDiagnostics(
      mapOf(
        multiWarrantPayload(2),
        cyclePayload(['node-a', 'node-b'], 9),
        contradictionPayload('node-aa', 'node-ab', 9),
      ),
    );
    // Two blocking (sequence 9, tie broken by identity key:
    // contradiction\0... vs cycle\0...) then the advisory.
    expect(ordered.map((p) => p.severity)).toEqual(['blocking', 'blocking', 'advisory']);
    // 'contradiction' < 'cycle' lexicographically, so the contradiction
    // wins the same-sequence tie.
    expect(ordered[0]?.kind).toBe('contradiction');
    expect(ordered[1]?.kind).toBe('cycle');
    expect(ordered[2]?.kind).toBe('multi-warrant');
  });
});
