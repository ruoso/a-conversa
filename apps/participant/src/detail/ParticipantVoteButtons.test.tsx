// Tests for `<ParticipantVoteButtons>` — the per-facet vote-button row
// mounted into `<EntityDetailPanel>`'s `actionSlot`.
//
// Refinement: `tasks/refinements/participant-ui/part_voting.md`
//             (`part_vote_button_per_facet`).
//
// Per ADR 0022 these are committed Vitest cases pinning:
//
//   1. **Empty-state branch.** No pending proposals on the selected
//      entity → component renders `null` (the absence of a vote
//      affordance is the signal).
//   2. **Per-facet row contract.** One pending proposal → one row with
//      `data-testid="participant-detail-panel-facet-row"` +
//      `data-facet-name="<facet>"` + the three vote buttons as direct
//      descendants. This is the contract the e2e methodology spec
//      selects against.
//   3. **Per-choice button testids.** Each row carries
//      `participant-vote-button-{agree,dispute,withdraw}` testids on
//      its three buttons.
//   4. **Click → fires the wire envelope.** Clicking the agree button
//      sends exactly one `vote` envelope with `choice: 'agree'` for
//      the row's `proposalId`.
//   5. **Multiple facets → multiple rows.** Two pending proposals
//      against the same entity (one classify-node, one edit-wording) →
//      two rows, each with its own facet name + proposalId binding.
//   6. **Committed proposal → no row.** A pending proposal that's
//      later committed disappears from the action slot.

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

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const NODE_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROPOSAL_CLASSIFY_ID = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_REWORD_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '00000000-0000-4000-8000-0000000000aa';

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
        node_id: NODE_A_ID,
        sub_kind: 'reword',
        wording: 'Reworded.',
      },
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

describe('<ParticipantVoteButtons> — empty state', () => {
  it('renders nothing when the selected entity has no pending proposals', () => {
    const fake = makeFakeClient();
    const { container } = render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons events={[]} entityKind="node" entityId={NODE_A_ID} />
      </Wrapper>,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('<ParticipantVoteButtons> — per-facet rows', () => {
  it('renders one row per pending facet with the spec testid + data-facet-name attr', () => {
    const fake = makeFakeClient();
    const events: Event[] = [classifyNodeProposalEvent(1), editWordingProposalEvent(2)];
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons events={events} entityKind="node" entityId={NODE_A_ID} />
      </Wrapper>,
    );
    const rows = screen.getAllByTestId('participant-detail-panel-facet-row');
    expect(rows.length).toBe(2);
    const facetNames = rows.map((r) => r.getAttribute('data-facet-name'));
    expect(facetNames.sort()).toEqual(['classification', 'wording']);
  });

  it('each row carries the three vote-button testids as descendants', () => {
    const fake = makeFakeClient();
    const events: Event[] = [classifyNodeProposalEvent(1)];
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons events={events} entityKind="node" entityId={NODE_A_ID} />
      </Wrapper>,
    );
    const row = screen.getByTestId('participant-detail-panel-facet-row');
    expect(row.getAttribute('data-facet-name')).toBe('classification');
    expect(row.getAttribute('data-proposal-id')).toBe(PROPOSAL_CLASSIFY_ID);
    expect(within(row).getByTestId('participant-vote-button-agree')).toBeDefined();
    expect(within(row).getByTestId('participant-vote-button-dispute')).toBeDefined();
    expect(within(row).getByTestId('participant-vote-button-withdraw')).toBeDefined();
  });

  it('does NOT render a row for a proposal that has been committed', () => {
    const fake = makeFakeClient();
    const events: Event[] = [
      classifyNodeProposalEvent(1),
      editWordingProposalEvent(2),
      commitEvent(PROPOSAL_CLASSIFY_ID, 3),
    ];
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons events={events} entityKind="node" entityId={NODE_A_ID} />
      </Wrapper>,
    );
    const rows = screen.getAllByTestId('participant-detail-panel-facet-row');
    expect(rows.length).toBe(1);
    expect(rows[0]?.getAttribute('data-facet-name')).toBe('wording');
    expect(rows[0]?.getAttribute('data-proposal-id')).toBe(PROPOSAL_REWORD_ID);
  });
});

describe('<ParticipantVoteButtons> — click fires the wire envelope', () => {
  it('clicking agree sends exactly one vote envelope with choice="agree"', () => {
    const fake = makeFakeClient();
    const events: Event[] = [classifyNodeProposalEvent(1)];
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons events={events} entityKind="node" entityId={NODE_A_ID} />
      </Wrapper>,
    );
    const row = screen.getByTestId('participant-detail-panel-facet-row');
    const agree = within(row).getByTestId('participant-vote-button-agree');
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

  it('clicking dispute sends choice="dispute"', () => {
    const fake = makeFakeClient();
    const events: Event[] = [classifyNodeProposalEvent(1)];
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons events={events} entityKind="node" entityId={NODE_A_ID} />
      </Wrapper>,
    );
    const row = screen.getByTestId('participant-detail-panel-facet-row');
    act(() => {
      fireEvent.click(within(row).getByTestId('participant-vote-button-dispute'));
    });
    expect(fake.calls.length).toBe(1);
    expect((fake.calls[0]?.payload as { choice: string }).choice).toBe('dispute');
  });

  it('clicking withdraw sends choice="withdraw"', () => {
    const fake = makeFakeClient();
    const events: Event[] = [classifyNodeProposalEvent(1)];
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons events={events} entityKind="node" entityId={NODE_A_ID} />
      </Wrapper>,
    );
    const row = screen.getByTestId('participant-detail-panel-facet-row');
    act(() => {
      fireEvent.click(within(row).getByTestId('participant-vote-button-withdraw'));
    });
    expect(fake.calls.length).toBe(1);
    expect((fake.calls[0]?.payload as { choice: string }).choice).toBe('withdraw');
  });

  it('two facet rows fire independent envelopes scoped to each proposalId', () => {
    const fake = makeFakeClient();
    const events: Event[] = [classifyNodeProposalEvent(1), editWordingProposalEvent(2)];
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons events={events} entityKind="node" entityId={NODE_A_ID} />
      </Wrapper>,
    );
    const rows = screen.getAllByTestId('participant-detail-panel-facet-row');
    const classifyRow = rows.find((r) => r.getAttribute('data-facet-name') === 'classification');
    const wordingRow = rows.find((r) => r.getAttribute('data-facet-name') === 'wording');
    if (!classifyRow || !wordingRow) throw new Error('missing facet row');
    act(() => {
      fireEvent.click(within(classifyRow).getByTestId('participant-vote-button-agree'));
    });
    act(() => {
      fireEvent.click(within(wordingRow).getByTestId('participant-vote-button-dispute'));
    });
    expect(fake.calls.length).toBe(2);
    expect((fake.calls[0]?.payload as { proposalId: string }).proposalId).toBe(
      PROPOSAL_CLASSIFY_ID,
    );
    expect((fake.calls[1]?.payload as { proposalId: string }).proposalId).toBe(PROPOSAL_REWORD_ID);
  });
});

describe('<ParticipantVoteButtons> — in-flight visual', () => {
  it('flips data-vote-state to "in-flight" on the clicked row after click', () => {
    const fake = makeFakeClient();
    const events: Event[] = [classifyNodeProposalEvent(1)];
    render(
      <Wrapper client={fake.client}>
        <ParticipantVoteButtons events={events} entityKind="node" entityId={NODE_A_ID} />
      </Wrapper>,
    );
    const row = screen.getByTestId('participant-detail-panel-facet-row');
    expect(row.getAttribute('data-vote-state')).toBe('enabled');
    act(() => {
      fireEvent.click(within(row).getByTestId('participant-vote-button-agree'));
    });
    // After click, the row reflects in-flight; the buttons are disabled.
    const rowAfter = screen.getByTestId('participant-detail-panel-facet-row');
    expect(rowAfter.getAttribute('data-vote-state')).toBe('in-flight');
    const agreeBtn = within(rowAfter).getByTestId('participant-vote-button-agree');
    expect(agreeBtn.hasAttribute('disabled')).toBe(true);
  });
});
