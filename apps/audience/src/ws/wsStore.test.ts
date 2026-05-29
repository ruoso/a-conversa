// Smoke tests for the audience's `audienceWsStore` singleton.
//
// Refinement: tasks/refinements/audience/aud_ws_client.md
//   (Decision §2 — historically a thin re-export of the shell's
//   `createDefaultWsStore()`; that refinement explicitly named the
//   audience as the eventual third caller that would trigger the
//   `activeDiagnostics` slot's lift.)
// Refinement: tasks/refinements/audience/aud_diagnostic_fire_animation.md
//   (Decision §3 — the store widens locally with the
//   `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` slot;
//   `applyDiagnostic` dispatches on `payload.status`. The shell-side
//   lift is registered as the named-future-task
//   `shell_diagnostic_highlights_extract`.)
//
// Per ADR 0022 these are committed tests, not throwaway probes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DiagnosticPayload, Event } from '@a-conversa/shared-types';

import { audienceWsStore } from './wsStore.js';

const SESSION_A = '00000000-0000-4000-8000-000000000001';

const initial = audienceWsStore.getState();

beforeEach(() => {
  audienceWsStore.setState(initial, true);
});

afterEach(() => {
  audienceWsStore.getState().reset();
});

function makeEvent(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-00000000000${sequence}`,
    sessionId: SESSION_A,
    sequence,
    kind: 'session-created',
    actor: '00000000-0000-4000-8000-0000000000aa',
    createdAt: '2026-05-18T10:00:00.000Z',
    payload: {
      host_user_id: '00000000-0000-4000-8000-0000000000aa',
      privacy: 'public',
      topic: 'audience store test',
      created_at: '2026-05-18T10:00:00.000Z',
    },
  };
}

describe('audience audienceWsStore', () => {
  it('starts in the idle status with no subscriptions or session-state', () => {
    const state = audienceWsStore.getState();
    expect(state.connectionStatus).toBe('idle');
    expect(state.connectionId).toBeUndefined();
    expect(state.subscriptions.size).toBe(0);
    expect(state.sessionState).toEqual({});
    expect(state.lastError).toBeUndefined();
  });

  it('setConnectionStatus writes through to the singleton', () => {
    audienceWsStore.getState().setConnectionStatus('open');
    expect(audienceWsStore.getState().connectionStatus).toBe('open');
  });

  it('applyEvent dedupes by sequence per session', () => {
    const { applyEvent } = audienceWsStore.getState();
    expect(applyEvent(makeEvent(1))).toBe(true);
    expect(applyEvent(makeEvent(1))).toBe(false);
    const session = audienceWsStore.getState().sessionState[SESSION_A];
    expect(session?.events.length).toBe(1);
    expect(session?.lastAppliedSequence).toBe(1);
  });

  it('reset returns to factory defaults', () => {
    audienceWsStore.getState().setConnectionStatus('open');
    audienceWsStore.getState().applyEvent(makeEvent(1));
    expect(audienceWsStore.getState().connectionStatus).toBe('open');
    expect(audienceWsStore.getState().sessionState[SESSION_A]).toBeDefined();
    audienceWsStore.getState().reset();
    const state = audienceWsStore.getState();
    expect(state.connectionStatus).toBe('idle');
    expect(state.connectionId).toBeUndefined();
    expect(state.subscriptions.size).toBe(0);
    expect(state.sessionState).toEqual({});
    expect(state.lastError).toBeUndefined();
  });

  it('a freshly-materialized session carries an empty activeDiagnostics map', () => {
    audienceWsStore.getState().applyEvent(makeEvent(1));
    const session = audienceWsStore.getState().sessionState[SESSION_A];
    expect(session?.activeDiagnostics).toBeInstanceOf(Map);
    expect(session?.activeDiagnostics.size).toBe(0);
  });
});

// -- applyDiagnostic — active-diagnostic set semantics ---------------
//
// Refinement: tasks/refinements/audience/aud_diagnostic_fire_animation.md
//
// The reducer widens to track an `activeDiagnostics` map per session.
// Each `'fired'` envelope sets/replaces the entry under its identity
// key; each `'cleared'` envelope removes it. `lastDiagnostic` remains
// the "last envelope seen" slot for backward compat — both fields are
// updated on every envelope. Mirrors the participant's
// `apps/participant/src/ws/wsStore.test.ts` coverage shape.

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

describe('audience audienceWsStore — applyDiagnostic active-set semantics', () => {
  it('a fired diagnostic populates activeDiagnostics keyed by the wire identity', () => {
    audienceWsStore.getState().applyDiagnostic(firedCyclePayload(['n-a', 'n-b']));
    const session = audienceWsStore.getState().sessionState[SESSION_A];
    expect(session?.activeDiagnostics.size).toBe(1);
    expect(session?.activeDiagnostics.get('cycle\0n-a\0n-b')).toBeDefined();
    expect(session?.activeDiagnostics.get('cycle\0n-a\0n-b')?.kind).toBe('cycle');
  });

  it('a cleared envelope for the same identity removes the entry', () => {
    const { applyDiagnostic } = audienceWsStore.getState();
    applyDiagnostic(firedCyclePayload(['n-a', 'n-b']));
    expect(audienceWsStore.getState().sessionState[SESSION_A]?.activeDiagnostics.size).toBe(1);
    applyDiagnostic(clearedCyclePayload(['n-a', 'n-b']));
    expect(audienceWsStore.getState().sessionState[SESSION_A]?.activeDiagnostics.size).toBe(0);
    // lastDiagnostic still flips to the most recent envelope.
    expect(audienceWsStore.getState().sessionState[SESSION_A]?.lastDiagnostic?.status).toBe(
      'cleared',
    );
  });

  it('a re-fired diagnostic of the same identity replaces the entry under that key', () => {
    const { applyDiagnostic } = audienceWsStore.getState();
    const first = firedCyclePayload(['n-a', 'n-b']);
    const second: DiagnosticPayload = { ...first, sequence: 5 };
    applyDiagnostic(first);
    applyDiagnostic(second);
    const session = audienceWsStore.getState().sessionState[SESSION_A];
    expect(session?.activeDiagnostics.size).toBe(1);
    expect(session?.activeDiagnostics.get('cycle\0n-a\0n-b')?.sequence).toBe(5);
  });

  it('two distinct fired diagnostics co-exist in activeDiagnostics', () => {
    const { applyDiagnostic } = audienceWsStore.getState();
    applyDiagnostic(firedCyclePayload(['n-a', 'n-b']));
    applyDiagnostic(firedDanglingClaimPayload('n-c'));
    const session = audienceWsStore.getState().sessionState[SESSION_A];
    expect(session?.activeDiagnostics.size).toBe(2);
    expect(session?.activeDiagnostics.get('cycle\0n-a\0n-b')).toBeDefined();
    expect(session?.activeDiagnostics.get('dangling-claim\0n-c')).toBeDefined();
  });
});
