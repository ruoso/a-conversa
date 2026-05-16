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
import type { FacetName, FacetStatus, FacetStatusIndex } from '../graph/facetStatus';
import type { PendingProposalRow } from '../graph/pendingProposals';
import { initI18n } from '../i18n';

const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000c1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const PROPOSAL_P = '00000000-0000-4000-8000-0000000000ff';

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
  await initI18n('en-US');
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
