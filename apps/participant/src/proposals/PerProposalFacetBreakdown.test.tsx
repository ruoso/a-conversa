// Vitest cases for the participant's `<PerProposalFacetBreakdown>` —
// the inline row of facet chips that renders inside each
// `<PendingProposalRow>`'s expanded body region.
//
// Refinement: tasks/refinements/participant-ui/part_per_facet_breakdown_in_pane.md
//
// Per ADR 0022 these are committed Vitest cases. They pin:
//   (a) A `capture-node` proposal renders one chip with
//       `data-facet-name="wording"`, the resolved facet label
//       ("Wording"), and the `proposed` className branch.
//   (b) Per-status className for each `FacetStatus` value matches
//       `PILL_STATUS_CLASSNAME` from `@a-conversa/shell` (drift-guard
//       against the shell's exported map).
//   (c) A structural sub-kind (`decompose`) renders one chip with
//       `data-facet-name="proposal"` and the
//       `methodology.facet.proposal` label ("Proposal").
//   (d) When `serverPerFacetStatus[facetName]` is present, the chip's
//       `data-facet-status` reflects the server value (not the client
//       mirror).
//   (e) The breakdown container carries `data-proposal-id` matching the
//       prop.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ProposalPayload } from '@a-conversa/shared-types';

import {
  I18nProvider,
  PILL_BASE_CLASSNAME,
  PILL_STATUS_CLASSNAME,
  createI18nInstance,
  type I18nInstance,
  type Vote,
} from '@a-conversa/shell';

import { PerProposalFacetBreakdown } from './PerProposalFacetBreakdown';
import type { OtherVotesByFacetIndex } from './otherVotesByFacet';
import type { OtherVotesByProposalIndex } from './otherVotesByProposal';
import type { FacetName, FacetStatus, FacetStatusIndex } from '../graph/facetStatus';

const NODE_X = '00000000-0000-4000-8000-00000000000a';
const PROPOSAL_P = '00000000-0000-4000-8000-0000000000ff';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000c1';

const EMPTY_INDEX: FacetStatusIndex = {
  nodes: new Map(),
  edges: new Map(),
};

function indexWith(
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: FacetName,
  status: FacetStatus,
): FacetStatusIndex {
  const inner: Partial<Record<FacetName, FacetStatus>> = { [facet]: status };
  if (entityKind === 'node') {
    return {
      nodes: new Map([[entityId, inner]]),
      edges: new Map(),
    };
  }
  return {
    nodes: new Map(),
    edges: new Map([[entityId, inner]]),
  };
}

let i18n: I18nInstance;

beforeAll(async () => {
  i18n = await createI18nInstance('en-US');
});

afterEach(() => {
  cleanup();
});

function renderBreakdown(
  proposal: ProposalPayload,
  facetStatusIndex: FacetStatusIndex = EMPTY_INDEX,
  serverPerFacetStatus: Record<string, string> | undefined = undefined,
  proposalEventId: string = PROPOSAL_P,
  votesByFacetIndex?: OtherVotesByFacetIndex,
  votesByProposalIndex?: OtherVotesByProposalIndex,
): ReturnType<typeof render> {
  const voteProps: {
    votesByFacetIndex?: OtherVotesByFacetIndex;
    votesByProposalIndex?: OtherVotesByProposalIndex;
  } = {};
  if (votesByFacetIndex !== undefined) voteProps.votesByFacetIndex = votesByFacetIndex;
  if (votesByProposalIndex !== undefined) voteProps.votesByProposalIndex = votesByProposalIndex;
  return render(
    <I18nProvider i18n={i18n}>
      <PerProposalFacetBreakdown
        proposal={proposal}
        facetStatusIndex={facetStatusIndex}
        serverPerFacetStatus={serverPerFacetStatus}
        proposalEventId={proposalEventId}
        {...voteProps}
      />
    </I18nProvider>,
  );
}

const VOTER_A = '00000000-0000-4000-8000-00000000001a';
const VOTER_B = '00000000-0000-4000-8000-00000000001b';

function votesByFacetWith(
  entityId: string,
  facet: FacetName,
  votes: readonly Vote[],
): OtherVotesByFacetIndex {
  const inner = new Map<FacetName, readonly Vote[]>([[facet, votes]]);
  return new Map<string, ReadonlyMap<FacetName, readonly Vote[]>>([[entityId, inner]]);
}

function votesByProposalWith(
  proposalId: string,
  votes: readonly Vote[],
): OtherVotesByProposalIndex {
  return new Map<string, readonly Vote[]>([[proposalId, votes]]);
}

describe('<PerProposalFacetBreakdown>', () => {
  it('(a) capture-node renders one chip with data-facet-name="wording", "Wording" label, and the proposed className branch', () => {
    const proposal: ProposalPayload = {
      kind: 'capture-node',
      node_id: NODE_X,
      wording: 'fresh wording',
    };
    renderBreakdown(proposal);
    const chips = screen.getAllByTestId('participant-pending-proposal-row-facet');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.getAttribute('data-facet-name')).toBe('wording');
    expect(chips[0]?.getAttribute('data-facet-status')).toBe('proposed');
    expect(chips[0]?.textContent).toBe('Wording');
    expect(chips[0]?.getAttribute('class')).toBe(
      `${PILL_BASE_CLASSNAME} ${PILL_STATUS_CLASSNAME.proposed}`,
    );
  });

  it('(b) per-status className drift-guard: chip class equals PILL_BASE + PILL_STATUS[status] for every FacetStatus', () => {
    const statuses: FacetStatus[] = [
      'proposed',
      'agreed',
      'disputed',
      'meta-disagreement',
      'committed',
      'withdrawn',
      'awaiting-proposal',
    ];
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    for (const status of statuses) {
      const server: Record<string, string> = { classification: status };
      const { unmount } = renderBreakdown(proposal, EMPTY_INDEX, server);
      const chip = screen.getByTestId('participant-pending-proposal-row-facet');
      expect(chip.getAttribute('data-facet-status'), `status=${status}`).toBe(status);
      expect(chip.getAttribute('class'), `status=${status}`).toBe(
        `${PILL_BASE_CLASSNAME} ${PILL_STATUS_CLASSNAME[status]}`,
      );
      unmount();
    }
  });

  it('(c) structural sub-kind (decompose) renders one chip with data-facet-name="proposal" and "Proposal" label', () => {
    const proposal: ProposalPayload = {
      kind: 'decompose',
      parent_node_id: NODE_X,
      components: [
        {
          wording: 'first',
          classification: 'fact',
          node_id: '00000000-0000-4000-8000-00000000f021',
        },
        {
          wording: 'second',
          classification: 'fact',
          node_id: '00000000-0000-4000-8000-00000000f022',
        },
      ],
    };
    renderBreakdown(proposal);
    const chips = screen.getAllByTestId('participant-pending-proposal-row-facet');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.getAttribute('data-facet-name')).toBe('proposal');
    expect(chips[0]?.textContent).toBe('Proposal');
  });

  it('(d) when serverPerFacetStatus carries the facet, the chip data-facet-status reflects the server value (not the client mirror)', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const clientIndex = indexWith('node', NODE_X, 'classification', 'agreed');
    const server: Record<string, string> = { classification: 'disputed' };
    renderBreakdown(proposal, clientIndex, server);
    const chip = screen.getByTestId('participant-pending-proposal-row-facet');
    expect(chip.getAttribute('data-facet-status')).toBe('disputed');
  });

  it('(e) the breakdown container carries data-proposal-id matching the prop', () => {
    const proposal: ProposalPayload = {
      kind: 'axiom-mark',
      node_id: NODE_X,
      participant: PARTICIPANT_A,
    };
    renderBreakdown(proposal, EMPTY_INDEX, undefined, PROPOSAL_P);
    const container = screen.getByTestId('participant-pending-proposal-row-facets');
    expect(container.getAttribute('data-proposal-id')).toBe(PROPOSAL_P);
  });

  it('(f) two votes on a facet-targeting proposal → chip renders the in-chip indicator row with two [data-vote-indicator] dots carrying per-voter attributes', () => {
    const proposal: ProposalPayload = {
      kind: 'capture-node',
      node_id: NODE_X,
      wording: 'fresh wording',
    };
    const votes: readonly Vote[] = [
      { participantId: VOTER_A, choice: 'agree' },
      { participantId: VOTER_B, choice: 'dispute' },
    ];
    const byFacet = votesByFacetWith(NODE_X, 'wording', votes);
    renderBreakdown(proposal, EMPTY_INDEX, undefined, PROPOSAL_P, byFacet);
    const chip = screen.getByTestId('participant-pending-proposal-row-facet');
    const row = chip.querySelector(
      '[data-testid="participant-pending-proposal-row-facet-vote-indicator-row"]',
    );
    expect(row).toBeTruthy();
    const dots = row!.querySelectorAll('[data-vote-indicator]');
    expect(dots).toHaveLength(2);
    expect(dots[0]?.getAttribute('data-participant-id')).toBe(VOTER_A);
    expect(dots[0]?.getAttribute('data-choice')).toBe('agree');
    expect(dots[1]?.getAttribute('data-participant-id')).toBe(VOTER_B);
    expect(dots[1]?.getAttribute('data-choice')).toBe('dispute');
  });

  it('(g) entry.votes.length === 0 → indicator row is OMITTED; only the label text in the chip', () => {
    const proposal: ProposalPayload = {
      kind: 'capture-node',
      node_id: NODE_X,
      wording: 'fresh wording',
    };
    renderBreakdown(proposal);
    expect(
      screen.queryByTestId('participant-pending-proposal-row-facet-vote-indicator-row'),
    ).toBeNull();
    const chip = screen.getByTestId('participant-pending-proposal-row-facet');
    expect(chip.textContent).toBe('Wording');
  });

  it('(h) structural sub-kind with one proposal-arm vote → indicator row mounts inside the synthetic "proposal" chip', () => {
    const proposal: ProposalPayload = {
      kind: 'decompose',
      parent_node_id: NODE_X,
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
    };
    const byProposal = votesByProposalWith(PROPOSAL_P, [
      { participantId: VOTER_A, choice: 'agree' },
    ]);
    renderBreakdown(proposal, EMPTY_INDEX, undefined, PROPOSAL_P, undefined, byProposal);
    const chip = screen.getByTestId('participant-pending-proposal-row-facet');
    expect(chip.getAttribute('data-facet-name')).toBe('proposal');
    const row = chip.querySelector(
      '[data-testid="participant-pending-proposal-row-facet-vote-indicator-row"]',
    );
    expect(row).toBeTruthy();
    const dots = row!.querySelectorAll('[data-vote-indicator]');
    expect(dots).toHaveLength(1);
    expect(dots[0]?.getAttribute('data-participant-id')).toBe(VOTER_A);
    expect(dots[0]?.getAttribute('data-choice')).toBe('agree');
  });
});
