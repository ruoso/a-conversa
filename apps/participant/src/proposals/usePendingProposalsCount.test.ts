// Vitest cases for `usePendingProposalsCount`.
//
// Refinement: tasks/refinements/participant-ui/part_migrate_to_pending_proposal_facet_status.md
//   (D1 / D5 — selector counts surviving proposals from
//    `derivePendingProposals(events)`. Cases cover missing session,
//    no events, one open proposal, two proposals + one commit (count
//    drops to one), and a re-render pin under `applyEvent`.)

import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { Event } from '@a-conversa/shared-types';

import { usePendingProposalsCount } from './usePendingProposalsCount';
import { useWsStore } from '../ws/wsStore';

const SESSION_A = '00000000-0000-4000-8000-0000000000aa';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const PROPOSAL_B = '00000000-0000-4000-8000-0000000000a2';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const COMMITTER = '00000000-0000-4000-8000-0000000000bb';
const ACTOR = '11112222-3333-4444-5555-666677778888';

function classifyProposalEvent(seq: number, envelopeId: string, nodeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION_A,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: { kind: 'classify-node', node_id: nodeId, classification: 'fact' },
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function commitProposalEvent(seq: number, proposalId: string): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x63_00_00 + seq).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_A,
    sequence: seq,
    kind: 'commit',
    actor: COMMITTER,
    payload: {
      target: 'proposal',
      proposal_id: proposalId,
      committed_by: COMMITTER,
      committed_at: '2026-05-25T00:00:20.000Z',
    },
    createdAt: '2026-05-25T00:00:20.000Z',
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

  it('(b) returns 0 when the session exists but the event log carries no surviving proposals', () => {
    // Apply a proposal + matching commit so the session record exists
    // but `derivePendingProposals` returns an empty list.
    useWsStore.getState().applyEvent(classifyProposalEvent(1, PROPOSAL_A, NODE_X));
    useWsStore.getState().applyEvent(commitProposalEvent(2, PROPOSAL_A));
    render(createElement(CountProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-count').textContent).toBe('0');
  });

  it('(c) returns 1 for a single `proposal` event with no commit/withdraw', () => {
    useWsStore.getState().applyEvent(classifyProposalEvent(1, PROPOSAL_A, NODE_X));
    render(createElement(CountProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-count').textContent).toBe('1');
  });

  it('(d) returns 2 for two `proposal` events and drops to 1 after a matching commit', () => {
    useWsStore.getState().applyEvent(classifyProposalEvent(1, PROPOSAL_A, NODE_X));
    useWsStore.getState().applyEvent(classifyProposalEvent(2, PROPOSAL_B, NODE_Y));
    render(createElement(CountProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-count').textContent).toBe('2');
    act(() => {
      useWsStore.getState().applyEvent(commitProposalEvent(3, PROPOSAL_A));
    });
    expect(screen.getByTestId('probe-count').textContent).toBe('1');
  });

  it('(e) re-renders when a new proposal lands via applyEvent', () => {
    render(createElement(CountProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-count').textContent).toBe('0');
    act(() => {
      useWsStore.getState().applyEvent(classifyProposalEvent(1, PROPOSAL_A, NODE_X));
    });
    expect(screen.getByTestId('probe-count').textContent).toBe('1');
    act(() => {
      useWsStore.getState().applyEvent(classifyProposalEvent(2, PROPOSAL_B, NODE_Y));
    });
    expect(screen.getByTestId('probe-count').textContent).toBe('2');
  });
});
