// Smoke tests for `useWsStore` — the moderator's server-state slice.
//
// Refinement: tasks/refinements/moderator-ui/mod_ws_client.md +
//   tasks/refinements/shell-package/shell_diagnostic_highlights_extract.md
//   (the applyDiagnostic active-set cases have collapsed into
//   `packages/shell/src/ws/ws-client.test.ts` after the slot's
//   shell-canonicalization; only the moderator-local wrapper shape stays
//   here.)
//
// The store reducer is the dedup + projection contract the client
// depends on. We test the reducer directly (without going through the
// client) so a regression here surfaces independently from the wire
// path.
//
// Per ADR 0022 these are committed tests, not throwaway probes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

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
