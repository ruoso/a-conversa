// Vitest cases for `<PendingProposalsPane>`.
//
// Refinement: tasks/refinements/participant-ui/part_proposal_list_view.md
//   (prior:    tasks/refinements/participant-ui/part_proposals_tab.md —
//    the predecessor's four cases are preserved with the source-of-
//    truth switch from `pendingProposals` to `events` baked into the
//    fixtures; five new row-rendering cases are appended.)

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  Event,
  WsEnvelopeUnion,
  WsMessagePayloadMap,
  WsMessageType,
} from '@a-conversa/shared-types';

import {
  I18nProvider,
  WsClientProvider,
  createI18nInstance,
  type I18nInstance,
  type SendFn,
  type WsClient,
  type WsClientStatus,
} from '@a-conversa/shell';

import { PendingProposalsPane } from './PendingProposalsPane';
import { useWsStore } from '../ws/wsStore';
import { useUiStore } from '../stores/uiStore';
import { resetVoteActionStore } from '../detail/useVoteAction';

const SESSION_A = '00000000-0000-4000-8000-0000000000aa';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const PROPOSAL_B = '00000000-0000-4000-8000-0000000000a2';
const PROPOSAL_D = '00000000-0000-4000-8000-0000000000a4';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const ACTOR_HUMAN = '11112222-3333-4444-5555-666677778888';
const ACTOR_SECOND = '99998888-7777-6666-5555-444433332211';
const COMMITTER = '00000000-0000-4000-8000-0000000000bb';
const ME = '00000000-0000-4000-8000-0000000000c0';
const OTHER = '00000000-0000-4000-8000-00000000001a';
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

interface Call {
  readonly type: WsMessageType;
  readonly payload: WsMessagePayloadMap[WsMessageType];
}

interface FakeClient {
  readonly client: WsClient;
  readonly calls: Call[];
}

function makeFakeClient(): FakeClient {
  const calls: Call[] = [];
  const send: SendFn = <T extends WsMessageType>(
    type: T,
    payload: WsMessagePayloadMap[T],
  ): Promise<WsEnvelopeUnion> => {
    calls.push({ type, payload });
    return new Promise<WsEnvelopeUnion>(() => undefined);
  };
  const client: WsClient = {
    status: (): WsClientStatus => 'open',
    connect: () => undefined,
    close: () => undefined,
    killWebSocket: () => undefined,
    send,
    trackSession: () => Promise.resolve(),
    untrackSession: () => Promise.resolve(),
    onEnvelope: () => () => undefined,
    url: '/api/ws',
  };
  return { client, calls };
}

beforeAll(async () => {
  i18n = await createI18nInstance('en-US');
});

beforeEach(() => {
  resetVoteActionStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
  useUiStore.getState().setExpandedProposalId(null);
});

function renderPane(
  currentParticipantId: string = ME,
  client: WsClient = makeFakeClient().client,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/sessions/${SESSION_A}`]}>
      <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
        <I18nProvider i18n={i18n}>
          <Routes>
            <Route
              path="/sessions/:id"
              element={
                <PendingProposalsPane
                  sessionId={SESSION_A}
                  currentParticipantId={currentParticipantId}
                  nowMsOverride={FIXED_NOW_MS}
                />
              }
            />
          </Routes>
        </I18nProvider>
      </WsClientProvider>
    </MemoryRouter>,
  );
}

function decomposeProposalEvent(seq: number, envelopeId: string, parentNodeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION_A,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR_HUMAN,
    payload: {
      proposal: {
        kind: 'decompose',
        parent_node_id: parentNodeId,
        components: [
          {
            wording: 'first',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-00000000f001',
          },
          {
            wording: 'second',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-00000000f002',
          },
        ],
      },
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function voteFacetArm(
  seq: number,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'wording' | 'classification' | 'substance' | 'shape',
  participantId: string,
  choice: 'agree' | 'dispute',
): Event {
  return {
    id: `00000000-0000-4000-8000-${(0xc00 + seq).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_A,
    sequence: seq,
    kind: 'vote',
    actor: participantId,
    payload: {
      target: 'facet',
      entity_kind: entityKind,
      entity_id: entityId,
      facet,
      participant: participantId,
      choice,
      voted_at: '2026-05-25T00:00:00.000Z',
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function voteProposalArm(
  seq: number,
  proposalId: string,
  participantId: string,
  choice: 'agree' | 'dispute',
): Event {
  return {
    id: `00000000-0000-4000-8000-${(0xd00 + seq).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_A,
    sequence: seq,
    kind: 'vote',
    actor: participantId,
    payload: {
      target: 'proposal',
      proposal_id: proposalId,
      participant: participantId,
      choice,
      voted_at: '2026-05-25T00:00:00.000Z',
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
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

  it('(p) broadcast precedence: applyProposalStatus push updates the expanded row chip data-facet-status', () => {
    // Per `part_migrate_to_pending_proposal_facet_status` D2 — the
    // pane's `facetStatusIndex` merges the broadcast-derived per-entity
    // cell map over the events-derived mirror. A `proposal-status`
    // envelope carrying explicit `entityKind` + `entityId` flips the
    // chip's data-facet-status without touching the event log.
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    renderPane();
    const header = screen.getByTestId('participant-pending-proposal-row-header');
    act(() => {
      fireEvent.click(header);
    });
    expect(
      screen
        .getByTestId('participant-pending-proposal-row-facet')
        .getAttribute('data-facet-status'),
    ).toBe('proposed');
    act(() => {
      useWsStore.getState().applyProposalStatus({
        sessionId: SESSION_A,
        proposalId: PROPOSAL_A,
        sequence: 99,
        perFacetStatus: { classification: 'agreed' },
        entityKind: 'node',
        entityId: NODE_X,
      });
    });
    expect(
      screen
        .getByTestId('participant-pending-proposal-row-facet')
        .getAttribute('data-facet-status'),
    ).toBe('agreed');
  });

  it('(p2) broadcast wins per cell when both events-derived and broadcast carry the same facet', () => {
    // Seed a `proposal` event that contributes a `'proposed'` cell to
    // the events-derived mirror, then push a `proposal-status` envelope
    // carrying `'committed'` for the same `(entityKind, entityId, facet)`.
    // The merged index returns `'committed'` (broadcast wins per D2).
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    act(() => {
      useWsStore.getState().applyProposalStatus({
        sessionId: SESSION_A,
        proposalId: PROPOSAL_A,
        sequence: 99,
        perFacetStatus: { classification: 'committed' },
        entityKind: 'node',
        entityId: NODE_X,
      });
    });
    renderPane();
    const header = screen.getByTestId('participant-pending-proposal-row-header');
    act(() => {
      fireEvent.click(header);
    });
    expect(
      screen
        .getByTestId('participant-pending-proposal-row-facet')
        .getAttribute('data-facet-status'),
    ).toBe('committed');
  });

  it('(p3) multi-component decompose: per-component `proposal-status` envelopes populate distinct cells (no last-write-wins data loss)', () => {
    // Two-component decompose; the server emits one `proposal-status`
    // envelope per component carrying the same proposalId + sequence
    // but differing entityId. Pre-migration the legacy
    // `pendingProposals[proposalId]` slot last-write-wins lost the
    // first component's status; post-migration both cells coexist in
    // `pendingProposalFacetStatus`. The pane's chip is `'proposal'`
    // (structural sub-kind), but the merged index carries both
    // component cells — the regression cover is at the store layer.
    const COMPONENT_1 = '00000000-0000-4000-8000-00000000f001';
    const COMPONENT_2 = '00000000-0000-4000-8000-00000000f002';
    useWsStore.getState().applyEvent(decomposeProposalEvent(1, PROPOSAL_A, NODE_X));
    act(() => {
      useWsStore.getState().applyProposalStatus({
        sessionId: SESSION_A,
        proposalId: PROPOSAL_A,
        sequence: 99,
        perFacetStatus: { classification: 'proposed' },
        entityKind: 'node',
        entityId: COMPONENT_1,
      });
      useWsStore.getState().applyProposalStatus({
        sessionId: SESSION_A,
        proposalId: PROPOSAL_A,
        sequence: 99,
        perFacetStatus: { classification: 'proposed' },
        entityKind: 'node',
        entityId: COMPONENT_2,
      });
    });
    renderPane();
    // Both cells survive — neither is overwritten by the other.
    const facetStatus = useWsStore.getState().sessionState[SESSION_A]?.pendingProposalFacetStatus;
    expect(facetStatus?.get(`node:${COMPONENT_1}:classification`)).toBe('proposed');
    expect(facetStatus?.get(`node:${COMPONENT_2}:classification`)).toBe('proposed');
  });

  it('(r) self-filter at the pane integration layer: seed votes from ME + OTHER on the wording facet → expanded chip surfaces exactly one indicator for OTHER', () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    useWsStore
      .getState()
      .applyEvent(voteFacetArm(2, 'node', NODE_X, 'classification', ME, 'agree'));
    useWsStore
      .getState()
      .applyEvent(voteFacetArm(3, 'node', NODE_X, 'classification', OTHER, 'dispute'));
    renderPane();
    const header = screen.getByTestId('participant-pending-proposal-row-header');
    act(() => {
      fireEvent.click(header);
    });
    const row = screen.getByTestId('participant-pending-proposal-row-facet-vote-indicator-row');
    const dots = row.querySelectorAll('[data-vote-indicator]');
    expect(dots).toHaveLength(1);
    expect(dots[0]?.getAttribute('data-participant-id')).toBe(OTHER);
    expect(dots[0]?.getAttribute('data-choice')).toBe('dispute');
  });

  it('(s) structural sub-kind: seed a decompose proposal + one OTHER proposal-arm vote → expanded synthetic "proposal" chip surfaces one indicator', () => {
    useWsStore.getState().applyEvent(decomposeProposalEvent(1, PROPOSAL_D, NODE_X));
    useWsStore.getState().applyEvent(voteProposalArm(2, PROPOSAL_D, OTHER, 'agree'));
    renderPane();
    const header = screen.getByTestId('participant-pending-proposal-row-header');
    act(() => {
      fireEvent.click(header);
    });
    const chip = screen.getByTestId('participant-pending-proposal-row-facet');
    expect(chip.getAttribute('data-facet-name')).toBe('proposal');
    const row = chip.querySelector(
      '[data-testid="participant-pending-proposal-row-facet-vote-indicator-row"]',
    );
    expect(row).toBeTruthy();
    const dots = row!.querySelectorAll('[data-vote-indicator]');
    expect(dots).toHaveLength(1);
    expect(dots[0]?.getAttribute('data-participant-id')).toBe(OTHER);
    expect(dots[0]?.getAttribute('data-choice')).toBe('agree');
  });

  it("(t) ownFacetVotes threading: chip at proposed renders both vote buttons; after seeding the participant's own agree vote, the agree button hides but the dispute button persists as a change-vote affordance", () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    renderPane();
    act(() => {
      fireEvent.click(screen.getByTestId('participant-pending-proposal-row-header'));
    });
    expect(
      screen.getByTestId('participant-pending-proposal-row-facet-vote-button-agree'),
    ).toBeTruthy();
    expect(
      screen.getByTestId('participant-pending-proposal-row-facet-vote-button-dispute'),
    ).toBeTruthy();
    act(() => {
      useWsStore
        .getState()
        .applyEvent(voteFacetArm(2, 'node', NODE_X, 'classification', ME, 'agree'));
    });
    expect(
      screen.queryByTestId('participant-pending-proposal-row-facet-vote-button-agree'),
    ).toBeNull();
    const disputeButton = screen.getByTestId(
      'participant-pending-proposal-row-facet-vote-button-dispute',
    );
    expect(disputeButton.getAttribute('data-vote-mode')).toBe('change');
  });

  it('(u) clicking the agree button on the expanded chip dispatches the facet-arm vote envelope', () => {
    useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_A, 'classify-node', NODE_X));
    const fake = makeFakeClient();
    renderPane(ME, fake.client);
    act(() => {
      fireEvent.click(screen.getByTestId('participant-pending-proposal-row-header'));
    });
    const agree = screen.getByTestId('participant-pending-proposal-row-facet-vote-button-agree');
    act(() => {
      fireEvent.click(agree);
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('vote');
    expect(fake.calls[0]?.payload).toEqual({
      sessionId: SESSION_A,
      expectedSequence: 1,
      target: 'facet',
      entity_kind: 'node',
      entity_id: NODE_X,
      facet: 'classification',
      choice: 'agree',
    });
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
