// Vitest cases for `<ProposalFacetVoteButtons>` — the per-chip vote
// affordance the participant pending-proposals pane mounts inside each
// per-facet chip.
//
// Refinement: tasks/refinements/participant-ui/part_vote_button_per_facet.md
//
// Pins:
//   (a) `status === 'proposed'` AND no own-vote → both buttons render.
//   (b) `status === 'disputed'` AND no own-vote → both buttons render.
//   (c) `status === 'withdrawn'` AND no own-vote → both buttons render.
//   (d) `status === 'agreed'` → no buttons.
//   (e) `status === 'committed'` → no buttons.
//   (f) `status === 'meta-disagreement'` → no buttons.
//   (g) `status === 'awaiting-proposal'` → no buttons.
//   (h) facet-arm own-vote on the keyed facet → no buttons.
//   (i) proposal-arm own-vote on the keyed proposal → no buttons.
//   (j) clicking `agree` on the facet arm fires the facet-keyed wire
//       payload + flips `data-vote-state` to in-flight on the buttons.
//   (k) clicking `agree` on the proposal arm fires the proposal-keyed
//       wire payload.
//   (l) empty proposal_id on the proposal arm → no buttons (defensive
//       guard — the gate refuses to render against an unbound slot).

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  I18nProvider,
  WsClientProvider,
  createI18nInstance,
  type I18nInstance,
  type SendFn,
  type WsClient,
  type WsClientStatus,
} from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';

import { ProposalFacetVoteButtons } from './ProposalFacetVoteButtons';
import type { VoteTarget } from './perProposalFacets';
import { EMPTY_OWN_FACET_VOTES, ownFacetKey, type OwnFacetVoteIndex } from '../graph/ownVotes';
import { resetVoteActionStore } from '../detail/useVoteAction';
import { useWsStore } from '../ws/wsStore';
import type { FacetStatus } from '../graph/facetStatus';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const PROPOSAL_P = '00000000-0000-4000-8000-0000000000ff';

const FACET_TARGET: VoteTarget = {
  kind: 'facet',
  entity_kind: 'node',
  entity_id: NODE_X,
  facet: 'wording',
};

const PROPOSAL_TARGET: VoteTarget = {
  kind: 'proposal',
  proposal_id: PROPOSAL_P,
};

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
    // Never resolves — keeps the in-flight branch observable.
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

let i18n: I18nInstance;

beforeAll(async () => {
  i18n = await createI18nInstance('en-US');
});

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

function Wrapper({ children, client }: { children: ReactNode; client: WsClient }): ReactElement {
  return (
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}`]}>
      <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
        <I18nProvider i18n={i18n}>
          <Routes>
            <Route path="/sessions/:id" element={children} />
          </Routes>
        </I18nProvider>
      </WsClientProvider>
    </MemoryRouter>
  );
}

function renderButtons(
  voteTarget: VoteTarget,
  status: FacetStatus,
  ownFacetVotes: OwnFacetVoteIndex = EMPTY_OWN_FACET_VOTES,
  client: WsClient = makeFakeClient().client,
): ReturnType<typeof render> {
  return render(
    <Wrapper client={client}>
      <ProposalFacetVoteButtons
        voteTarget={voteTarget}
        status={status}
        ownFacetVotes={ownFacetVotes}
      />
    </Wrapper>,
  );
}

const VOTABLE_STATUSES: readonly FacetStatus[] = ['proposed', 'disputed', 'withdrawn'];
const NON_VOTABLE_STATUSES: readonly FacetStatus[] = [
  'agreed',
  'committed',
  'meta-disagreement',
  'awaiting-proposal',
];

describe('<ProposalFacetVoteButtons>', () => {
  it.each(VOTABLE_STATUSES)(
    '(a–c) renders both buttons when status="%s" and own-vote is absent',
    (status) => {
      renderButtons(FACET_TARGET, status);
      expect(
        screen.getByTestId('participant-pending-proposal-row-facet-vote-button-agree'),
      ).toBeDefined();
      expect(
        screen.getByTestId('participant-pending-proposal-row-facet-vote-button-dispute'),
      ).toBeDefined();
    },
  );

  it.each(NON_VOTABLE_STATUSES)('(d–g) renders nothing when status="%s"', (status) => {
    renderButtons(FACET_TARGET, status);
    expect(
      screen.queryByTestId('participant-pending-proposal-row-facet-vote-button-agree'),
    ).toBeNull();
    expect(
      screen.queryByTestId('participant-pending-proposal-row-facet-vote-button-dispute'),
    ).toBeNull();
  });

  it('(h) facet-arm own-vote on the keyed facet hides the buttons', () => {
    const ownVotes: OwnFacetVoteIndex = {
      facets: new Map<string, 'agree' | 'dispute'>([
        [ownFacetKey('node', NODE_X, 'wording'), 'agree'],
      ]),
      proposals: new Map<string, 'agree' | 'dispute'>(),
    };
    renderButtons(FACET_TARGET, 'proposed', ownVotes);
    expect(
      screen.queryByTestId('participant-pending-proposal-row-facet-vote-button-agree'),
    ).toBeNull();
  });

  it('(i) proposal-arm own-vote on the keyed proposal hides the buttons', () => {
    const ownVotes: OwnFacetVoteIndex = {
      facets: new Map<string, 'agree' | 'dispute'>(),
      proposals: new Map<string, 'agree' | 'dispute'>([[PROPOSAL_P, 'dispute']]),
    };
    renderButtons(PROPOSAL_TARGET, 'proposed', ownVotes);
    expect(
      screen.queryByTestId('participant-pending-proposal-row-facet-vote-button-agree'),
    ).toBeNull();
  });

  it('(j) clicking agree on the facet arm sends the facet-keyed vote payload and flips data-vote-state to in-flight', () => {
    const fake = makeFakeClient();
    renderButtons(FACET_TARGET, 'proposed', EMPTY_OWN_FACET_VOTES, fake.client);
    const agree = screen.getByTestId('participant-pending-proposal-row-facet-vote-button-agree');
    expect(agree.getAttribute('data-vote-state')).toBe('enabled');
    act(() => {
      fireEvent.click(agree);
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('vote');
    expect(fake.calls[0]?.payload).toEqual({
      sessionId: SESSION_ID,
      expectedSequence: 0,
      target: 'facet',
      entity_kind: 'node',
      entity_id: NODE_X,
      facet: 'wording',
      choice: 'agree',
    });
    const after = screen.getByTestId('participant-pending-proposal-row-facet-vote-button-agree');
    expect(after.getAttribute('data-vote-state')).toBe('in-flight');
    expect(after.hasAttribute('disabled')).toBe(true);
  });

  it('(k) clicking agree on the proposal arm sends the proposal-keyed vote payload', () => {
    const fake = makeFakeClient();
    renderButtons(PROPOSAL_TARGET, 'proposed', EMPTY_OWN_FACET_VOTES, fake.client);
    const agree = screen.getByTestId('participant-pending-proposal-row-facet-vote-button-agree');
    act(() => {
      fireEvent.click(agree);
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('vote');
    expect(fake.calls[0]?.payload).toEqual({
      sessionId: SESSION_ID,
      expectedSequence: 0,
      target: 'proposal',
      proposalId: PROPOSAL_P,
      choice: 'agree',
    });
  });

  it('(l) empty proposal_id on the proposal arm renders nothing (defensive guard)', () => {
    renderButtons({ kind: 'proposal', proposal_id: '' }, 'proposed');
    expect(
      screen.queryByTestId('participant-pending-proposal-row-facet-vote-button-agree'),
    ).toBeNull();
    expect(
      screen.queryByTestId('participant-pending-proposal-row-facet-vote-button-dispute'),
    ).toBeNull();
  });
});
