// Smoke tests for the audience's `audienceWsStore` singleton.
//
// Refinement: tasks/refinements/audience/aud_ws_client.md
//   (Decision §2 — the audience consumes the shell's
//   `createDefaultWsStore()` factory verbatim. This file is a thin pin
//   proving the local re-export resolves and writes through correctly;
//   the shell's `packages/shell/src/ws/defaultStore.test.ts` covers
//   the underlying factory behaviour.)
//
// Per ADR 0022 these are committed tests, not throwaway probes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

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
});
