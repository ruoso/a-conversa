// Tests for `<ParticipantVoteButtons>` — the participant detail
// panel's per-facet row block. Per
// `tasks/refinements/per-facet-refactor/pf_part_detail_panel_three_facet_rows.md`
// + [ADR 0030 §10](../../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)
// nodes always render three rows (wording / classification /
// substance); edges always render two (shape / substance). Each row's
// content branches on the row's derived `FacetStatus`. The pre-
// refactor "render-only-if-pending-proposal" shape is gone.
//
// Per ADR 0022 these are committed Vitest cases pinning:
//
//   1. **Always-on three rows for nodes.** No events at all → three
//      rows for `wording` / `classification` / `substance`, each in
//      the `awaiting-proposal` empty-state branch.
//   2. **Always-on two rows for edges.** No events → two rows for
//      `shape` / `substance`.
//   3. **Per-status row content.**
//      - `proposed` → candidate value + agree / dispute buttons.
//      - `disputed` → candidate value + agree / dispute buttons.
//      - `withdrawn` → candidate value + agree / dispute buttons.
//      - `agreed` / `committed` → candidate value + (placeholder)
//        withdraw button.
//      - `awaiting-proposal` → empty-state body, no buttons.
//      - `meta-disagreement` → no vote buttons.
//   4. **Click → fires the wire envelope.** Clicking the agree button
//      on a `proposed`-row sends exactly one `vote` envelope with
//      `choice: 'agree'` for the row's `proposalId`.
//   5. **Structural sub-kinds surface a synthetic `'proposal'` row.**
//      In addition to the always-on facet rows, decompose /
//      interpretive-split / axiom-mark / annotate proposals add one
//      `data-facet-name="proposal"` row carrying the structural
//      proposal id.
//   6. **`derivePendingFacetProposals`** still resolves the
//      proposalId per facet (regression coverage for the helper).

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import { ParticipantVoteButtons, derivePendingFacetProposals } from './ParticipantVoteButtons';
import { resetVoteActionStore } from './useVoteAction';
import { resetWithdrawAgreementActionStore } from './useWithdrawAgreementAction';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type {
  Event,
  WsEnvelopeUnion,
  WsMessagePayloadMap,
  WsMessageType,
} from '@a-conversa/shared-types';
import { computeFacetStatuses, createI18nInstance, type FacetStatusIndex } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const NODE_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NODE_COMPONENT_1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NODE_COMPONENT_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EDGE_E_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PROPOSAL_CLASSIFY_ID = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_REWORD_ID = '33333333-3333-4333-8333-333333333333';
const PROPOSAL_DECOMPOSE_ID = '44444444-4444-4444-8444-444444444444';
const PROPOSAL_INTERPRETIVE_SPLIT_ID = '55555555-5555-4555-8555-555555555555';
const PROPOSAL_AXIOM_MARK_ID = '66666666-6666-4666-8666-666666666666';
const PROPOSAL_ANNOTATE_ID = '77777777-7777-4777-8777-777777777777';
const ACTOR_ID = '00000000-0000-4000-8000-0000000000aa';
const PARTICIPANT_BEN = '00000000-0000-4000-8000-0000000000b1';
const PARTICIPANT_MARIA = '00000000-0000-4000-8000-0000000000b2';

const EMPTY_FACET_STATUS_INDEX: FacetStatusIndex = {
  nodes: new Map(),
  edges: new Map(),
  annotations: new Map(),
};

beforeAll(async () => {
  await createI18nInstance('en-US');
});

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
    // Never resolves — keep the round-trip in flight for click-side
    // assertions; tests that need resolution are in
    // `useVoteAction.test.tsx`.
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

function Wrapper({ children, client }: { children: ReactNode; client: WsClient }): ReactElement {
  return (
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}`]}>
      <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
        <Routes>
          <Route path="/sessions/:id" element={children} />
        </Routes>
      </WsClientProvider>
    </MemoryRouter>
  );
}

function nodeCreatedEvent(seq: number, wording: string): Event {
  return {
    id: `00000000-0000-4000-8000-${seq.toString().padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: seq,
    kind: 'node-created',
    actor: ACTOR_ID,
    createdAt: '2026-05-17T00:00:00.000Z',
    payload: {
      node_id: NODE_A_ID,
      wording,
      created_at: '2026-05-17T00:00:00.000Z',
    },
  } as unknown as Event;
}

function edgeCreatedEvent(seq: number): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x600 + seq).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: seq,
    kind: 'edge-created',
    actor: ACTOR_ID,
    createdAt: '2026-05-17T00:00:00.000Z',
    payload: {
      edge_id: EDGE_E_ID,
      source_node_id: NODE_A_ID,
      target_node_id: NODE_COMPONENT_1,
      role: 'supports',
      created_at: '2026-05-17T00:00:00.000Z',
    },
  } as unknown as Event;
}

function classifyNodeProposalEvent(seq: number): Event {
  return {
    id: PROPOSAL_CLASSIFY_ID,
    sessionId: SESSION_ID,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR_ID,
    createdAt: '2026-05-17T00:00:00.000Z',
    payload: {
      proposal: {
        kind: 'classify-node',
        node_id: NODE_A_ID,
        classification: 'claim',
      },
    },
  } as unknown as Event;
}

function editWordingProposalEvent(seq: number): Event {
  return {
    id: PROPOSAL_REWORD_ID,
    sessionId: SESSION_ID,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR_ID,
    createdAt: '2026-05-17T00:00:01.000Z',
    payload: {
      proposal: {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: NODE_A_ID,
        new_wording: 'Reworded.',
      },
    },
  } as unknown as Event;
}

function decomposeProposalEvent(seq: number): Event {
  return {
    id: PROPOSAL_DECOMPOSE_ID,
    sessionId: SESSION_ID,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR_ID,
    createdAt: '2026-05-17T00:00:02.000Z',
    payload: {
      proposal: {
        kind: 'decompose',
        parent_node_id: NODE_A_ID,
        components: [
          { wording: 'first', classification: 'fact', node_id: NODE_COMPONENT_1 },
          { wording: 'second', classification: 'fact', node_id: NODE_COMPONENT_2 },
        ],
      },
    },
  } as unknown as Event;
}

function interpretiveSplitProposalEvent(seq: number): Event {
  return {
    id: PROPOSAL_INTERPRETIVE_SPLIT_ID,
    sessionId: SESSION_ID,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR_ID,
    createdAt: '2026-05-17T00:00:03.000Z',
    payload: {
      proposal: {
        kind: 'interpretive-split',
        parent_node_id: NODE_A_ID,
        readings: [
          { wording: 'reading-1', classification: 'value', node_id: NODE_COMPONENT_1 },
          { wording: 'reading-2', classification: 'value', node_id: NODE_COMPONENT_2 },
        ],
      },
    },
  } as unknown as Event;
}

function axiomMarkProposalEvent(seq: number, declaredParticipant: string): Event {
  return {
    id: PROPOSAL_AXIOM_MARK_ID,
    sessionId: SESSION_ID,
    sequence: seq,
    kind: 'proposal',
    actor: declaredParticipant,
    createdAt: '2026-05-17T00:00:04.000Z',
    payload: {
      proposal: {
        kind: 'axiom-mark',
        node_id: NODE_A_ID,
        participant: declaredParticipant,
      },
    },
  } as unknown as Event;
}

function annotateNodeProposalEvent(seq: number): Event {
  return {
    id: PROPOSAL_ANNOTATE_ID,
    sessionId: SESSION_ID,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR_ID,
    createdAt: '2026-05-17T00:00:05.000Z',
    payload: {
      proposal: {
        kind: 'annotate',
        target_kind: 'node',
        target_id: NODE_A_ID,
        annotation_kind: 'note',
        content: 'a clarifying note',
      },
    },
  } as unknown as Event;
}

function annotateEdgeProposalEvent(seq: number): Event {
  return {
    id: PROPOSAL_ANNOTATE_ID,
    sessionId: SESSION_ID,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR_ID,
    createdAt: '2026-05-17T00:00:06.000Z',
    payload: {
      proposal: {
        kind: 'annotate',
        target_kind: 'edge',
        target_id: EDGE_E_ID,
        annotation_kind: 'note',
        content: 'a clarifying edge note',
      },
    },
  } as unknown as Event;
}

function joinedEvent(seq: number, userId: string): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x500 + seq).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: seq,
    kind: 'participant-joined',
    actor: userId,
    createdAt: '2026-05-17T00:00:00.000Z',
    payload: {
      user_id: userId,
      role: 'debater-A',
      screen_name: 'P',
      joined_at: '2026-05-17T00:00:00.000Z',
    },
  } as unknown as Event;
}

function voteEvent(
  seq: number,
  proposalId: string,
  voter: string,
  arm: 'agree' | 'dispute',
): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x700 + seq).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: seq,
    kind: 'vote',
    actor: voter,
    createdAt: '2026-05-17T00:00:00.000Z',
    payload: {
      target: 'proposal',
      proposal_id: proposalId,
      participant: voter,
      choice: arm,
      voted_at: '2026-05-17T00:00:00.000Z',
    },
  } as unknown as Event;
}

function commitEvent(proposalId: string, seq: number): Event {
  return {
    id: `99999999-9999-4999-8999-${seq.toString().padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: seq,
    kind: 'commit',
    actor: ACTOR_ID,
    createdAt: '2026-05-17T00:01:00.000Z',
    payload: {
      target: 'proposal',
      proposal_id: proposalId,
      committed_at: '2026-05-17T00:01:00.000Z',
    },
  } as unknown as Event;
}

beforeEach(() => {
  useWsStore.getState().reset();
  resetVoteActionStore();
  resetWithdrawAgreementActionStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('derivePendingFacetProposals (pure helper)', () => {
  it('returns an empty map when no proposal targets the entity', () => {
    const out = derivePendingFacetProposals([], 'node', NODE_A_ID);
    expect(out.size).toBe(0);
  });

  it('maps facet → proposalId for facet-targeting proposals', () => {
    const events: Event[] = [classifyNodeProposalEvent(1), editWordingProposalEvent(2)];
    const out = derivePendingFacetProposals(events, 'node', NODE_A_ID);
    expect(out.size).toBe(2);
    expect(out.get('classification')).toBe(PROPOSAL_CLASSIFY_ID);
    expect(out.get('wording')).toBe(PROPOSAL_REWORD_ID);
  });

  it('strips committed proposals from the map', () => {
    const events: Event[] = [
      classifyNodeProposalEvent(1),
      editWordingProposalEvent(2),
      commitEvent(PROPOSAL_CLASSIFY_ID, 3),
    ];
    const out = derivePendingFacetProposals(events, 'node', NODE_A_ID);
    expect(out.size).toBe(1);
    expect(out.has('classification')).toBe(false);
    expect(out.get('wording')).toBe(PROPOSAL_REWORD_ID);
  });

  it('skips proposals targeting a different entity', () => {
    const events: Event[] = [classifyNodeProposalEvent(1)];
    const out = derivePendingFacetProposals(events, 'node', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(out.size).toBe(0);
  });

  it('skips proposals targeting a different entity kind', () => {
    const events: Event[] = [classifyNodeProposalEvent(1)];
    const out = derivePendingFacetProposals(events, 'edge', NODE_A_ID);
    expect(out.size).toBe(0);
  });
});

// --------------------------------------------------------------------
// Always-on three-row contract for nodes / two-row for edges
// --------------------------------------------------------------------

describe('<ParticipantVoteButtons> — always-on row block', () => {
  it('renders three rows for a node (wording / classification / substance) even with no events', () => {
    const fake = makeFakeClient();
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={[]}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={EMPTY_FACET_STATUS_INDEX}
        />
      </Wrapper>,
    );
    const rows = screen.getAllByTestId('participant-detail-panel-facet-row');
    expect(rows.length).toBe(3);
    const facetNames = rows.map((r) => r.getAttribute('data-facet-name'));
    expect(facetNames).toEqual(['wording', 'classification', 'substance']);
    // Every row is in the awaiting-proposal empty-state branch (no
    // candidate value yet).
    for (const row of rows) {
      expect(row.getAttribute('data-facet-status')).toBe('awaiting-proposal');
      expect(within(row).queryByTestId('participant-vote-button-agree')).toBeNull();
      expect(
        within(row).getByTestId('participant-detail-panel-facet-row-awaiting-proposal'),
      ).toBeDefined();
    }
  });

  it('renders two rows for an edge (shape / substance) even with no events', () => {
    const fake = makeFakeClient();
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={[]}
          entityKind="edge"
          entityId={EDGE_E_ID}
          facetStatusIndex={EMPTY_FACET_STATUS_INDEX}
        />
      </Wrapper>,
    );
    const rows = screen.getAllByTestId('participant-detail-panel-facet-row');
    expect(rows.length).toBe(2);
    const facetNames = rows.map((r) => r.getAttribute('data-facet-name'));
    expect(facetNames).toEqual(['shape', 'substance']);
  });
});

// --------------------------------------------------------------------
// Per-status row content
// --------------------------------------------------------------------

describe('<ParticipantVoteButtons> — per-status row content', () => {
  it("a freshly-captured node's wording row is in 'proposed' with agree+dispute buttons; classification / substance are 'awaiting-proposal'", () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      joinedEvent(2, PARTICIPANT_MARIA),
      nodeCreatedEvent(3, 'A first claim'),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const rows = screen.getAllByTestId('participant-detail-panel-facet-row');
    expect(rows.length).toBe(3);
    const wordingRow = rows.find((r) => r.getAttribute('data-facet-name') === 'wording');
    if (!wordingRow) throw new Error('wording row missing');
    // The wording row should NOT be `awaiting-proposal` — `node-created`
    // populated the candidate inline (per ADR 0030 §4).
    expect(wordingRow.getAttribute('data-facet-status')).not.toBe('awaiting-proposal');
    // Classification + substance are awaiting-proposal (no candidate
    // yet — neither a classify-node nor a set-node-substance proposal
    // has landed).
    const classifyRow = rows.find((r) => r.getAttribute('data-facet-name') === 'classification');
    const substanceRow = rows.find((r) => r.getAttribute('data-facet-name') === 'substance');
    if (!classifyRow || !substanceRow) throw new Error('classify/substance row missing');
    expect(classifyRow.getAttribute('data-facet-status')).toBe('awaiting-proposal');
    expect(substanceRow.getAttribute('data-facet-status')).toBe('awaiting-proposal');
  });

  it('a classify-node proposal flips classification to `proposed` and renders agree+dispute buttons + candidate value', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      joinedEvent(2, PARTICIPANT_MARIA),
      nodeCreatedEvent(3, 'A first claim'),
      classifyNodeProposalEvent(4),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    expect(classifyRow.getAttribute('data-facet-status')).toBe('proposed');
    expect(classifyRow.getAttribute('data-proposal-id')).toBe(PROPOSAL_CLASSIFY_ID);
    expect(within(classifyRow).getByTestId('participant-vote-button-agree')).toBeDefined();
    expect(within(classifyRow).getByTestId('participant-vote-button-dispute')).toBeDefined();
    // The candidate-value display surfaces the classification.
    expect(
      within(classifyRow).getByTestId('participant-detail-panel-facet-row-candidate').textContent,
    ).toBe('claim');
  });

  it('a committed classification flips the row to `committed` with the wired withdraw button (no agree/dispute)', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      joinedEvent(2, PARTICIPANT_MARIA),
      nodeCreatedEvent(3, 'A first claim'),
      classifyNodeProposalEvent(4),
      voteEvent(5, PROPOSAL_CLASSIFY_ID, PARTICIPANT_BEN, 'agree'),
      voteEvent(6, PROPOSAL_CLASSIFY_ID, PARTICIPANT_MARIA, 'agree'),
      commitEvent(PROPOSAL_CLASSIFY_ID, 7),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    expect(classifyRow.getAttribute('data-facet-status')).toBe('committed');
    expect(within(classifyRow).queryByTestId('participant-vote-button-agree')).toBeNull();
    expect(within(classifyRow).queryByTestId('participant-vote-button-dispute')).toBeNull();
    // Wired withdraw button — fires `withdraw-agreement` via
    // `useWithdrawAgreementAction` (per
    // `pf_part_withdraw_agreement_action`). The render-side contract
    // here just asserts the button is present; the click-side
    // contract is covered by the "wired withdraw" describe-block
    // below.
    expect(within(classifyRow).getByTestId('participant-vote-button-withdraw')).toBeDefined();
  });

  // Per `pf_part_facet_name_widen_shape`: the shape row's status now
  // flows through the projection index like the other three facets —
  // the prior synthetic `'committed'`-when-inline-carriage short-
  // circuit is gone. A freshly-drawn edge surfaces the shape row in
  // `proposed` with agree+dispute buttons.
  it("a freshly-drawn edge's shape row reads `proposed` off the projection and renders agree+dispute (no synthetic committed)", () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      joinedEvent(2, PARTICIPANT_MARIA),
      edgeCreatedEvent(3),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="edge"
          entityId={EDGE_E_ID}
          facetStatusIndex={facetStatusIndex}
          currentParticipantId={PARTICIPANT_BEN}
        />
      </Wrapper>,
    );
    const shapeRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'shape');
    if (!shapeRow) throw new Error('shape row missing');
    expect(shapeRow.getAttribute('data-facet-status')).toBe('proposed');
    // Agree + dispute surface — the regression class the widening
    // closes (the predecessor's synthetic `'committed'` hid these).
    expect(within(shapeRow).getByTestId('participant-vote-button-agree')).toBeDefined();
    expect(within(shapeRow).getByTestId('participant-vote-button-dispute')).toBeDefined();
  });

  it("after the current participant agrees on the edge's shape facet, the shape row hides agree/dispute and surfaces a 'you voted' indicator", () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      joinedEvent(2, PARTICIPANT_MARIA),
      edgeCreatedEvent(3),
      // Facet-keyed vote against (edge, shape) by Ben.
      {
        id: '00000000-0000-4000-8000-000000000801',
        sessionId: SESSION_ID,
        sequence: 4,
        kind: 'vote',
        actor: PARTICIPANT_BEN,
        createdAt: '2026-05-17T00:00:00.000Z',
        payload: {
          target: 'facet' as const,
          entity_kind: 'edge' as const,
          entity_id: EDGE_E_ID,
          facet: 'shape' as const,
          participant: PARTICIPANT_BEN,
          choice: 'agree' as const,
          voted_at: '2026-05-17T00:00:00.000Z',
        },
      } as unknown as Event,
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="edge"
          entityId={EDGE_E_ID}
          facetStatusIndex={facetStatusIndex}
          currentParticipantId={PARTICIPANT_BEN}
        />
      </Wrapper>,
    );
    const shapeRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'shape');
    if (!shapeRow) throw new Error('shape row missing');
    // Status stays `proposed` (Maria hasn't voted yet), but buttons
    // are gone for Ben — he already voted. The own-vote indicator
    // surfaces with the agree arm.
    expect(shapeRow.getAttribute('data-facet-status')).toBe('proposed');
    // Per `part_change_vote_pre_commit`: the chosen-side (agree) is
    // hidden; the opposite-side (dispute) stays visible as the
    // change-vote affordance. The "You voted X" indicator coexists.
    expect(within(shapeRow).queryByTestId('participant-vote-button-agree')).toBeNull();
    expect(within(shapeRow).getByTestId('participant-vote-button-dispute')).toBeDefined();
    const indicator = within(shapeRow).getByTestId('participant-detail-panel-facet-row-own-vote');
    expect(indicator.getAttribute('data-vote-choice')).toBe('agree');
  });

  it('a disputed classification still shows agree+dispute (the dispute can flip back)', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      joinedEvent(2, PARTICIPANT_MARIA),
      nodeCreatedEvent(3, 'A first claim'),
      classifyNodeProposalEvent(4),
      voteEvent(5, PROPOSAL_CLASSIFY_ID, PARTICIPANT_BEN, 'dispute'),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    expect(classifyRow.getAttribute('data-facet-status')).toBe('disputed');
    expect(within(classifyRow).getByTestId('participant-vote-button-agree')).toBeDefined();
    expect(within(classifyRow).getByTestId('participant-vote-button-dispute')).toBeDefined();
  });
});

// --------------------------------------------------------------------
// Vote click → wire envelope
// --------------------------------------------------------------------

describe('<ParticipantVoteButtons> — own-vote hides the chosen-side button (pre-commit)', () => {
  // Pre-`part_change_vote_pre_commit`: the agree/dispute buttons fully
  // hid once the participant voted. After that leaf the chosen-side
  // button hides but the opposite-side (change-vote) button stays
  // visible — the participant can flip their vote until the moderator
  // commits. The "You voted X" indicator coexists with the change-vote
  // button.

  it('after the current participant votes agree, the chosen-side (agree) button hides but the dispute change-vote button stays visible alongside a "you voted" indicator', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      joinedEvent(2, PARTICIPANT_MARIA),
      nodeCreatedEvent(3, 'A first claim'),
      classifyNodeProposalEvent(4),
      voteEvent(5, PROPOSAL_CLASSIFY_ID, PARTICIPANT_BEN, 'agree'),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
          currentParticipantId={PARTICIPANT_BEN}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    // Status stays `proposed` (Maria hasn't voted yet), but the
    // buttons are gone for Ben — he already voted.
    expect(classifyRow.getAttribute('data-facet-status')).toBe('proposed');
    // Chosen-side (agree) is hidden; the opposite-side change-vote
    // button stays visible per `part_change_vote_pre_commit`.
    expect(within(classifyRow).queryByTestId('participant-vote-button-agree')).toBeNull();
    expect(within(classifyRow).getByTestId('participant-vote-button-dispute')).toBeDefined();
    const indicator = within(classifyRow).getByTestId(
      'participant-detail-panel-facet-row-own-vote',
    );
    expect(indicator.getAttribute('data-vote-choice')).toBe('agree');
  });

  it('after the current participant votes dispute, the chosen-side (dispute) hides but the agree change-vote button stays; the indicator shows dispute', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      joinedEvent(2, PARTICIPANT_MARIA),
      nodeCreatedEvent(3, 'A first claim'),
      classifyNodeProposalEvent(4),
      voteEvent(5, PROPOSAL_CLASSIFY_ID, PARTICIPANT_BEN, 'dispute'),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
          currentParticipantId={PARTICIPANT_BEN}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    // Chosen-side (dispute) hidden; opposite-side (agree) stays visible
    // per `part_change_vote_pre_commit`.
    expect(within(classifyRow).queryByTestId('participant-vote-button-dispute')).toBeNull();
    expect(within(classifyRow).getByTestId('participant-vote-button-agree')).toBeDefined();
    const indicator = within(classifyRow).getByTestId(
      'participant-detail-panel-facet-row-own-vote',
    );
    expect(indicator.getAttribute('data-vote-choice')).toBe('dispute');
  });

  it("ANOTHER participant's vote does NOT hide the current participant's buttons", () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      joinedEvent(2, PARTICIPANT_MARIA),
      nodeCreatedEvent(3, 'A first claim'),
      classifyNodeProposalEvent(4),
      // Maria voted, but Ben (the current participant) hasn't.
      voteEvent(5, PROPOSAL_CLASSIFY_ID, PARTICIPANT_MARIA, 'agree'),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
          currentParticipantId={PARTICIPANT_BEN}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    expect(within(classifyRow).getByTestId('participant-vote-button-agree')).toBeDefined();
    expect(within(classifyRow).getByTestId('participant-vote-button-dispute')).toBeDefined();
    expect(
      within(classifyRow).queryByTestId('participant-detail-panel-facet-row-own-vote'),
    ).toBeNull();
  });

  it('a NEW candidate landing on the same facet re-opens the buttons (per ADR 0030 §7 supersession-clears)', () => {
    const fake = makeFakeClient();
    const NEW_CLASSIFY_ID = '22222222-2222-4222-8222-22222222ffff';
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      joinedEvent(2, PARTICIPANT_MARIA),
      nodeCreatedEvent(3, 'A first claim'),
      classifyNodeProposalEvent(4),
      voteEvent(5, PROPOSAL_CLASSIFY_ID, PARTICIPANT_BEN, 'agree'),
      // A new classification candidate lands — Ben's prior vote is
      // moot; the buttons must re-appear for the new candidate.
      {
        id: NEW_CLASSIFY_ID,
        sessionId: SESSION_ID,
        sequence: 6,
        kind: 'proposal',
        actor: ACTOR_ID,
        createdAt: '2026-05-17T00:00:30.000Z',
        payload: {
          proposal: {
            kind: 'classify-node',
            node_id: NODE_A_ID,
            classification: 'value',
          },
        },
      } as unknown as Event,
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
          currentParticipantId={PARTICIPANT_BEN}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    expect(within(classifyRow).getByTestId('participant-vote-button-agree')).toBeDefined();
    expect(within(classifyRow).getByTestId('participant-vote-button-dispute')).toBeDefined();
    expect(
      within(classifyRow).queryByTestId('participant-detail-panel-facet-row-own-vote'),
    ).toBeNull();
  });

  it('after the current participant votes on the synthetic "proposal" row, the structural agree/dispute/withdraw buttons hide and the indicator appears', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      joinedEvent(2, PARTICIPANT_MARIA),
      nodeCreatedEvent(3, 'A first claim'),
      // Ben declares the axiom; Maria (the current participant) votes
      // agree. The declared participant (Ben) is suppressed from the
      // row by the axiom-mark special case, so the test runs from
      // Maria's seat where the synthetic row is visible.
      axiomMarkProposalEvent(4, PARTICIPANT_BEN),
      voteEvent(5, PROPOSAL_AXIOM_MARK_ID, PARTICIPANT_MARIA, 'agree'),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
          currentParticipantId={PARTICIPANT_MARIA}
        />
      </Wrapper>,
    );
    const proposalRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'proposal');
    if (!proposalRow) throw new Error('proposal row missing');
    expect(within(proposalRow).queryByTestId('participant-vote-button-agree')).toBeNull();
    expect(within(proposalRow).queryByTestId('participant-vote-button-dispute')).toBeNull();
    expect(within(proposalRow).queryByTestId('participant-vote-button-withdraw')).toBeNull();
    const indicator = within(proposalRow).getByTestId(
      'participant-detail-panel-facet-row-own-vote',
    );
    expect(indicator.getAttribute('data-vote-choice')).toBe('agree');
  });
});

describe('<ParticipantVoteButtons> — click fires the wire envelope', () => {
  it('clicking agree on a `proposed` row sends one vote envelope with choice="agree"', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      nodeCreatedEvent(2, 'A first claim'),
      classifyNodeProposalEvent(3),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    const agree = within(classifyRow).getByTestId('participant-vote-button-agree');
    act(() => {
      fireEvent.click(agree);
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('vote');
    // Per ADR 0030 §2 + `pf_part_vote_action_facet_keyed`: the
    // `classify-node` proposal is a facet-valued sub-kind; the wire
    // payload is `target: 'facet'` keyed by
    // `(entity_kind, entity_id, facet)`. The server resolves the
    // facet's current candidate proposal at handle-time.
    expect(fake.calls[0]?.payload).toEqual({
      sessionId: SESSION_ID,
      expectedSequence: 0,
      target: 'facet',
      entity_kind: 'node',
      entity_id: NODE_A_ID,
      facet: 'classification',
      choice: 'agree',
    });
  });

  it('clicking dispute on a `proposed` row sends choice="dispute"', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      nodeCreatedEvent(2, 'A first claim'),
      classifyNodeProposalEvent(3),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    act(() => {
      fireEvent.click(within(classifyRow).getByTestId('participant-vote-button-dispute'));
    });
    expect(fake.calls.length).toBe(1);
    expect((fake.calls[0]?.payload as { choice: string }).choice).toBe('dispute');
  });
});

describe('<ParticipantVoteButtons> — in-flight visual', () => {
  it('flips data-vote-state to "in-flight" on the clicked row after click', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      nodeCreatedEvent(2, 'A first claim'),
      classifyNodeProposalEvent(3),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    expect(classifyRow.getAttribute('data-vote-state')).toBe('enabled');
    act(() => {
      fireEvent.click(within(classifyRow).getByTestId('participant-vote-button-agree'));
    });
    const after = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!after) throw new Error('classification row missing post-click');
    expect(after.getAttribute('data-vote-state')).toBe('in-flight');
    const agreeBtn = within(after).getByTestId('participant-vote-button-agree');
    expect(agreeBtn.hasAttribute('disabled')).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Structural sub-kind support — `decompose`, `interpretive-split`,
// `axiom-mark`, `annotate` each surface a synthetic `'proposal'` facet
// row on the targeted entity IN ADDITION to the always-on facet rows.
// ---------------------------------------------------------------------

describe('<ParticipantVoteButtons> — structural sub-kinds surface a "proposal" row', () => {
  it('decompose proposal on the parent node renders one "proposal" row in addition to the 3 always-on facet rows', () => {
    const fake = makeFakeClient();
    const events: Event[] = [nodeCreatedEvent(1, 'parent'), decomposeProposalEvent(2)];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const rows = screen.getAllByTestId('participant-detail-panel-facet-row');
    expect(rows.length).toBe(4);
    const proposalRow = rows.find((r) => r.getAttribute('data-facet-name') === 'proposal');
    if (!proposalRow) throw new Error('proposal row missing');
    expect(proposalRow.getAttribute('data-proposal-id')).toBe(PROPOSAL_DECOMPOSE_ID);
    expect(within(proposalRow).getByTestId('participant-vote-button-agree')).toBeDefined();
    expect(within(proposalRow).getByTestId('participant-vote-button-dispute')).toBeDefined();
    expect(within(proposalRow).getByTestId('participant-vote-button-withdraw')).toBeDefined();
  });

  it('interpretive-split proposal on the parent node renders one "proposal" row', () => {
    const fake = makeFakeClient();
    const events: Event[] = [nodeCreatedEvent(1, 'parent'), interpretiveSplitProposalEvent(2)];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const proposalRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'proposal');
    if (!proposalRow) throw new Error('proposal row missing');
    expect(proposalRow.getAttribute('data-proposal-id')).toBe(PROPOSAL_INTERPRETIVE_SPLIT_ID);
  });

  it('axiom-mark proposal on a node renders the "proposal" row for non-declared participants', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      nodeCreatedEvent(1, 'parent'),
      axiomMarkProposalEvent(2, PARTICIPANT_BEN),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          currentParticipantId={PARTICIPANT_MARIA}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const proposalRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'proposal');
    if (!proposalRow) throw new Error('proposal row missing');
    expect(proposalRow.getAttribute('data-proposal-id')).toBe(PROPOSAL_AXIOM_MARK_ID);
  });

  it('axiom-mark proposal does NOT render the "proposal" row for the declared participant (always-on facet rows still render)', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      nodeCreatedEvent(1, 'parent'),
      axiomMarkProposalEvent(2, PARTICIPANT_BEN),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          currentParticipantId={PARTICIPANT_BEN}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const rows = screen.getAllByTestId('participant-detail-panel-facet-row');
    expect(rows.length).toBe(3); // only the always-on facet rows
    const facetNames = rows.map((r) => r.getAttribute('data-facet-name'));
    expect(facetNames).toEqual(['wording', 'classification', 'substance']);
  });

  it('annotate proposal on a node renders one "proposal" row on the targeted node', () => {
    const fake = makeFakeClient();
    const events: Event[] = [nodeCreatedEvent(1, 'parent'), annotateNodeProposalEvent(2)];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const proposalRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'proposal');
    if (!proposalRow) throw new Error('proposal row missing');
    expect(proposalRow.getAttribute('data-proposal-id')).toBe(PROPOSAL_ANNOTATE_ID);
  });

  it('annotate proposal on an edge renders one "proposal" row on the targeted edge', () => {
    const fake = makeFakeClient();
    const events: Event[] = [edgeCreatedEvent(1), annotateEdgeProposalEvent(2)];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="edge"
          entityId={EDGE_E_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const proposalRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'proposal');
    if (!proposalRow) throw new Error('proposal row missing');
    expect(proposalRow.getAttribute('data-proposal-id')).toBe(PROPOSAL_ANNOTATE_ID);
  });

  it('decompose row does NOT render on a sibling component node — only on the parent (always-on rows still render)', () => {
    const fake = makeFakeClient();
    const events: Event[] = [nodeCreatedEvent(1, 'parent'), decomposeProposalEvent(2)];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_COMPONENT_1}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const rows = screen.getAllByTestId('participant-detail-panel-facet-row');
    expect(rows.length).toBe(3);
    const facetNames = rows.map((r) => r.getAttribute('data-facet-name'));
    expect(facetNames).toEqual(['wording', 'classification', 'substance']);
  });

  it('clicking agree on the synthetic "proposal" row fires a vote envelope with the structural proposalId', () => {
    const fake = makeFakeClient();
    const events: Event[] = [nodeCreatedEvent(1, 'parent'), decomposeProposalEvent(2)];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const proposalRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'proposal');
    if (!proposalRow) throw new Error('proposal row missing');
    act(() => {
      fireEvent.click(within(proposalRow).getByTestId('participant-vote-button-agree'));
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('vote');
    // Per ADR 0030 §9 + `pf_part_vote_action_facet_keyed`: structural
    // sub-kinds (decompose / interpretive-split / axiom-mark / annotate)
    // keep the proposal-keyed wire arm — the synthetic `'proposal'`
    // facet row binds the hook to the structural proposal id directly.
    expect(fake.calls[0]?.payload).toEqual({
      sessionId: SESSION_ID,
      expectedSequence: 0,
      target: 'proposal',
      proposalId: PROPOSAL_DECOMPOSE_ID,
      choice: 'agree',
    });
  });

  it('a committed structural proposal stops surfacing its "proposal" row (always-on rows still render)', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      nodeCreatedEvent(1, 'parent'),
      decomposeProposalEvent(2),
      commitEvent(PROPOSAL_DECOMPOSE_ID, 3),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const rows = screen.getAllByTestId('participant-detail-panel-facet-row');
    expect(rows.length).toBe(3); // proposal row dropped
    expect(rows.map((r) => r.getAttribute('data-facet-name'))).toEqual([
      'wording',
      'classification',
      'substance',
    ]);
  });
});

describe('derivePendingFacetProposals — structural sub-kinds', () => {
  it('decompose maps the parent node to the synthetic "proposal" facet', () => {
    const events: Event[] = [decomposeProposalEvent(1)];
    const out = derivePendingFacetProposals(events, 'node', NODE_A_ID);
    expect(out.get('proposal')).toBe(PROPOSAL_DECOMPOSE_ID);
  });

  it('axiom-mark excludes the declared participant when currentParticipantId matches', () => {
    const events: Event[] = [axiomMarkProposalEvent(1, PARTICIPANT_BEN)];
    const out = derivePendingFacetProposals(events, 'node', NODE_A_ID, PARTICIPANT_BEN);
    expect(out.has('proposal')).toBe(false);
  });

  it('axiom-mark includes the row for any other participant', () => {
    const events: Event[] = [axiomMarkProposalEvent(1, PARTICIPANT_BEN)];
    const out = derivePendingFacetProposals(events, 'node', NODE_A_ID, PARTICIPANT_MARIA);
    expect(out.get('proposal')).toBe(PROPOSAL_AXIOM_MARK_ID);
  });

  it('annotate on edge maps the edge to the synthetic "proposal" facet', () => {
    const events: Event[] = [annotateEdgeProposalEvent(1)];
    const out = derivePendingFacetProposals(events, 'edge', EDGE_E_ID);
    expect(out.get('proposal')).toBe(PROPOSAL_ANNOTATE_ID);
  });
});

// --------------------------------------------------------------------
// Wired withdraw button — per `pf_part_withdraw_agreement_action`. On
// `agreed` / `committed` facet rows the withdraw button binds to
// `useWithdrawAgreementAction` and fires a `withdraw-agreement` envelope
// on the second click of a two-stage confirmation gesture. The first
// click ARMS the button (`data-withdraw-armed="true"`, label flips to
// the localized confirm label); the second click fires the wire send.
// --------------------------------------------------------------------

describe('<ParticipantVoteButtons> — wired withdraw button on committed facet rows', () => {
  const committedClassificationEvents = (): Event[] => [
    joinedEvent(1, PARTICIPANT_BEN),
    joinedEvent(2, PARTICIPANT_MARIA),
    nodeCreatedEvent(3, 'A first claim'),
    classifyNodeProposalEvent(4),
    voteEvent(5, PROPOSAL_CLASSIFY_ID, PARTICIPANT_BEN, 'agree'),
    voteEvent(6, PROPOSAL_CLASSIFY_ID, PARTICIPANT_MARIA, 'agree'),
    commitEvent(PROPOSAL_CLASSIFY_ID, 7),
  ];

  it('renders the withdraw button in the idle (un-armed) state on a committed facet row', () => {
    const fake = makeFakeClient();
    const events = committedClassificationEvents();
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
          currentParticipantId={PARTICIPANT_BEN}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    const withdrawBtn = within(classifyRow).getByTestId('participant-vote-button-withdraw');
    expect(withdrawBtn.getAttribute('data-withdraw-armed')).toBe('false');
    expect(withdrawBtn.getAttribute('data-withdraw-state')).toBe('enabled');
    expect(withdrawBtn.hasAttribute('disabled')).toBe(false);
  });

  it('first click ARMS the button — flips data-withdraw-armed to "true" but does NOT fire the envelope', () => {
    const fake = makeFakeClient();
    const events = committedClassificationEvents();
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
          currentParticipantId={PARTICIPANT_BEN}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    const withdrawBtn = within(classifyRow).getByTestId('participant-vote-button-withdraw');
    act(() => {
      fireEvent.click(withdrawBtn);
    });
    expect(fake.calls.length).toBe(0);
    const after = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!after) throw new Error('classification row missing post-click');
    const armedBtn = within(after).getByTestId('participant-vote-button-withdraw');
    expect(armedBtn.getAttribute('data-withdraw-armed')).toBe('true');
    expect(armedBtn.getAttribute('data-withdraw-state')).toBe('armed');
  });

  it('second click fires exactly one withdraw-agreement envelope with the canonical six-field payload', () => {
    const fake = makeFakeClient();
    const events = committedClassificationEvents();
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
          currentParticipantId={PARTICIPANT_BEN}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    const withdrawBtn = within(classifyRow).getByTestId('participant-vote-button-withdraw');
    // First click — arm.
    act(() => {
      fireEvent.click(withdrawBtn);
    });
    expect(fake.calls.length).toBe(0);
    // Second click — fire.
    const armedRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!armedRow) throw new Error('classification row missing pre-second-click');
    const armedBtn = within(armedRow).getByTestId('participant-vote-button-withdraw');
    act(() => {
      fireEvent.click(armedBtn);
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('withdraw-agreement');
    expect(fake.calls[0]?.payload).toEqual({
      sessionId: SESSION_ID,
      expectedSequence: 0,
      entity_kind: 'node',
      entity_id: NODE_A_ID,
      facet: 'classification',
      participant: PARTICIPANT_BEN,
    });
  });

  it('the button is disabled when no currentParticipantId is threaded (defensive guard against the wire payload missing its `participant` field)', () => {
    const fake = makeFakeClient();
    const events = committedClassificationEvents();
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
          // intentionally omitting currentParticipantId
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    const withdrawBtn = within(classifyRow).getByTestId('participant-vote-button-withdraw');
    expect(withdrawBtn.hasAttribute('disabled')).toBe(true);
    act(() => {
      fireEvent.click(withdrawBtn);
    });
    // A disabled button's onClick does not fire — no envelope, no
    // arming.
    expect(fake.calls.length).toBe(0);
    expect(withdrawBtn.getAttribute('data-withdraw-armed')).toBe('false');
  });

  it('the structural "proposal" row keeps its withdraw button as a PLACEHOLDER — clicking does not fire any envelope', () => {
    // Per ADR 0030 §3 + the file's comments: the structural withdraw
    // flow is a follow-up; the `'proposal'` facet row's withdraw
    // button is still a placeholder. This regression test pins the
    // distinction so a future "wire structural withdraw" task
    // doesn't silently flip the test expectations on the facet arm.
    const fake = makeFakeClient();
    const events: Event[] = [nodeCreatedEvent(1, 'parent'), decomposeProposalEvent(2)];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
          currentParticipantId={PARTICIPANT_BEN}
        />
      </Wrapper>,
    );
    const proposalRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'proposal');
    if (!proposalRow) throw new Error('proposal row missing');
    const withdrawBtn = within(proposalRow).getByTestId('participant-vote-button-withdraw');
    expect(withdrawBtn.getAttribute('data-placeholder')).toBe('true');
    expect(withdrawBtn.hasAttribute('disabled')).toBe(true);
    act(() => {
      fireEvent.click(withdrawBtn);
    });
    expect(fake.calls.length).toBe(0);
  });
});

// --------------------------------------------------------------------
// Single-tap policy pin — formalizes the methodology's single-tap-no-
// confirmation posture for the agree/dispute affordance and pins the
// withdraw button as the named exception. Per
// `tasks/refinements/participant-ui/part_vote_single_tap.md` Decision §1
// + ADR 0030 §3 + `docs/participant-ui.md` lines 84 + 139.
//
// Four cases pin distinct observable properties; the fifth (withdraw
// exception) is bundled into case (b) so the asymmetry the policy
// depends on is asserted alongside the policy itself.
// --------------------------------------------------------------------

describe('<ParticipantVoteButtons> — single-tap policy', () => {
  // (a) Single click on agree dispatches exactly one envelope; the
  // row's `data-vote-state` flips to `"in-flight"` with no intermediate
  // render pass between `"enabled"` and `"in-flight"`.
  it('(a) single click on agree fires exactly one vote envelope; vote-state goes enabled → in-flight with no intermediate state', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      nodeCreatedEvent(2, 'A first claim'),
      classifyNodeProposalEvent(3),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const rowBefore = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!rowBefore) throw new Error('classification row missing pre-click');
    expect(rowBefore.getAttribute('data-vote-state')).toBe('enabled');
    const agree = within(rowBefore).getByTestId('participant-vote-button-agree');
    act(() => {
      fireEvent.click(agree);
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('vote');
    const rowAfter = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!rowAfter) throw new Error('classification row missing post-click');
    // No intermediate `"armed"` or similar state; the only state
    // attribute lift is `enabled` → `in-flight`.
    expect(rowAfter.getAttribute('data-vote-state')).toBe('in-flight');
    expect(rowAfter.getAttribute('data-vote-state')).not.toBe('armed');
  });

  // (b) Agree/dispute labels surface only `{agreeLabel|disputeLabel,
  // inFlightLabel}` across the lifecycle — never a "Confirm" / "Are you
  // sure" permutation. The withdraw button (the named exception per
  // ADR 0030 §3) DOES surface a confirm label as its armed state; this
  // case asserts the asymmetry.
  it('(b) agree/dispute have a two-state label set (no confirm permutation); withdraw is the named three-state exception', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      nodeCreatedEvent(2, 'A first claim'),
      classifyNodeProposalEvent(3),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    const agreeBtn = within(classifyRow).getByTestId('participant-vote-button-agree');
    const disputeBtn = within(classifyRow).getByTestId('participant-vote-button-dispute');
    expect(agreeBtn.textContent).toBe('Agree');
    expect(disputeBtn.textContent).toBe('Dispute');
    // Neither button surfaces a confirm-permutation label before the
    // click.
    expect(agreeBtn.textContent).not.toMatch(/confirm/i);
    expect(disputeBtn.textContent).not.toMatch(/are you sure/i);
    // Click agree — the label flips to the inFlight label. The button
    // never passes through an "armed" / "confirm" label.
    act(() => {
      fireEvent.click(agreeBtn);
    });
    const classifyRowAfter = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRowAfter) throw new Error('classification row missing post-click');
    const agreeAfter = within(classifyRowAfter).getByTestId('participant-vote-button-agree');
    expect(agreeAfter.textContent).toBe('Sending…');
    expect(agreeAfter.textContent).not.toMatch(/confirm/i);

    // Withdraw button on a committed row — DOES surface the
    // `confirmLabel` ("Confirm withdraw") as its armed state. The
    // asymmetry is methodology-load-bearing per ADR 0030 §3 +
    // `docs/participant-ui.md` line 99.
    cleanup();
    const fake2 = makeFakeClient();
    const committedEvents: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      joinedEvent(2, PARTICIPANT_MARIA),
      nodeCreatedEvent(3, 'A first claim'),
      classifyNodeProposalEvent(4),
      voteEvent(5, PROPOSAL_CLASSIFY_ID, PARTICIPANT_BEN, 'agree'),
      voteEvent(6, PROPOSAL_CLASSIFY_ID, PARTICIPANT_MARIA, 'agree'),
      commitEvent(PROPOSAL_CLASSIFY_ID, 7),
    ];
    const committedIndex = computeFacetStatuses(committedEvents);
    render(
      <Wrapper client={fake2.client}>
        <ParticipantVoteButtons
          events={committedEvents}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={committedIndex}
          currentParticipantId={PARTICIPANT_BEN}
        />
      </Wrapper>,
    );
    const committedRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!committedRow) throw new Error('classification row missing post-commit');
    const withdrawBtn = within(committedRow).getByTestId('participant-vote-button-withdraw');
    // Idle state — label is `"Withdraw agreement"`.
    expect(withdrawBtn.textContent).toBe('Withdraw agreement');
    // First click ARMS — label flips to `"Confirm withdraw"`. This is
    // the named exception; the agree/dispute buttons have no
    // equivalent.
    act(() => {
      fireEvent.click(withdrawBtn);
    });
    const armedRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!armedRow) throw new Error('classification row missing post-arm');
    const armedBtn = within(armedRow).getByTestId('participant-vote-button-withdraw');
    expect(armedBtn.textContent).toBe('Confirm withdraw');
    expect(armedBtn.getAttribute('data-withdraw-state')).toBe('armed');
    // Second click fires; label flips to the in-flight label.
    act(() => {
      fireEvent.click(armedBtn);
    });
    const inFlightRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!inFlightRow) throw new Error('classification row missing post-fire');
    const inFlightBtn = within(inFlightRow).getByTestId('participant-vote-button-withdraw');
    expect(inFlightBtn.textContent).toBe('Withdrawing…');
  });

  // (c) No DOM node with `role="dialog"` or `aria-modal="true"` mounts
  // at any observable render pass during the click → in-flight
  // sequence. (Post-ack is not reachable with the never-resolving
  // fake; pre-click and post-click pin the surface where a
  // confirmation modal would mount — confirmation modals mount
  // synchronously on click in React's render cycle, so the two-
  // sample-point check is sufficient.)
  it('(c) no role="dialog" or aria-modal="true" mounts at any point during the click → in-flight sequence', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      nodeCreatedEvent(2, 'A first claim'),
      classifyNodeProposalEvent(3),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    // Pre-click sample.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    const agreeBtn = within(classifyRow).getByTestId('participant-vote-button-agree');
    act(() => {
      fireEvent.click(agreeBtn);
    });
    // Post-click-pre-ack sample — the in-flight state is observable
    // here; the click already happened so any confirmation modal
    // wired into the click handler would be mounted.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    // Sanity: the click DID dispatch (otherwise the test passes
    // vacuously).
    expect(fake.calls.length).toBe(1);
  });

  // (d) Two rapid clicks on agree dispatch exactly ONCE. The
  // `disabled={inFlight}` guard on the button is the surface-level
  // gate; the in-flight guard inside `useVoteAction.castVote()`
  // (lines 261-263) is the runtime gate that catches a click that
  // bypasses the disabled attribute. No debounce, no throttle — just
  // the pessimistic-wait posture.
  it('(d) two rapid clicks on the same button dispatch exactly once', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      nodeCreatedEvent(2, 'A first claim'),
      classifyNodeProposalEvent(3),
    ];
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const classifyRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!classifyRow) throw new Error('classification row missing');
    const agreeBtn = within(classifyRow).getByTestId('participant-vote-button-agree');
    act(() => {
      fireEvent.click(agreeBtn);
      fireEvent.click(agreeBtn);
    });
    expect(fake.calls.length).toBe(1);
    // Symmetric guard on dispute — re-render against a fresh client
    // and assert the rapid-click property holds for the dispute arm.
    cleanup();
    resetVoteActionStore();
    const fake2 = makeFakeClient();
    render(
      <Wrapper client={fake2.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
        />
      </Wrapper>,
    );
    const disputeRow = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!disputeRow) throw new Error('classification row missing on dispute re-render');
    const disputeBtn = within(disputeRow).getByTestId('participant-vote-button-dispute');
    act(() => {
      fireEvent.click(disputeBtn);
      fireEvent.click(disputeBtn);
    });
    expect(fake2.calls.length).toBe(1);
  });
});

// --------------------------------------------------------------------
// Pre-commit change vote — per
// `tasks/refinements/participant-ui/part_change_vote_pre_commit.md`.
//
// Nine cases mirror the pane surface's seven (a–g) and add two
// detail-panel-specific cases:
//   (h) the `OWN_VOTE_INDICATOR_TESTID` "You voted X" indicator
//       COEXISTS with the visible change-vote button (no longer hidden
//       when the change-vote button is rendered).
//   (i) status="committed" + ownVote="agree" → the wired withdraw
//       button renders and NO agree/dispute change-vote button is in
//       the DOM (post-commit affordance is withdraw-only per ADR 0030
//       §3).
// --------------------------------------------------------------------

describe('<ParticipantVoteButtons> — pre-commit change vote', () => {
  // Build a `classification` facet at a chosen pre-commit status,
  // optionally seeding the current participant's vote so `ownVote` is
  // defined on the row.
  function preCommitEvents(opts: {
    currentParticipantVote?: 'agree' | 'dispute';
    otherParticipantVote?: 'agree' | 'dispute';
  }): Event[] {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_BEN),
      joinedEvent(2, PARTICIPANT_MARIA),
      nodeCreatedEvent(3, 'A first claim'),
      classifyNodeProposalEvent(4),
    ];
    if (opts.currentParticipantVote !== undefined) {
      events.push(voteEvent(5, PROPOSAL_CLASSIFY_ID, PARTICIPANT_BEN, opts.currentParticipantVote));
    }
    if (opts.otherParticipantVote !== undefined) {
      events.push(voteEvent(6, PROPOSAL_CLASSIFY_ID, PARTICIPANT_MARIA, opts.otherParticipantVote));
    }
    return events;
  }

  function renderRow(events: Event[]): { fake: FakeClient } {
    const fake = makeFakeClient();
    const facetStatusIndex = computeFacetStatuses(events);
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={events}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={facetStatusIndex}
          currentParticipantId={PARTICIPANT_BEN}
        />
      </Wrapper>,
    );
    return { fake };
  }

  function classifyRow(): HTMLElement {
    const row = screen
      .getAllByTestId('participant-detail-panel-facet-row')
      .find((r) => r.getAttribute('data-facet-name') === 'classification');
    if (!row) throw new Error('classification row missing');
    return row;
  }

  it('(a) status="proposed" + no own-vote → both buttons render with mode="first"', () => {
    renderRow(preCommitEvents({}));
    const row = classifyRow();
    const agree = within(row).getByTestId('participant-vote-button-agree');
    const dispute = within(row).getByTestId('participant-vote-button-dispute');
    expect(agree.getAttribute('data-vote-mode')).toBe('first');
    expect(dispute.getAttribute('data-vote-mode')).toBe('first');
  });

  it('(b) status="proposed" + ownVote="agree" → only dispute renders; mode="change"; aria-label uses changeAriaLabel', () => {
    renderRow(preCommitEvents({ currentParticipantVote: 'agree' }));
    const row = classifyRow();
    expect(within(row).queryByTestId('participant-vote-button-agree')).toBeNull();
    const dispute = within(row).getByTestId('participant-vote-button-dispute');
    expect(dispute.getAttribute('data-vote-mode')).toBe('change');
    expect(dispute.getAttribute('aria-label')).toBe('Change your vote to Dispute');
  });

  it('(c) status="proposed" + ownVote="dispute" → only agree renders; mode="change"; aria-label uses changeAriaLabel', () => {
    renderRow(preCommitEvents({ currentParticipantVote: 'dispute' }));
    const row = classifyRow();
    expect(within(row).queryByTestId('participant-vote-button-dispute')).toBeNull();
    const agree = within(row).getByTestId('participant-vote-button-agree');
    expect(agree.getAttribute('data-vote-mode')).toBe('change');
    expect(agree.getAttribute('aria-label')).toBe('Change your vote to Agree');
  });

  it('(d) status="agreed" + ownVote="agree" → the dispute change-vote button renders (agreed is in the pre-commit window)', () => {
    renderRow(preCommitEvents({ currentParticipantVote: 'agree', otherParticipantVote: 'agree' }));
    const row = classifyRow();
    // Unanimous agree → status is `'agreed'`. The pre-commit window
    // still allows a flip per the methodology contract.
    expect(row.getAttribute('data-facet-status')).toBe('agreed');
    expect(within(row).queryByTestId('participant-vote-button-agree')).toBeNull();
    const dispute = within(row).getByTestId('participant-vote-button-dispute');
    expect(dispute.getAttribute('data-vote-mode')).toBe('change');
    // The withdraw button MUST NOT render at `'agreed'` per
    // `part_change_vote_pre_commit` Decision §2 — withdraw is the
    // post-commit affordance, the change-vote flip is the pre-commit
    // path to "un-do my agreement".
    expect(within(row).queryByTestId('participant-vote-button-withdraw')).toBeNull();
  });

  it('(e) status="committed" + ownVote="agree" → withdraw button renders; no agree/dispute change-vote button', () => {
    const events: Event[] = [
      ...preCommitEvents({ currentParticipantVote: 'agree', otherParticipantVote: 'agree' }),
      commitEvent(PROPOSAL_CLASSIFY_ID, 7),
    ];
    renderRow(events);
    const row = classifyRow();
    expect(row.getAttribute('data-facet-status')).toBe('committed');
    expect(within(row).queryByTestId('participant-vote-button-agree')).toBeNull();
    expect(within(row).queryByTestId('participant-vote-button-dispute')).toBeNull();
    expect(within(row).getByTestId('participant-vote-button-withdraw')).toBeDefined();
  });

  it('(f) single-tap policy holds on the change-vote button: two rapid clicks dispatch once; no modal mounts', () => {
    const { fake } = renderRow(preCommitEvents({ currentParticipantVote: 'agree' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    const row = classifyRow();
    const dispute = within(row).getByTestId('participant-vote-button-dispute');
    act(() => {
      fireEvent.click(dispute);
      fireEvent.click(dispute);
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('vote');
    expect((fake.calls[0]?.payload as { choice: string }).choice).toBe('dispute');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('(g) ack-driven re-render: ownVote flipping from "agree" to "dispute" swaps which button is hidden', () => {
    // First render — ownVote is agree (only the participant's vote
    // landed). The dispute change-vote button is visible.
    const initialEvents = preCommitEvents({ currentParticipantVote: 'agree' });
    const fake = makeFakeClient();
    const initialIndex = computeFacetStatuses(initialEvents);
    const { rerender } = render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={initialEvents}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={initialIndex}
          currentParticipantId={PARTICIPANT_BEN}
        />
      </Wrapper>,
    );
    expect(within(classifyRow()).queryByTestId('participant-vote-button-agree')).toBeNull();
    expect(within(classifyRow()).getByTestId('participant-vote-button-dispute')).toBeDefined();

    // Simulate the post-ack projector update: the participant's vote
    // flipped from agree to dispute (latest-vote-wins per ADR 0030).
    // The agree button comes back; the dispute button hides.
    const flippedEvents: Event[] = [
      ...initialEvents,
      voteEvent(6, PROPOSAL_CLASSIFY_ID, PARTICIPANT_BEN, 'dispute'),
    ];
    const flippedIndex = computeFacetStatuses(flippedEvents);
    rerender(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons
          events={flippedEvents}
          entityKind="node"
          entityId={NODE_A_ID}
          facetStatusIndex={flippedIndex}
          currentParticipantId={PARTICIPANT_BEN}
        />
      </Wrapper>,
    );
    expect(within(classifyRow()).queryByTestId('participant-vote-button-dispute')).toBeNull();
    expect(within(classifyRow()).getByTestId('participant-vote-button-agree')).toBeDefined();
  });

  it('(h) the "you voted" indicator COEXISTS with the visible change-vote button on a pre-commit row', () => {
    renderRow(preCommitEvents({ currentParticipantVote: 'agree' }));
    const row = classifyRow();
    // The chosen-side button is hidden; the opposite-side button is
    // visible AND the indicator surfaces in the same row.
    expect(within(row).queryByTestId('participant-vote-button-agree')).toBeNull();
    expect(within(row).getByTestId('participant-vote-button-dispute')).toBeDefined();
    const indicator = within(row).getByTestId('participant-detail-panel-facet-row-own-vote');
    expect(indicator.getAttribute('data-vote-choice')).toBe('agree');
  });

  it('(i) status="committed" + ownVote="agree" pin: withdraw button only; no agree/dispute change-vote button', () => {
    const events: Event[] = [
      ...preCommitEvents({ currentParticipantVote: 'agree', otherParticipantVote: 'agree' }),
      commitEvent(PROPOSAL_CLASSIFY_ID, 7),
    ];
    renderRow(events);
    const row = classifyRow();
    expect(row.getAttribute('data-facet-status')).toBe('committed');
    expect(within(row).queryByTestId('participant-vote-button-agree')).toBeNull();
    expect(within(row).queryByTestId('participant-vote-button-dispute')).toBeNull();
    const withdraw = within(row).getByTestId('participant-vote-button-withdraw');
    expect(withdraw.getAttribute('data-withdraw-state')).toBe('enabled');
  });
});
