// Smoke tests for `useWsStore` — the moderator's server-state slice.
//
// Refinement: tasks/refinements/moderator-ui/mod_ws_client.md
//
// The store reducer is the dedup + projection contract the client
// depends on. We test the reducer directly (without going through the
// client) so a regression here surfaces independently from the wire
// path.
//
// Per ADR 0022 these are committed tests, not throwaway probes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DiagnosticPayload, Event } from '@a-conversa/shared-types';

import { useWsStore } from './wsStore.js';

const SESSION_A = '00000000-0000-4000-8000-000000000001';

function makeEvent(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`,
    sessionId: SESSION_A,
    sequence,
    kind: 'participant-left',
    actor: '00000000-0000-4000-8000-0000000000aa',
    payload: {
      user_id: '00000000-0000-4000-8000-0000000000aa',
      left_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

const initial = useWsStore.getState();

beforeEach(() => {
  useWsStore.setState(initial, true);
});

afterEach(() => {
  useWsStore.getState().reset();
});

describe('useWsStore', () => {
  it('starts in the idle status with no subscriptions or session-state', () => {
    const state = useWsStore.getState();
    expect(state.connectionStatus).toBe('idle');
    expect(state.connectionId).toBeUndefined();
    expect(state.subscriptions.size).toBe(0);
    expect(state.sessionState).toEqual({});
    expect(state.lastError).toBeUndefined();
  });

  it('trackSubscription is idempotent and reports whether the session was new', () => {
    const { trackSubscription } = useWsStore.getState();
    expect(trackSubscription(SESSION_A)).toBe(true);
    expect(trackSubscription(SESSION_A)).toBe(false);
    expect(useWsStore.getState().subscriptions.size).toBe(1);
  });

  it('applyEvent appends in arrival order and dedupes by sequence', () => {
    const { applyEvent } = useWsStore.getState();
    expect(applyEvent(makeEvent(1))).toBe(true);
    expect(applyEvent(makeEvent(2))).toBe(true);
    expect(applyEvent(makeEvent(1))).toBe(false); // dup
    expect(applyEvent(makeEvent(3))).toBe(true);
    expect(applyEvent(makeEvent(2))).toBe(false); // dup
    const session = useWsStore.getState().sessionState[SESSION_A];
    expect(session?.lastAppliedSequence).toBe(3);
    expect(session?.events.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it('applySnapshot advances the high-water mark only forward', () => {
    const { applySnapshot, applyEvent } = useWsStore.getState();
    applyEvent(makeEvent(5));
    applySnapshot(SESSION_A, 4); // older — ignored
    expect(useWsStore.getState().sessionState[SESSION_A]?.lastAppliedSequence).toBe(5);
    applySnapshot(SESSION_A, 10);
    expect(useWsStore.getState().sessionState[SESSION_A]?.lastAppliedSequence).toBe(10);
  });

  it('reset clears every tracked field', () => {
    const { trackSubscription, applyEvent, setConnectionId, setConnectionStatus, reset } =
      useWsStore.getState();
    trackSubscription(SESSION_A);
    applyEvent(makeEvent(1));
    setConnectionId('conn-x');
    setConnectionStatus('open');
    reset();
    const state = useWsStore.getState();
    expect(state.subscriptions.size).toBe(0);
    expect(state.sessionState).toEqual({});
    expect(state.connectionId).toBeUndefined();
    expect(state.connectionStatus).toBe('idle');
  });
});

// -- applyDiagnostic — active-diagnostic set semantics ---------------
//
// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md
//
// The reducer widens to track an `activeDiagnostics` map per session.
// Each `'fired'` envelope sets/replaces the entry under its identity
// key; each `'cleared'` envelope removes it. `lastDiagnostic` remains
// the "last envelope seen" slot for backward compat with
// `client.test.ts:387` — both fields are updated on every envelope.

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

describe('useWsStore — applyDiagnostic active-set semantics (mod_diagnostic_highlighting)', () => {
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

  it('lastDiagnostic stays the latest envelope (regardless of status)', () => {
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

  it('a session record created lazily by ensureSession has an empty activeDiagnostics map', () => {
    const { applyDiagnostic } = useWsStore.getState();
    // First-touch on the session is the diagnostic itself — the
    // session record must be created with a fresh Map.
    applyDiagnostic(firedCyclePayload(['n-a', 'n-b']));
    const session = useWsStore.getState().sessionState[SESSION_A];
    expect(session?.activeDiagnostics).toBeInstanceOf(Map);
  });
});
