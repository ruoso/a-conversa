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

// --------------------------------------------------------------------
// Single-tap policy pin — mirrors the detail-panel surface's policy
// pin (`<ParticipantVoteButtons> — single-tap policy` in
// `apps/participant/src/detail/ParticipantVoteButtons.test.tsx`). Per
// `tasks/refinements/participant-ui/part_vote_single_tap.md` Decision §1
// + ADR 0030 §3 + `docs/participant-ui.md` lines 84 + 139.
//
// Four cases pin the same observable properties on the pane chip
// surface. The pane has no withdraw button (per ADR 0030 §3 — the
// pane only surfaces the two-arm agree/dispute vocabulary; withdraw
// is a detail-panel-only affordance); case (f) asserts the absence
// instead of the three-state asymmetry the detail-panel pin checks.
// --------------------------------------------------------------------

describe('<ProposalFacetVoteButtons> — single-tap policy', () => {
  // (e) Single click on agree dispatches exactly one envelope; the
  // button's `data-vote-state` flips to `"in-flight"` with no
  // intermediate render pass.
  it('(e) single click on agree fires exactly one vote envelope; vote-state goes enabled → in-flight', () => {
    const fake = makeFakeClient();
    renderButtons(FACET_TARGET, 'proposed', EMPTY_OWN_FACET_VOTES, fake.client);
    const agree = screen.getByTestId('participant-pending-proposal-row-facet-vote-button-agree');
    expect(agree.getAttribute('data-vote-state')).toBe('enabled');
    act(() => {
      fireEvent.click(agree);
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('vote');
    const after = screen.getByTestId('participant-pending-proposal-row-facet-vote-button-agree');
    expect(after.getAttribute('data-vote-state')).toBe('in-flight');
    // No intermediate `"armed"` state on the pane surface.
    expect(after.getAttribute('data-vote-state')).not.toBe('armed');
  });

  // (f) The pane never surfaces a "Confirm" / "Are you sure"
  // permutation label on the agree/dispute buttons, AND never
  // surfaces the detail-panel's `confirmLabel` ("Confirm withdraw")
  // — the pane has no withdraw button at all (ADR 0030 §3 + the
  // refinement's Decision §2). Label set across the lifecycle is
  // `{agreeLabel|disputeLabel, inFlightLabel}` only.
  it('(f) agree/dispute have a two-state label set; pane never surfaces a confirm permutation or a withdraw button', () => {
    const fake = makeFakeClient();
    renderButtons(FACET_TARGET, 'proposed', EMPTY_OWN_FACET_VOTES, fake.client);
    const agree = screen.getByTestId('participant-pending-proposal-row-facet-vote-button-agree');
    const dispute = screen.getByTestId(
      'participant-pending-proposal-row-facet-vote-button-dispute',
    );
    expect(agree.textContent).toBe('Agree');
    expect(dispute.textContent).toBe('Dispute');
    expect(agree.textContent).not.toMatch(/confirm/i);
    expect(dispute.textContent).not.toMatch(/are you sure/i);
    // Click agree — label flips to inFlightLabel. Never an armed /
    // confirm permutation.
    act(() => {
      fireEvent.click(agree);
    });
    const agreeAfter = screen.getByTestId(
      'participant-pending-proposal-row-facet-vote-button-agree',
    );
    expect(agreeAfter.textContent).toBe('Sending…');
    expect(agreeAfter.textContent).not.toMatch(/confirm/i);
    // The pane surface intentionally has no withdraw affordance —
    // assert the testid is absent across the lifecycle so a future
    // "unify the vote buttons" refactor cannot flatten withdraw into
    // the pane.
    expect(
      screen.queryByTestId('participant-pending-proposal-row-facet-vote-button-withdraw'),
    ).toBeNull();
    expect(screen.queryByTestId('participant-vote-button-withdraw')).toBeNull();
  });

  // (g) No DOM node with `role="dialog"` or `aria-modal="true"`
  // mounts at any observable render pass during the click → in-flight
  // sequence on the pane surface.
  it('(g) no role="dialog" or aria-modal="true" mounts at any point during the click → in-flight sequence', () => {
    const fake = makeFakeClient();
    renderButtons(FACET_TARGET, 'proposed', EMPTY_OWN_FACET_VOTES, fake.client);
    // Pre-click sample.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    const agree = screen.getByTestId('participant-pending-proposal-row-facet-vote-button-agree');
    act(() => {
      fireEvent.click(agree);
    });
    // Post-click-pre-ack sample.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    // Sanity — the click actually dispatched.
    expect(fake.calls.length).toBe(1);
  });

  // (h) Two rapid clicks on agree dispatch exactly ONCE — the
  // `disabled={inFlight}` guard + the `useVoteAction.castVote`
  // in-flight runtime check are the single-fire mechanism.
  it('(h) two rapid clicks dispatch exactly once on the pane surface', () => {
    const fake = makeFakeClient();
    renderButtons(FACET_TARGET, 'proposed', EMPTY_OWN_FACET_VOTES, fake.client);
    const agree = screen.getByTestId('participant-pending-proposal-row-facet-vote-button-agree');
    act(() => {
      fireEvent.click(agree);
      fireEvent.click(agree);
    });
    expect(fake.calls.length).toBe(1);
  });
});
