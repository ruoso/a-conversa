// Vitest cases for `usePendingProposalsCount`.
//
// Refinement: tasks/refinements/participant-ui/part_proposals_tab.md
//   (Test layers per ADR 0022 — selector correctness across empty /
//    non-empty / missing-session states + a re-render pin.)

import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ProposalStatusPayload } from '@a-conversa/shared-types';

import { usePendingProposalsCount } from './usePendingProposalsCount';
import { useWsStore } from '../ws/wsStore';

const SESSION_A = '00000000-0000-4000-8000-0000000000aa';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const PROPOSAL_B = '00000000-0000-4000-8000-0000000000a2';

function makePayload(proposalId: string, sequence: number): ProposalStatusPayload {
  return {
    sessionId: SESSION_A,
    proposalId,
    sequence,
    perFacetStatus: { 'facet-a': 'pending' },
  };
}

function CountProbe({ sessionId }: { sessionId: string }): ReactElement {
  const count = usePendingProposalsCount(sessionId);
  return createElement('span', { 'data-testid': 'probe-count' }, String(count));
}

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
});

describe('usePendingProposalsCount', () => {
  it('(a) returns 0 when the session is missing from the store', () => {
    render(createElement(CountProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-count').textContent).toBe('0');
  });

  it('(b) returns 0 when pendingProposals is an empty map', () => {
    // Seed the session via `applyProposalStatus` so the per-session
    // record exists, then wipe `pendingProposals` to empty via
    // `setState` to pin the explicit empty-map branch (distinct from
    // case (a)'s missing-session path).
    useWsStore.getState().applyProposalStatus(makePayload(PROPOSAL_A, 1));
    act(() => {
      useWsStore.setState((state) => ({
        sessionState: {
          ...state.sessionState,
          [SESSION_A]: {
            ...state.sessionState[SESSION_A]!,
            pendingProposals: {},
          },
        },
      }));
    });
    render(createElement(CountProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-count').textContent).toBe('0');
  });

  it('(c) returns the count of pendingProposals entries for the session', () => {
    useWsStore.getState().applyProposalStatus(makePayload(PROPOSAL_A, 1));
    useWsStore.getState().applyProposalStatus(makePayload(PROPOSAL_B, 2));
    render(createElement(CountProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-count').textContent).toBe('2');
  });

  it('(d) re-renders when a new proposal lands via applyProposalStatus', () => {
    render(createElement(CountProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-count').textContent).toBe('0');
    act(() => {
      useWsStore.getState().applyProposalStatus(makePayload(PROPOSAL_A, 1));
    });
    expect(screen.getByTestId('probe-count').textContent).toBe('1');
    act(() => {
      useWsStore.getState().applyProposalStatus(makePayload(PROPOSAL_B, 2));
    });
    expect(screen.getByTestId('probe-count').textContent).toBe('2');
  });
});
