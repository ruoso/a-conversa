// Tests for `<ProposalFacetBreakdown>` — the inline row of facet chips
// the right-sidebar's pending-proposals pane renders inside each
// proposal row's body.
//
// Refinement: tasks/refinements/moderator-ui/mod_per_facet_breakdown.md
//
// Per ADR 0022 these are committed Vitest cases. They pin:
//   (a) A `classify-node` proposal renders one chip with
//       `data-facet-name="classification"` and the resolved facet label.
//   (b) The per-status className for each of the six FacetStatus values
//       matches the shared `PILL_STATUS_CLASSNAME` map (the drift guard
//       Decision §3 commits to — if the graph pill's branches change
//       without the sidebar mirror following, this assertion fails).
//   (c) A structural sub-kind (`decompose`) renders one chip with
//       `data-facet-name="proposal"` and the
//       `methodology.facet.proposal` label ("Proposal" in en-US).
//   (d) When `serverPerFacetStatus[facetName]` is present, the chip's
//       `data-facet-status` reflects the server value (precedence
//       contract).
//   (e) The breakdown container carries `data-proposal-id` matching the
//       row's `proposalEventId`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import type { ProposalPayload } from '@a-conversa/shared-types';

import { ProposalFacetBreakdown } from './ProposalFacetBreakdown';
import { PILL_BASE_CLASSNAME, PILL_STATUS_CLASSNAME } from '../graph/FacetPill';
import { VoteIndicator } from '../graph/VoteIndicator';
import type { FacetName, FacetStatus, FacetStatusIndex } from '../graph/facetStatus';
import type { PendingProposalRow } from '../graph/pendingProposals';
import type { VotesByFacetIndex } from '../graph/proposalFacets';
import type { Vote } from '../graph/selectors';
import { createI18nInstance } from '@a-conversa/shell';

const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000c1';
const PARTICIPANT_B = '00000000-0000-4000-8000-0000000000c2';
const PARTICIPANT_C = '00000000-0000-4000-8000-0000000000c3';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const PROPOSAL_P = '00000000-0000-4000-8000-0000000000ff';

function votesIndexWith(
  entityId: string,
  facet: FacetName,
  votes: readonly Vote[],
): VotesByFacetIndex {
  return new Map([[entityId, new Map([[facet, votes]])]]);
}

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

function row(proposal: ProposalPayload, proposalEventId = PROPOSAL_P): PendingProposalRow {
  return {
    proposalEventId,
    sequence: 1,
    kind: 'proposal',
    proposal,
    actor: ACTOR,
    createdAt: '2026-05-16T00:01:00.000Z',
  };
}

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('ProposalFacetBreakdown — facet-targeting sub-kind renders one chip', () => {
  it('classify-node renders a chip with data-facet-name="classification" and the en-US label', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    render(
      <ProposalFacetBreakdown
        row={row(proposal)}
        facetStatusIndex={EMPTY_INDEX}
        serverPerFacetStatus={undefined}
      />,
    );
    const chips = screen.getAllByTestId('proposal-facet-row');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.getAttribute('data-facet-name')).toBe('classification');
    expect(chips[0]?.textContent).toBe('Classification');
  });

  it('set-edge-substance renders one chip with data-facet-name="substance"', () => {
    const proposal: ProposalPayload = {
      kind: 'set-edge-substance',
      edge_id: EDGE_E,
      value: 'agreed',
    };
    render(
      <ProposalFacetBreakdown
        row={row(proposal)}
        facetStatusIndex={EMPTY_INDEX}
        serverPerFacetStatus={undefined}
      />,
    );
    const chips = screen.getAllByTestId('proposal-facet-row');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.getAttribute('data-facet-name')).toBe('substance');
  });

  it('edit-wording (restructure) renders one chip with data-facet-name="wording"', () => {
    const proposal: ProposalPayload = {
      kind: 'edit-wording',
      edit_kind: 'restructure',
      node_id: NODE_X,
      new_wording: 'rebuilt',
      new_node_id: NODE_Y,
    };
    render(
      <ProposalFacetBreakdown
        row={row(proposal)}
        facetStatusIndex={EMPTY_INDEX}
        serverPerFacetStatus={undefined}
      />,
    );
    const chips = screen.getAllByTestId('proposal-facet-row');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.getAttribute('data-facet-name')).toBe('wording');
  });
});

describe('ProposalFacetBreakdown — structural sub-kind renders synthetic "proposal" chip', () => {
  it('decompose renders one chip with data-facet-name="proposal" and "Proposal" label', () => {
    const proposal: ProposalPayload = {
      kind: 'decompose',
      parent_node_id: NODE_X,
      components: [
        { wording: 'first', classification: 'fact' },
        { wording: 'second', classification: 'fact' },
      ],
    };
    render(
      <ProposalFacetBreakdown
        row={row(proposal)}
        facetStatusIndex={EMPTY_INDEX}
        serverPerFacetStatus={undefined}
      />,
    );
    const chips = screen.getAllByTestId('proposal-facet-row');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.getAttribute('data-facet-name')).toBe('proposal');
    expect(chips[0]?.textContent).toBe('Proposal');
  });

  it('axiom-mark renders one chip with data-facet-name="proposal"', () => {
    const proposal: ProposalPayload = {
      kind: 'axiom-mark',
      node_id: NODE_X,
      participant: PARTICIPANT_A,
    };
    render(
      <ProposalFacetBreakdown
        row={row(proposal)}
        facetStatusIndex={EMPTY_INDEX}
        serverPerFacetStatus={undefined}
      />,
    );
    const chips = screen.getAllByTestId('proposal-facet-row');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.getAttribute('data-facet-name')).toBe('proposal');
  });
});

describe('ProposalFacetBreakdown — per-status className mirrors PILL_STATUS_CLASSNAME', () => {
  // Decision §3 drift guard — every FacetStatus value's className on the
  // sidebar chip equals the corresponding `<FacetPill>` className. If a
  // future state-styling refinement shifts the graph pill branches
  // without the sidebar following, this matrix fails and the drift
  // surfaces in CI.
  const statuses: FacetStatus[] = [
    'proposed',
    'agreed',
    'disputed',
    'meta-disagreement',
    'committed',
    'withdrawn',
  ];

  for (const status of statuses) {
    it(`status="${status}" chip className matches PILL_STATUS_CLASSNAME["${status}"]`, () => {
      const proposal: ProposalPayload = {
        kind: 'classify-node',
        node_id: NODE_X,
        classification: 'fact',
      };
      // Pin the chip status by providing a server frame.
      const server: Record<string, string> = { classification: status };
      render(
        <ProposalFacetBreakdown
          row={row(proposal)}
          facetStatusIndex={EMPTY_INDEX}
          serverPerFacetStatus={server}
        />,
      );
      const chip = screen.getByTestId('proposal-facet-row');
      expect(chip.getAttribute('data-facet-status')).toBe(status);
      const expected = `${PILL_BASE_CLASSNAME} ${PILL_STATUS_CLASSNAME[status]}`;
      expect(chip.getAttribute('class')).toBe(expected);
    });
  }
});

describe('ProposalFacetBreakdown — server perFacetStatus precedence', () => {
  it('when server perFacetStatus carries the facet, the chip reflects the server value (not the client mirror)', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    // Client mirror says "agreed"; server frame says "disputed" — the
    // chip must reflect the server frame.
    const clientIndex = indexWith('node', NODE_X, 'classification', 'agreed');
    const server: Record<string, string> = { classification: 'disputed' };
    render(
      <ProposalFacetBreakdown
        row={row(proposal)}
        facetStatusIndex={clientIndex}
        serverPerFacetStatus={server}
      />,
    );
    const chip = screen.getByTestId('proposal-facet-row');
    expect(chip.getAttribute('data-facet-status')).toBe('disputed');
  });

  it('when no server frame and no client mirror, the chip defaults to "proposed"', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    render(
      <ProposalFacetBreakdown
        row={row(proposal)}
        facetStatusIndex={EMPTY_INDEX}
        serverPerFacetStatus={undefined}
      />,
    );
    const chip = screen.getByTestId('proposal-facet-row');
    expect(chip.getAttribute('data-facet-status')).toBe('proposed');
  });
});

describe('ProposalFacetBreakdown — container test-seam', () => {
  it("the container carries data-proposal-id matching the row's proposalEventId", () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    render(
      <ProposalFacetBreakdown
        row={row(proposal, PROPOSAL_P)}
        facetStatusIndex={EMPTY_INDEX}
        serverPerFacetStatus={undefined}
      />,
    );
    const container = screen.getByTestId('proposal-facet-breakdown');
    expect(container.getAttribute('data-proposal-id')).toBe(PROPOSAL_P);
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_vote_indicators_in_sidebar.md
//
// Each chip now hosts an inline row of per-participant `<VoteIndicator>`
// dots when the projected `votesByFacetIndex` carries one or more votes
// for the chip's `(entityId, facet)` pair. The chip's existing
// `data-testid` / `data-facet-name` / `data-facet-status` attributes are
// unchanged — the indicator row is purely additive. These cases pin:
//   (a) empty votes → no indicator-row container;
//   (b) one vote → one `<VoteIndicator>` inside the chip;
//   (c) three mixed votes → three indicators with distinct `data-choice`;
//   (d) the row carries `data-testid="proposal-facet-vote-indicator-row"`;
//   (e) per-participant ring color matches the graph `<VoteIndicator>`
//       for the same `participantId` (cross-surface consistency
//       drift-guard — Decision §2);
//   (f) chip seams (`data-testid="proposal-facet-row"`, `-facet-name`,
//       `-facet-status`) are preserved (Acceptance criteria).
describe('ProposalFacetBreakdown — per-participant vote indicators', () => {
  it('renders no indicator row when the chip has no votes', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    render(
      <ProposalFacetBreakdown
        row={row(proposal)}
        facetStatusIndex={EMPTY_INDEX}
        serverPerFacetStatus={undefined}
        votesByFacetIndex={new Map()}
      />,
    );
    // The chip is still present.
    expect(screen.getByTestId('proposal-facet-row')).toBeTruthy();
    // But the indicator row is omitted entirely (no empty container).
    expect(screen.queryByTestId('proposal-facet-vote-indicator-row')).toBeNull();
  });

  it('renders one VoteIndicator inside the chip for a single vote', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const votes: readonly Vote[] = [{ participantId: PARTICIPANT_A, choice: 'agree' }];
    render(
      <ProposalFacetBreakdown
        row={row(proposal)}
        facetStatusIndex={EMPTY_INDEX}
        serverPerFacetStatus={undefined}
        votesByFacetIndex={votesIndexWith(NODE_X, 'classification', votes)}
      />,
    );
    const chip = screen.getByTestId('proposal-facet-row');
    // The indicator row mounts inside the chip span.
    const indicatorRow = screen.getByTestId('proposal-facet-vote-indicator-row');
    expect(chip.contains(indicatorRow)).toBe(true);
    // Exactly one indicator, carrying the cross-surface sentinel.
    const indicators = chip.querySelectorAll('[data-vote-indicator]');
    expect(indicators).toHaveLength(1);
    expect(indicators[0]?.getAttribute('data-participant-id')).toBe(PARTICIPANT_A);
    expect(indicators[0]?.getAttribute('data-choice')).toBe('agree');
  });

  it('renders three indicators in arrival order with distinct data-choice values', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const votes: readonly Vote[] = [
      { participantId: PARTICIPANT_A, choice: 'agree' },
      { participantId: PARTICIPANT_B, choice: 'dispute' },
      { participantId: PARTICIPANT_C, choice: 'withdraw' },
    ];
    render(
      <ProposalFacetBreakdown
        row={row(proposal)}
        facetStatusIndex={EMPTY_INDEX}
        serverPerFacetStatus={undefined}
        votesByFacetIndex={votesIndexWith(NODE_X, 'classification', votes)}
      />,
    );
    const chip = screen.getByTestId('proposal-facet-row');
    const indicators = chip.querySelectorAll('[data-vote-indicator]');
    expect(indicators).toHaveLength(3);
    // Arrival order is preserved through the projection → selector →
    // render chain.
    expect(Array.from(indicators).map((el) => el.getAttribute('data-participant-id'))).toEqual([
      PARTICIPANT_A,
      PARTICIPANT_B,
      PARTICIPANT_C,
    ]);
    expect(Array.from(indicators).map((el) => el.getAttribute('data-choice'))).toEqual([
      'agree',
      'dispute',
      'withdraw',
    ]);
  });

  it('renders the indicator row on a set-edge-substance chip (Decision §4)', () => {
    // The sidebar surface renders an edge-substance proposal as one
    // chip; the projection now buckets edge-keyed votes too. The chip
    // hosts the indicator row identically to a node-keyed chip.
    const proposal: ProposalPayload = {
      kind: 'set-edge-substance',
      edge_id: EDGE_E,
      value: 'agreed',
    };
    const votes: readonly Vote[] = [{ participantId: PARTICIPANT_A, choice: 'agree' }];
    render(
      <ProposalFacetBreakdown
        row={row(proposal)}
        facetStatusIndex={EMPTY_INDEX}
        serverPerFacetStatus={undefined}
        votesByFacetIndex={votesIndexWith(EDGE_E, 'substance', votes)}
      />,
    );
    const chip = screen.getByTestId('proposal-facet-row');
    expect(chip.getAttribute('data-facet-name')).toBe('substance');
    const indicators = chip.querySelectorAll('[data-vote-indicator]');
    expect(indicators).toHaveLength(1);
    expect(indicators[0]?.getAttribute('data-participant-id')).toBe(PARTICIPANT_A);
  });

  it('structural sub-kind chips (synthetic "proposal" entry) never grow an indicator row', () => {
    // Decision §5 — even if the index happened to carry votes under the
    // structural proposal's node id, the synthetic `'proposal'` chip
    // emits `EMPTY_VOTES` and the indicator row is omitted.
    const proposal: ProposalPayload = {
      kind: 'axiom-mark',
      node_id: NODE_X,
      participant: PARTICIPANT_A,
    };
    const votes: readonly Vote[] = [{ participantId: PARTICIPANT_A, choice: 'agree' }];
    render(
      <ProposalFacetBreakdown
        row={row(proposal)}
        facetStatusIndex={EMPTY_INDEX}
        serverPerFacetStatus={undefined}
        votesByFacetIndex={votesIndexWith(NODE_X, 'classification', votes)}
      />,
    );
    expect(screen.getByTestId('proposal-facet-row').getAttribute('data-facet-name')).toBe(
      'proposal',
    );
    expect(screen.queryByTestId('proposal-facet-vote-indicator-row')).toBeNull();
  });

  it('cross-surface ring-color parity: same participant renders the same ring class on the sidebar and on a standalone graph VoteIndicator', () => {
    // Decision §2 drift-guard. The sidebar mounts the same
    // `<VoteIndicator>` the graph pill mounts; the rendered DOM for the
    // same `(participantId, choice)` prop pair must be identical
    // class-string-wise on both surfaces (since the component imports
    // `axiomMarkColorFor(participantId)` and switches on `choice`
    // through the same map). Render a standalone `<VoteIndicator>` and
    // compare its className to the sidebar's in-chip indicator.
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const votes: readonly Vote[] = [{ participantId: PARTICIPANT_A, choice: 'agree' }];
    const { unmount } = render(
      <ProposalFacetBreakdown
        row={row(proposal)}
        facetStatusIndex={EMPTY_INDEX}
        serverPerFacetStatus={undefined}
        votesByFacetIndex={votesIndexWith(NODE_X, 'classification', votes)}
      />,
    );
    const sidebarIndicator = screen
      .getByTestId('proposal-facet-row')
      .querySelector('[data-vote-indicator]');
    const sidebarClass = sidebarIndicator?.getAttribute('class');
    expect(sidebarClass).toBeTruthy();
    unmount();
    cleanup();
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="agree" />);
    const standaloneIndicator = document.querySelector('[data-vote-indicator]');
    expect(standaloneIndicator?.getAttribute('class')).toBe(sidebarClass);
  });

  it('preserves the chip seam attributes (data-testid / data-facet-name / data-facet-status) when an indicator row is present', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const votes: readonly Vote[] = [{ participantId: PARTICIPANT_A, choice: 'agree' }];
    const server: Record<string, string> = { classification: 'disputed' };
    render(
      <ProposalFacetBreakdown
        row={row(proposal)}
        facetStatusIndex={EMPTY_INDEX}
        serverPerFacetStatus={server}
        votesByFacetIndex={votesIndexWith(NODE_X, 'classification', votes)}
      />,
    );
    const chip = screen.getByTestId('proposal-facet-row');
    expect(chip.getAttribute('data-facet-name')).toBe('classification');
    expect(chip.getAttribute('data-facet-status')).toBe('disputed');
    // Class-name preserved per the existing drift guard (status-only
    // mapping, the indicator row is appended inside the chip but the
    // chip's outer className is unchanged).
    const expected = `${PILL_BASE_CLASSNAME} ${PILL_STATUS_CLASSNAME.disputed}`;
    expect(chip.getAttribute('class')).toBe(expected);
  });
});
