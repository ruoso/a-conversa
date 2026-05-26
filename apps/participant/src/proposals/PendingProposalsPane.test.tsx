// Vitest cases for `<PendingProposalsPane>`.
//
// Refinement: tasks/refinements/participant-ui/part_proposal_list_view.md
//   (prior:    tasks/refinements/participant-ui/part_proposals_tab.md —
//    the predecessor's four cases are preserved with the source-of-
//    truth switch from `pendingProposals` to `events` baked into the
//    fixtures; five new row-rendering cases are appended.)

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Event } from '@a-conversa/shared-types';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';

import { PendingProposalsPane } from './PendingProposalsPane';
import { useWsStore } from '../ws/wsStore';
import { useUiStore } from '../stores/uiStore';

const SESSION_A = '00000000-0000-4000-8000-0000000000aa';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const PROPOSAL_B = '00000000-0000-4000-8000-0000000000a2';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const ACTOR_HUMAN = '11112222-3333-4444-5555-666677778888';
const ACTOR_SECOND = '99998888-7777-6666-5555-444433332211';
const COMMITTER = '00000000-0000-4000-8000-0000000000bb';
const FIXED_NOW_MS = Date.parse('2026-05-25T00:01:00.000Z');

function proposalEvent(
  seq: number,
  envelopeId: string,
  proposalKind: 'classify-node' | 'set-node-substance',
  nodeId: string,
  actor: string | null = ACTOR_HUMAN,
): Event {
  if (proposalKind === 'classify-node') {
    return {
      id: envelopeId,
      sessionId: SESSION_A,
      sequence: seq,
      kind: 'proposal',
      actor,
      payload: {
        proposal: { kind: 'classify-node', node_id: nodeId, classification: 'fact' },
      },
      createdAt: '2026-05-25T00:00:00.000Z',
    };
  }
  return {
    id: envelopeId,
    sessionId: SESSION_A,
    sequence: seq,
    kind: 'proposal',
    actor,
    payload: {
      proposal: { kind: 'set-node-substance', node_id: nodeId, value: 'agreed' },
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

let i18n: I18nInstance;

beforeAll(async () => {
  i18n = await createI18nInstance('en-US');
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
  useUiStore.getState().setExpandedProposalId(null);
});

function renderPane(): ReturnType<typeof render> {
  return render(
    <I18nProvider i18n={i18n}>
      <PendingProposalsPane sessionId={SESSION_A} nowMsOverride={FIXED_NOW_MS} />
    </I18nProvider>,
  );
}

describe('<PendingProposalsPane>', () => {
  it('(a) renders the empty-state when the session is missing (no events)', () => {
    renderPane();
    expect(screen.getByTestId('participant-pending-proposals-pane')).toBeTruthy();
    const empty = screen.getByTestId('participant-pending-proposals-pane-empty');
    expect(empty.textContent).toBe('No pending proposals');
    expect(screen.queryByTestId('participant-pending-proposals-pane-list')).toBeNull();
  });

  it('(b) renders the empty-state when the session exists but the event log carries no surviving proposals', () => {
    // Apply a proposal + a matching commit so the derived list is
    // empty even though the session slot exists.
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    useWsStore.getState().applyEvent(commitProposalEvent(2, PROPOSAL_A));
    renderPane();
    expect(screen.getByTestId('participant-pending-proposals-pane-empty')).toBeTruthy();
    expect(screen.queryByTestId('participant-pending-proposals-pane-list')).toBeNull();
  });

  it('(c) hides the empty-state and renders the list container when the event log carries a surviving proposal', () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    renderPane();
    expect(screen.queryByTestId('participant-pending-proposals-pane-empty')).toBeNull();
    expect(screen.getByTestId('participant-pending-proposals-pane-list')).toBeTruthy();
  });

  it('(d) exposes role="tabpanel" + aria-live="polite" on the container', () => {
    renderPane();
    const pane = screen.getByTestId('participant-pending-proposals-pane');
    expect(pane.getAttribute('role')).toBe('tabpanel');
    expect(pane.getAttribute('aria-live')).toBe('polite');
  });

  it('(e) one proposal event → one row visible with data-proposal-id matching the event id', () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    renderPane();
    const rows = screen.getAllByTestId('participant-pending-proposal-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-proposal-id')).toBe(PROPOSAL_A);
  });

  it('(f) two proposal events at sequences 1 and 2 → rows in newest-first DOM order', () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    useWsStore.getState().applyEvent(proposalEvent(2, PROPOSAL_B, 'classify-node', NODE_Y));
    renderPane();
    const rows = screen.getAllByTestId('participant-pending-proposal-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('data-proposal-id')).toBe(PROPOSAL_B);
    expect(rows[1]?.getAttribute('data-proposal-id')).toBe(PROPOSAL_A);
  });

  it('(g) classify-node proposal → kind chip renders the methodology.kind.<classification> catalog string', () => {
    useWsStore
      .getState()
      .applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X, ACTOR_SECOND));
    renderPane();
    const chip = screen.getByTestId('participant-pending-proposal-row-kind');
    expect(chip.textContent).toBe('Fact');
  });

  it('(h) proposal with actor === null → author cell renders the systemAuthor catalog string', () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X, null));
    renderPane();
    const author = screen.getByTestId('participant-pending-proposal-row-author');
    expect(author.textContent).toBe('System');
  });

  it('(i) proposal followed by a matching commit → back to the empty-state branch (no rows visible)', () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    useWsStore.getState().applyEvent(commitProposalEvent(2, PROPOSAL_A));
    renderPane();
    expect(screen.queryByTestId('participant-pending-proposal-row')).toBeNull();
    expect(screen.getByTestId('participant-pending-proposals-pane-empty')).toBeTruthy();
  });

  it('(j) default state — header button rendered collapsed; body absent', () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    renderPane();
    const row = screen.getByTestId('participant-pending-proposal-row');
    expect(row.getAttribute('data-expanded')).toBe('false');
    const header = screen.getByTestId('participant-pending-proposal-row-header');
    expect(header.tagName).toBe('BUTTON');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('participant-pending-proposal-row-body')).toBeNull();
  });

  it('(k) tap the header → row expands, body visible, body hosts the per-facet chip strip', () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    renderPane();
    const header = screen.getByTestId('participant-pending-proposal-row-header');
    act(() => {
      fireEvent.click(header);
    });
    const row = screen.getByTestId('participant-pending-proposal-row');
    expect(row.getAttribute('data-expanded')).toBe('true');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    const body = screen.getByTestId('participant-pending-proposal-row-body');
    expect(body).toBeTruthy();
    // The body's inner content is now the chip strip (the predecessor's
    // `-body-summary` <p> is REPLACED per Decision §2).
    expect(screen.getByTestId('participant-pending-proposal-row-facets')).toBeTruthy();
  });

  it('(l) tap the same header again → row collapses, body absent', () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    renderPane();
    const header = screen.getByTestId('participant-pending-proposal-row-header');
    act(() => {
      fireEvent.click(header);
    });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    act(() => {
      fireEvent.click(header);
    });
    const row = screen.getByTestId('participant-pending-proposal-row');
    expect(row.getAttribute('data-expanded')).toBe('false');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('participant-pending-proposal-row-body')).toBeNull();
  });

  it('(m) two rows; tap A then B → single-open accordion swaps the open slot to B', () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    useWsStore.getState().applyEvent(proposalEvent(2, PROPOSAL_B, 'classify-node', NODE_Y));
    renderPane();
    const rows = screen.getAllByTestId('participant-pending-proposal-row');
    // newest-first DOM order: rows[0] = PROPOSAL_B (seq 2), rows[1] = PROPOSAL_A (seq 1)
    const rowB = rows.find((r) => r.getAttribute('data-proposal-id') === PROPOSAL_B);
    const rowA = rows.find((r) => r.getAttribute('data-proposal-id') === PROPOSAL_A);
    expect(rowA).toBeTruthy();
    expect(rowB).toBeTruthy();
    const headerA = rowA!.querySelector(
      '[data-testid="participant-pending-proposal-row-header"]',
    ) as HTMLElement;
    const headerB = rowB!.querySelector(
      '[data-testid="participant-pending-proposal-row-header"]',
    ) as HTMLElement;
    act(() => {
      fireEvent.click(headerA);
    });
    expect(rowA!.getAttribute('data-expanded')).toBe('true');
    expect(rowB!.getAttribute('data-expanded')).toBe('false');
    act(() => {
      fireEvent.click(headerB);
    });
    expect(rowA!.getAttribute('data-expanded')).toBe('false');
    expect(rowB!.getAttribute('data-expanded')).toBe('true');
  });

  it('(n) header button aria-controls matches the body region id', () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    renderPane();
    const header = screen.getByTestId('participant-pending-proposal-row-header');
    act(() => {
      fireEvent.click(header);
    });
    const body = screen.getByTestId('participant-pending-proposal-row-body');
    expect(header.getAttribute('aria-controls')).toBe(body.getAttribute('id'));
  });

  it('(o) two proposals of distinct sub-kinds → expanding each shows one chip with the expected facet name', () => {
    // PROPOSAL_A is classify-node → facet="classification";
    // PROPOSAL_B is set-node-substance → facet="substance".
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    useWsStore.getState().applyEvent(proposalEvent(2, PROPOSAL_B, 'set-node-substance', NODE_Y));
    renderPane();
    const rows = screen.getAllByTestId('participant-pending-proposal-row');
    const rowA = rows.find((r) => r.getAttribute('data-proposal-id') === PROPOSAL_A)!;
    const rowB = rows.find((r) => r.getAttribute('data-proposal-id') === PROPOSAL_B)!;
    const headerA = rowA.querySelector(
      '[data-testid="participant-pending-proposal-row-header"]',
    ) as HTMLElement;
    const headerB = rowB.querySelector(
      '[data-testid="participant-pending-proposal-row-header"]',
    ) as HTMLElement;
    act(() => {
      fireEvent.click(headerA);
    });
    let chipsA = rowA.querySelectorAll('[data-testid="participant-pending-proposal-row-facet"]');
    expect(chipsA).toHaveLength(1);
    expect(chipsA[0]?.getAttribute('data-facet-name')).toBe('classification');
    expect(chipsA[0]?.getAttribute('data-facet-status')).toBe('proposed');
    // Single-open accordion: click B, A collapses, B opens.
    act(() => {
      fireEvent.click(headerB);
    });
    const chipsB = rowB.querySelectorAll('[data-testid="participant-pending-proposal-row-facet"]');
    expect(chipsB).toHaveLength(1);
    expect(chipsB[0]?.getAttribute('data-facet-name')).toBe('substance');
    // A is collapsed — no chips inside it.
    chipsA = rowA.querySelectorAll('[data-testid="participant-pending-proposal-row-facet"]');
    expect(chipsA).toHaveLength(0);
  });

  it('(p) server precedence: applyProposalStatus push updates the expanded row chip data-facet-status', () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    renderPane();
    const header = screen.getByTestId('participant-pending-proposal-row-header');
    act(() => {
      fireEvent.click(header);
    });
    // Pre-push: default status is 'proposed' (no votes, no server frame).
    expect(
      screen
        .getByTestId('participant-pending-proposal-row-facet')
        .getAttribute('data-facet-status'),
    ).toBe('proposed');
    // Push a server frame setting the classification facet to 'agreed'.
    act(() => {
      useWsStore.getState().applyProposalStatus({
        sessionId: SESSION_A,
        proposalId: PROPOSAL_A,
        sequence: 99,
        perFacetStatus: { classification: 'agreed' },
      });
    });
    expect(
      screen
        .getByTestId('participant-pending-proposal-row-facet')
        .getAttribute('data-facet-status'),
    ).toBe('agreed');
  });

  it('(q) header cells unaffected by the body content swap; body-summary <p> is gone; body region contract preserved', () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    renderPane();
    // Header cells remain (testids intact).
    expect(screen.getByTestId('participant-pending-proposal-row-kind')).toBeTruthy();
    expect(screen.getByTestId('participant-pending-proposal-row-summary')).toBeTruthy();
    expect(screen.getByTestId('participant-pending-proposal-row-author')).toBeTruthy();
    expect(screen.getByTestId('participant-pending-proposal-row-timestamp')).toBeTruthy();
    // Expand the row.
    act(() => {
      fireEvent.click(screen.getByTestId('participant-pending-proposal-row-header'));
    });
    // Body region with the predecessor's ARIA contract.
    const body = screen.getByTestId('participant-pending-proposal-row-body');
    expect(body.getAttribute('role')).toBe('region');
    expect(body.getAttribute('aria-label')).toBeTruthy();
    // The predecessor's `-body-summary` testid is GONE.
    expect(screen.queryByTestId('participant-pending-proposal-row-body-summary')).toBeNull();
    // The chip strip replaces it.
    expect(screen.getByTestId('participant-pending-proposal-row-facets')).toBeTruthy();
  });
});
