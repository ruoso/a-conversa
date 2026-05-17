// Smoke tests for the participant's `useWsStore` singleton.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md
// Refinement: tasks/refinements/participant-ui/part_diagnostic_highlights.md
//   (Decision §2 — the store is widened locally with
//   `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>`; the
//   `applyDiagnostic` reducer dispatches on `payload.status`. The
//   existing cases continue to pass — the slot is additive.)
//
// The store reducer is the dedup + projection contract the future WS
// client depends on. We test it directly so a regression here surfaces
// independently from the wire path.
//
// Per ADR 0022 these are committed tests, not throwaway probes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { DiagnosticPayload, ProposalStatusPayload } from '@a-conversa/shared-types';

import { useWsStore } from './wsStore.js';

const SESSION_A = '00000000-0000-4000-8000-000000000001';

const initial = useWsStore.getState();

beforeEach(() => {
  useWsStore.setState(initial, true);
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
});

describe('participant useWsStore', () => {
  it('starts in the idle status with no subscriptions or session-state', () => {
    const state = useWsStore.getState();
    expect(state.connectionStatus).toBe('idle');
    expect(state.connectionId).toBeUndefined();
    expect(state.subscriptions.size).toBe(0);
    expect(state.sessionState).toEqual({});
    expect(state.lastError).toBeUndefined();
  });

  it('setConnectionStatus updates the slot and a React selector subscriber re-renders', () => {
    function StatusProbe() {
      const status = useWsStore((s) => s.connectionStatus);
      return createElement('span', { 'data-testid': 'probe-ws-status' }, status);
    }

    render(createElement(StatusProbe));
    expect(screen.getByTestId('probe-ws-status').textContent).toBe('idle');
    act(() => {
      useWsStore.getState().setConnectionStatus('open');
    });
    expect(useWsStore.getState().connectionStatus).toBe('open');
    expect(screen.getByTestId('probe-ws-status').textContent).toBe('open');
  });

  it('applyProposalStatus populates sessionState[sid].pendingProposals[pid] for a fresh session', () => {
    const payload: ProposalStatusPayload = {
      sessionId: '00000000-0000-4000-8000-000000000001',
      proposalId: '00000000-0000-4000-8000-0000000000a1',
      sequence: 1,
      perFacetStatus: {
        'facet-a': 'pending',
      },
    };

    useWsStore.getState().applyProposalStatus(payload);

    const session = useWsStore.getState().sessionState[payload.sessionId];
    expect(session).toBeDefined();
    expect(session?.pendingProposals[payload.proposalId]).toEqual(payload);
    // The lazily-created session record carries the rest of the base
    // shape's defaults so downstream readers can rely on it.
    expect(session?.lastAppliedSequence).toBe(0);
    expect(session?.events).toEqual([]);
    // The participant-side widening: the session record carries an
    // empty `activeDiagnostics` map too.
    expect(session?.activeDiagnostics).toBeInstanceOf(Map);
    expect(session?.activeDiagnostics.size).toBe(0);
  });
});

// -- applyDiagnostic — active-diagnostic set semantics ---------------
//
// Refinement: tasks/refinements/participant-ui/part_diagnostic_highlights.md
//
// The reducer widens to track an `activeDiagnostics` map per session.
// Each `'fired'` envelope sets/replaces the entry under its identity
// key; each `'cleared'` envelope removes it. `lastDiagnostic` remains
// the "last envelope seen" slot for backward compat — both fields are
// updated on every envelope. Mirrors the moderator's
// `apps/moderator/src/ws/wsStore.test.ts:141-206` coverage shape.

function firedCyclePayload(nodes: string[]): DiagnosticPayload {
  return {
    sessionId: SESSION_A,
    kind: 'cycle',
    severity: 'blocking',
    status: 'fired',
    sequence: 1,
    diagnostic: { kind: 'cycle', nodes },
  };
}

function clearedCyclePayload(nodes: string[]): DiagnosticPayload {
  return {
    sessionId: SESSION_A,
    kind: 'cycle',
    severity: 'blocking',
    status: 'cleared',
    sequence: 2,
    diagnostic: { kind: 'cycle', nodes },
  };
}

function firedDanglingClaimPayload(nodeId: string): DiagnosticPayload {
  return {
    sessionId: SESSION_A,
    kind: 'dangling-claim',
    severity: 'advisory',
    status: 'fired',
    sequence: 3,
    diagnostic: { kind: 'dangling-claim', nodeId },
  };
}

describe('participant useWsStore — applyDiagnostic active-set semantics (part_diagnostic_highlights)', () => {
  it('a fired diagnostic populates activeDiagnostics keyed by the wire identity', () => {
    const { applyDiagnostic } = useWsStore.getState();
    applyDiagnostic(firedCyclePayload(['n-a', 'n-b']));
    const session = useWsStore.getState().sessionState[SESSION_A];
    expect(session?.activeDiagnostics.size).toBe(1);
    // The identity key for a cycle is `cycle\0<sorted nodes>`.
    expect(session?.activeDiagnostics.get('cycle\0n-a\0n-b')).toBeDefined();
    expect(session?.activeDiagnostics.get('cycle\0n-a\0n-b')?.kind).toBe('cycle');
  });

  it('a cleared envelope for the same identity removes the entry', () => {
    const { applyDiagnostic } = useWsStore.getState();
    applyDiagnostic(firedCyclePayload(['n-a', 'n-b']));
    expect(useWsStore.getState().sessionState[SESSION_A]?.activeDiagnostics.size).toBe(1);
    applyDiagnostic(clearedCyclePayload(['n-a', 'n-b']));
    expect(useWsStore.getState().sessionState[SESSION_A]?.activeDiagnostics.size).toBe(0);
  });

  it('a cleared for an unknown identity is a no-op (no throw, no entry added)', () => {
    const { applyDiagnostic } = useWsStore.getState();
    // No prior fired — the cleared has no match. The reducer must
    // tolerate this (the server may emit a cleared for a diagnostic
    // this client never saw `fired` for, e.g. on first connect).
    applyDiagnostic(clearedCyclePayload(['n-x', 'n-y']));
    const session = useWsStore.getState().sessionState[SESSION_A];
    expect(session?.activeDiagnostics.size).toBe(0);
    // lastDiagnostic still flips to the most recent envelope.
    expect(session?.lastDiagnostic?.status).toBe('cleared');
  });

  it('two distinct fired diagnostics co-exist in activeDiagnostics', () => {
    const { applyDiagnostic } = useWsStore.getState();
    applyDiagnostic(firedCyclePayload(['n-a', 'n-b']));
    applyDiagnostic(firedDanglingClaimPayload('n-c'));
    const session = useWsStore.getState().sessionState[SESSION_A];
    expect(session?.activeDiagnostics.size).toBe(2);
    expect(session?.activeDiagnostics.get('cycle\0n-a\0n-b')).toBeDefined();
    expect(session?.activeDiagnostics.get('dangling-claim\0n-c')).toBeDefined();
  });

  it('lastDiagnostic stays the latest envelope (regardless of status — backward-compat preservation)', () => {
    const { applyDiagnostic } = useWsStore.getState();
    applyDiagnostic(firedCyclePayload(['n-a', 'n-b']));
    expect(useWsStore.getState().sessionState[SESSION_A]?.lastDiagnostic?.status).toBe('fired');
    applyDiagnostic(clearedCyclePayload(['n-a', 'n-b']));
    expect(useWsStore.getState().sessionState[SESSION_A]?.lastDiagnostic?.status).toBe('cleared');
  });

  it('reset clears activeDiagnostics', () => {
    const { applyDiagnostic, reset } = useWsStore.getState();
    applyDiagnostic(firedCyclePayload(['n-a', 'n-b']));
    expect(useWsStore.getState().sessionState[SESSION_A]?.activeDiagnostics.size).toBe(1);
    reset();
    expect(useWsStore.getState().sessionState).toEqual({});
  });
});
