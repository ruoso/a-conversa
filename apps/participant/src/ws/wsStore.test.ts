// Smoke tests for the participant's `useWsStore` singleton.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md +
//   tasks/refinements/shell-package/shell_diagnostic_highlights_extract.md
//   (the applyDiagnostic active-set cases have collapsed into
//   `packages/shell/src/ws/ws-client.test.ts` after the slot's
//   shell-canonicalization; only the participant-local wrapper shape
//   stays here.)
//
// The store reducer is the dedup + projection contract the WS client
// depends on. We test it directly so a regression here surfaces
// independently from the wire path.
//
// Per ADR 0022 these are committed tests, not throwaway probes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ProposalStatusPayload } from '@a-conversa/shared-types';

import { useWsStore } from './wsStore.js';

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
    // The shell-canonical `activeDiagnostics` slot is present on every
    // freshly-materialized session.
    expect(session?.activeDiagnostics).toBeInstanceOf(Map);
    expect(session?.activeDiagnostics.size).toBe(0);
  });
});
