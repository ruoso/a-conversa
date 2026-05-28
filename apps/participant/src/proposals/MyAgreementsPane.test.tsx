// Vitest cases for `<MyAgreementsPane>`.
//
// Refinement: tasks/refinements/participant-ui/part_my_agreements_view.md
//   (Test layers per ADR 0022 — 7 cases pinning the empty-state branch,
//    single row, ordering, status-badge text, tap → selection + tab,
//    data-* attribute contract, ARIA contract.)

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Event } from '@a-conversa/shared-types';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';

import { MyAgreementsPane } from './MyAgreementsPane';
import { useWsStore } from '../ws/wsStore';
import { useUiStore } from '../stores/uiStore';
import { useSelectionStore } from '../stores/selectionStore';
import { computeFacetStatuses } from '@a-conversa/shell';

const SESSION = '00000000-0000-4000-8000-0000000000aa';
const ME = '00000000-0000-4000-8000-0000000000c0';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const PROPOSAL_B = '00000000-0000-4000-8000-0000000000a2';
const FIXED_NOW_MS = Date.parse('2026-05-25T00:05:00.000Z');

function envId(prefix: string, seq: number): string {
  return `00000000-0000-4000-8000-${(prefix.charCodeAt(0) * 256 + seq).toString(16).padStart(12, '0')}`;
}

function joinedEvent(seq: number, userId: string): Event {
  return {
    id: envId('j', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'participant-joined',
    actor: userId,
    payload: {
      user_id: userId,
      role: 'debater-A',
      screen_name: 'tester',
      joined_at: '2026-05-25T00:00:00.000Z',
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function nodeEvent(seq: number, nodeId: string): Event {
  return {
    id: envId('n', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'node-created',
    actor: ME,
    payload: {
      node_id: nodeId,
      wording: `wording-${nodeId.slice(0, 4)}`,
      created_by: ME,
      created_at: '2026-05-25T00:00:00.000Z',
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function substanceProposal(seq: number, proposalId: string, nodeId: string): Event {
  return {
    id: proposalId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ME,
    payload: {
      proposal: { kind: 'set-node-substance', node_id: nodeId, value: 'agreed' },
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function classifyProposal(seq: number, proposalId: string, nodeId: string): Event {
  return {
    id: proposalId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ME,
    payload: {
      proposal: { kind: 'classify-node', node_id: nodeId, classification: 'fact' },
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function voteAgreeFacet(
  seq: number,
  nodeId: string,
  facet: 'wording' | 'classification' | 'substance' | 'shape',
): Event {
  return {
    id: envId('v', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'vote',
    actor: ME,
    payload: {
      target: 'facet',
      entity_kind: 'node',
      entity_id: nodeId,
      facet,
      participant: ME,
      choice: 'agree',
      voted_at: '2026-05-25T00:00:10.000Z',
    },
    createdAt: '2026-05-25T00:00:10.000Z',
  };
}

function commitFacet(
  seq: number,
  nodeId: string,
  facet: 'wording' | 'classification' | 'substance' | 'shape',
): Event {
  return {
    id: envId('c', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'commit',
    actor: ME,
    payload: {
      target: 'facet',
      entity_kind: 'node',
      entity_id: nodeId,
      facet,
      committed_by: ME,
      committed_at: '2026-05-25T00:00:20.000Z',
    },
    createdAt: '2026-05-25T00:00:20.000Z',
  };
}

function seed(events: readonly Event[]): void {
  const store = useWsStore.getState();
  for (const event of events) {
    store.applyEvent(event);
  }
}

let i18n: I18nInstance;

beforeAll(async () => {
  i18n = await createI18nInstance('en-US');
});

beforeEach(() => {
  useWsStore.getState().reset();
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
  useUiStore.setState({ currentTab: 'graph' });
  useSelectionStore.getState().clear();
});

function renderPane(events: readonly Event[] = []): ReturnType<typeof render> {
  act(() => {
    seed(events);
  });
  const facetStatusIndex = computeFacetStatuses(events);
  return render(
    <I18nProvider i18n={i18n}>
      <MyAgreementsPane
        sessionId={SESSION}
        currentParticipantId={ME}
        facetStatusIndex={facetStatusIndex}
        nowMsOverride={FIXED_NOW_MS}
      />
    </I18nProvider>,
  );
}

describe('<MyAgreementsPane>', () => {
  it('(a) renders the empty-state branch when the event log has no qualifying agreements', () => {
    renderPane([]);
    expect(screen.getByTestId('participant-my-agreements-pane-empty')).toBeTruthy();
    expect(screen.queryByTestId('participant-my-agreements-pane-list')).toBeNull();
  });

  it('(b) renders a single row carrying data-vote-event-id + data-facet-status', () => {
    const events: Event[] = [
      joinedEvent(1, ME),
      nodeEvent(2, NODE_A),
      substanceProposal(3, PROPOSAL_A, NODE_A),
      voteAgreeFacet(4, NODE_A, 'substance'),
    ];
    renderPane(events);
    const rows = screen.getAllByTestId('participant-my-agreements-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-vote-event-id')).toBe(envId('v', 4));
    expect(rows[0]?.getAttribute('data-facet-status')).toBe('agreed');
  });

  it('(c) renders multiple rows newest-first by agreedAtSequence', () => {
    const events: Event[] = [
      joinedEvent(1, ME),
      nodeEvent(2, NODE_A),
      nodeEvent(3, NODE_B),
      substanceProposal(4, PROPOSAL_A, NODE_A),
      classifyProposal(5, PROPOSAL_B, NODE_B),
      voteAgreeFacet(6, NODE_A, 'substance'),
      voteAgreeFacet(7, NODE_B, 'classification'),
    ];
    renderPane(events);
    const rows = screen.getAllByTestId('participant-my-agreements-row');
    expect(rows).toHaveLength(2);
    // Newest first — the agree at sequence 7 (NODE_B) comes before the
    // agree at sequence 6 (NODE_A).
    expect(rows[0]?.getAttribute('data-entity-id')).toBe(NODE_B);
    expect(rows[1]?.getAttribute('data-entity-id')).toBe(NODE_A);
  });

  it('(d) renders the committed catalog label inside the status cell when currentStatus is committed', () => {
    const events: Event[] = [
      joinedEvent(1, ME),
      nodeEvent(2, NODE_A),
      substanceProposal(3, PROPOSAL_A, NODE_A),
      voteAgreeFacet(4, NODE_A, 'substance'),
      commitFacet(5, NODE_A, 'substance'),
    ];
    renderPane(events);
    const row = screen.getByTestId('participant-my-agreements-row');
    expect(row.getAttribute('data-facet-status')).toBe('committed');
    const status = screen.getByTestId('participant-my-agreements-row-status');
    // The label is sourced from `methodology.facetState.committed`.
    expect(status.textContent).toBe('Committed');
  });

  it('(e) tapping a row calls useSelectionStore.select + useUiStore.setCurrentTab("graph")', () => {
    const events: Event[] = [
      joinedEvent(1, ME),
      nodeEvent(2, NODE_A),
      substanceProposal(3, PROPOSAL_A, NODE_A),
      voteAgreeFacet(4, NODE_A, 'substance'),
    ];
    // Park the tab on `'my-agreements'` so the tap's switch back to
    // `'graph'` is observable.
    useUiStore.setState({ currentTab: 'my-agreements' });
    renderPane(events);
    const row = screen.getByTestId('participant-my-agreements-row');
    const button = row.querySelector('button');
    expect(button).not.toBeNull();
    act(() => {
      fireEvent.click(button as Element);
    });
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'node', id: NODE_A });
    expect(useUiStore.getState().currentTab).toBe('graph');
  });

  it('(f) row data-* attributes carry entity-kind / entity-id / facet / facet-status', () => {
    const events: Event[] = [
      joinedEvent(1, ME),
      nodeEvent(2, NODE_A),
      substanceProposal(3, PROPOSAL_A, NODE_A),
      voteAgreeFacet(4, NODE_A, 'substance'),
    ];
    renderPane(events);
    const row = screen.getByTestId('participant-my-agreements-row');
    expect(row.getAttribute('data-entity-kind')).toBe('node');
    expect(row.getAttribute('data-entity-id')).toBe(NODE_A);
    expect(row.getAttribute('data-facet')).toBe('substance');
    expect(row.getAttribute('data-facet-status')).toBe('agreed');
  });

  it('(g) ARIA contract: section[role=tabpanel] + aria-label + ul[role=list]', () => {
    const events: Event[] = [
      joinedEvent(1, ME),
      nodeEvent(2, NODE_A),
      substanceProposal(3, PROPOSAL_A, NODE_A),
      voteAgreeFacet(4, NODE_A, 'substance'),
    ];
    renderPane(events);
    const section = screen.getByTestId('participant-my-agreements-pane');
    expect(section.getAttribute('role')).toBe('tabpanel');
    expect(section.getAttribute('aria-live')).toBe('polite');
    // The aria-label is sourced from the catalog; assert non-empty.
    expect((section.getAttribute('aria-label') ?? '').length).toBeGreaterThan(0);
    const list = screen.getByTestId('participant-my-agreements-pane-list');
    expect(list.getAttribute('role')).toBe('list');
  });
});
