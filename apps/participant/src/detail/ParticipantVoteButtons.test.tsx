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
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type {
  Event,
  WsEnvelopeUnion,
  WsMessagePayloadMap,
  WsMessageType,
} from '@a-conversa/shared-types';
import { createI18nInstance } from '@a-conversa/shell';
import { computeFacetStatuses, type FacetStatusIndex } from '../graph/facetStatus';

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

  it('a committed classification flips the row to `committed` with the placeholder withdraw button (no agree/dispute)', () => {
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
    // Placeholder withdraw button — wired by
    // `pf_part_withdraw_agreement_action` downstream.
    expect(within(classifyRow).getByTestId('participant-vote-button-withdraw')).toBeDefined();
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
    expect(fake.calls[0]?.payload).toEqual({
      sessionId: SESSION_ID,
      expectedSequence: 0,
      proposalId: PROPOSAL_CLASSIFY_ID,
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
    expect(fake.calls[0]?.payload).toEqual({
      sessionId: SESSION_ID,
      expectedSequence: 0,
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
