// Vitest + RTL cases for the test-mode changed-highlights panel.
//
// Refinement: tasks/refinements/replay_test/test_mode_changed_highlights.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications — the
//   `data-testid` seams are the pinned regression surface); 0024
//   (react-i18next); 0039 (the canonical `projectGraph` the panel diffs).
//
// Drives a small synthetic log through the panel: at a mid-log commit stop it
// lists the node the step re-classified under the changed bucket; tracking a
// position change re-renders the readout; at `position 0` the baseline branch
// shows and no buckets render; at `position 1` the first node shows as added.
// Plain DOM assertions (`textContent` / `queryByTestId`) — jest-dom matchers
// are not wired into this workspace's Vitest setup.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { createI18nInstance } from '@a-conversa/shell';
import type { Event } from '@a-conversa/shared-types';

import { ChangeHighlights } from './ChangeHighlights';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const EDGE_A = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

function makeNodeCreated(sequence: number, nodeId: string): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x100 + sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: { node_id: nodeId, wording: nodeId, created_by: ACTOR },
    createdAt: '2026-05-27T00:00:00.000Z',
  } as unknown as Event;
}

function makeClassifyProposal(sequence: number): Event {
  return {
    id: PROPOSAL_A,
    sessionId: SESSION_ID,
    sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: { proposal: { kind: 'classify-node', node_id: NODE_A, classification: 'normative' } },
    createdAt: '2026-05-27T00:00:00.000Z',
  } as unknown as Event;
}

function makeCommit(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x200 + sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence,
    kind: 'commit',
    actor: ACTOR,
    payload: { target: 'proposal', proposal_id: PROPOSAL_A, committed_by: ACTOR },
    createdAt: '2026-05-27T00:00:00.000Z',
  } as unknown as Event;
}

function makeEdgeCreated(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x300 + sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence,
    kind: 'edge-created',
    actor: ACTOR,
    payload: { edge_id: EDGE_A, role: 'supports', source_node_id: NODE_A, target_node_id: NODE_B },
    createdAt: '2026-05-27T00:00:00.000Z',
  } as unknown as Event;
}

// A log checkpoint the projector genuinely ignores. (`participant-joined`
// is no longer a graph no-op: per the per-facet step pill, `projectGraph`
// derives the debater roster and facet statuses from it, so a join
// re-stamps every statement node's data.)
function makeSnapshotCreated(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x400 + sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence,
    kind: 'snapshot-created',
    actor: ACTOR,
    payload: { snapshot_id: ACTOR, label: 'checkpoint', log_position: sequence - 1 },
    createdAt: '2026-05-27T00:00:00.000Z',
  } as unknown as Event;
}

// seq 1 add A, 2 add B, 3 classify-proposal A (graph no-op), 4 commit (A kind
// flips → changed), 5 add edge A→B, 6 snapshot-created (graph no-op).
const EVENTS: Event[] = [
  makeNodeCreated(1, NODE_A),
  makeNodeCreated(2, NODE_B),
  makeClassifyProposal(3),
  makeCommit(4),
  makeEdgeCreated(5),
  makeSnapshotCreated(6),
];

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('ChangeHighlights — a step that changes a node', () => {
  it('lists the re-classified node under the changed bucket with the touched field', () => {
    render(<ChangeHighlights events={EVENTS} position={4} />);

    const changed = screen.getByTestId('test-mode-changes-nodes-changed');
    expect(changed.textContent).toContain(NODE_A);
    expect(screen.getByTestId('test-mode-changes-nodes-changed-fields').textContent).toContain(
      'kind',
    );

    // The commit touched no other bucket.
    expect(screen.queryByTestId('test-mode-changes-nodes-added')).toBeNull();
    expect(screen.queryByTestId('test-mode-changes-edges-added')).toBeNull();
    expect(screen.queryByTestId('test-mode-changes-baseline')).toBeNull();
    expect(screen.queryByTestId('test-mode-changes-empty')).toBeNull();
  });
});

describe('ChangeHighlights — tracking the position', () => {
  it('re-renders the readout when the position changes', () => {
    const { rerender } = render(<ChangeHighlights events={EVENTS} position={4} />);
    expect(screen.queryByTestId('test-mode-changes-nodes-changed')).not.toBeNull();

    // Step to the edge-creation stop: now an edge is added, no node changed.
    rerender(<ChangeHighlights events={EVENTS} position={5} />);
    expect(screen.getByTestId('test-mode-changes-edges-added').textContent).toContain(EDGE_A);
    expect(screen.queryByTestId('test-mode-changes-nodes-changed')).toBeNull();
  });

  it('shows the empty readout for a step the projector treats as a no-op', () => {
    // seq 6 (snapshot-created) projects no graph change.
    render(<ChangeHighlights events={EVENTS} position={6} />);
    expect(screen.queryByTestId('test-mode-changes-empty')).not.toBeNull();
    expect(screen.queryByTestId('test-mode-changes-nodes-added')).toBeNull();
  });
});

describe('ChangeHighlights — baseline and first step', () => {
  it('renders the baseline branch at position 0 with no buckets', () => {
    render(<ChangeHighlights events={EVENTS} position={0} />);

    expect(screen.queryByTestId('test-mode-changes-baseline')).not.toBeNull();
    expect(screen.queryByTestId('test-mode-changes-nodes-added')).toBeNull();
    expect(screen.queryByTestId('test-mode-changes-nodes-changed')).toBeNull();
    expect(screen.queryByTestId('test-mode-changes-empty')).toBeNull();
  });

  it('shows the first event as added at position 1 (empty before-prefix)', () => {
    render(<ChangeHighlights events={EVENTS} position={1} />);

    const added = screen.getByTestId('test-mode-changes-nodes-added');
    expect(added.textContent).toContain(NODE_A);
    expect(added.textContent).not.toContain(NODE_B);
    expect(screen.queryByTestId('test-mode-changes-baseline')).toBeNull();
  });
});
