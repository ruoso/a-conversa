// Pure selector that decodes a pending-proposal payload into the
// per-facet entries the participant proposals-tab row body's breakdown
// strip renders.
//
// Refinement: tasks/refinements/participant-ui/part_per_facet_breakdown_in_pane.md
//
// Port of `apps/moderator/src/graph/proposalFacets.ts`'s
// `derivePerProposalFacets` minus the optional vote-projection
// parameters (per-participant vote indicators are out of scope for this
// leaf — sibling `part_vote_indicators_in_pane` is the home). Decision
// §1 of the refinement covers the port-and-duplicate idiom; the
// per-sub-kind facet map is byte-equivalent to the moderator's so a
// debater who has glanced at the moderator screen reads the same chip
// the same way.
//
// **Pure**: no closure over time, no `Date.now()`, no `Math.random()`.
// Output is a `readonly` array of `{ facet, status, labelKey }` triples.

import type { ProposalPayload } from '@a-conversa/shared-types';
import {
  EMPTY_VOTES,
  EMPTY_VOTES_BY_FACET_INDEX,
  type FacetName,
  type FacetStatus,
  type FacetStatusIndex,
  type Vote,
  type VotesByFacetIndex,
} from '@a-conversa/shell';

import {
  EMPTY_OTHER_VOTES_BY_PROPOSAL_INDEX,
  type OtherVotesByProposalIndex,
} from './otherVotesByProposal';

/**
 * The set of facet names the breakdown can surface. Extends `FacetName`
 * with the synthetic `'proposal'` lifecycle facet that structural
 * sub-kinds (decompose, axiom-mark, etc.) map to.
 */
export type LifecycleFacetName = FacetName | 'proposal';

/**
 * The vote-dispatch target a chip's vote button binds to. The
 * discriminated union mirrors the wire `vote` payload's `target` arm
 * per ADR 0030 §2 + §9: facet-targeting sub-kinds emit the facet arm
 * keyed by `(entity_kind, entity_id, facet)`, structural sub-kinds
 * emit the proposal arm keyed by the structural proposal envelope id.
 *
 * Refinement: `tasks/refinements/participant-ui/part_vote_button_per_facet.md`
 * (Decision §1 — extend the existing selector, single field on every
 * entry, no parallel selector).
 */
export type VoteTarget =
  | {
      readonly kind: 'facet';
      readonly entity_kind: 'node' | 'edge';
      readonly entity_id: string;
      readonly facet: FacetName;
    }
  | {
      readonly kind: 'proposal';
      readonly proposal_id: string;
    };

/**
 * One entry in the breakdown's facet list. The component iterates the
 * selector's output array and renders one chip per entry; the chip's
 * `data-facet-name`, `data-facet-status`, and rendered label all flow
 * from this triple.
 *
 * Mirrors the moderator's `ProposalFacetEntry`. Per
 * `part_vote_indicators_in_pane`, each entry now carries the
 * per-OTHER-voter `Vote[]` the chip's in-line indicator row renders;
 * structural sub-kinds resolve via `votesByProposalIndex`, facet-targeting
 * via `votesByFacetIndex`. Empty when no OTHER votes have landed yet.
 *
 * Per `part_vote_button_per_facet`, each entry also carries a
 * `voteTarget` discriminating between the facet-arm and proposal-arm
 * vote-dispatch shape for the chip's in-place vote buttons.
 */
export interface ProposalFacetEntry {
  readonly facet: LifecycleFacetName;
  readonly status: FacetStatus;
  readonly labelKey: string;
  readonly votes: readonly Vote[];
  readonly voteTarget: VoteTarget;
}

type FacetTarget = {
  readonly entityKind: 'node' | 'edge';
  readonly entityId: string;
  readonly facet: FacetName;
};

/**
 * Decode a `ProposalPayload` to the (entityKind, entityId, facet)
 * triple the proposal targets, OR `null` for structural sub-kinds
 * (which get a synthetic `'proposal'` entry instead).
 *
 * Mirrors the moderator's `facetTargetOf` partition verbatim: four
 * facet-targeting sub-kinds (capture-node + classify-node +
 * set-node-substance + set-edge-substance + edit-wording), seven
 * structural sub-kinds (decompose, interpretive-split, axiom-mark,
 * meta-move, break-edge, amend-node, annotate) returning `null`.
 */
function facetTargetOf(proposal: ProposalPayload): FacetTarget | null {
  switch (proposal.kind) {
    case 'capture-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    case 'classify-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'classification' };
    case 'set-node-substance':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'substance' };
    case 'set-edge-substance':
      return { entityKind: 'edge', entityId: proposal.edge_id, facet: 'substance' };
    case 'edit-wording':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    case 'decompose':
    case 'interpretive-split':
    case 'axiom-mark':
    case 'meta-move':
    case 'break-edge':
    case 'amend-node':
    case 'annotate':
      return null;
    default:
      return null;
  }
}

/**
 * Resolve the per-facet status by precedence: merged-index → `'proposed'`
 * default. Per
 * `tasks/refinements/participant-ui/part_migrate_to_pending_proposal_facet_status.md`
 * D2 — the caller now passes a `FacetStatusIndex` that already merges
 * the broadcast-derived per-entity cell map over the events-derived
 * mirror (broadcast wins per cell), so the three-tier precedence the
 * predecessor `part_per_facet_breakdown_in_pane` shipped collapses to
 * two tiers.
 */
function resolveStatus(
  target: FacetTarget | null,
  facetStatusIndex: FacetStatusIndex,
): FacetStatus {
  if (target) {
    const perEntity =
      target.entityKind === 'node'
        ? facetStatusIndex.nodes.get(target.entityId)
        : facetStatusIndex.edges.get(target.entityId);
    const fromClient = perEntity?.[target.facet];
    if (fromClient) {
      return fromClient;
    }
  }
  return 'proposed';
}

function labelKeyFor(facet: LifecycleFacetName): string {
  return `methodology.facet.${facet}`;
}

/**
 * Derive the per-facet entries for a single pending proposal.
 *
 * @param proposal The proposal payload (the discriminated-union sub-kind).
 * @param facetStatusIndex Merged facet-status index — the pane builds
 *   it from `merge(eventsBasedIndex,
 *   buildFacetStatusIndexFromBroadcast(pendingProposalFacetStatus))`
 *   with broadcast winning per `(entityKind, entityId, facet)` cell
 *   (per
 *   `tasks/refinements/participant-ui/part_migrate_to_pending_proposal_facet_status.md`
 *   D2).
 * @returns The facet entries the breakdown component renders. Always at
 *   least one entry — facet-targeting sub-kinds emit one real facet
 *   entry, structural sub-kinds emit one synthetic `'proposal'` entry.
 */
export function derivePerProposalFacets(
  proposal: ProposalPayload,
  facetStatusIndex: FacetStatusIndex,
  votesByFacetIndex: VotesByFacetIndex = EMPTY_VOTES_BY_FACET_INDEX,
  proposalEventId: string | undefined = undefined,
  votesByProposalIndex: OtherVotesByProposalIndex = EMPTY_OTHER_VOTES_BY_PROPOSAL_INDEX,
): readonly ProposalFacetEntry[] {
  const target = facetTargetOf(proposal);
  if (target) {
    const status = resolveStatus(target, facetStatusIndex);
    const votes = votesByFacetIndex.get(target.entityId)?.get(target.facet) ?? EMPTY_VOTES;
    const voteTarget: VoteTarget = {
      kind: 'facet',
      entity_kind: target.entityKind,
      entity_id: target.entityId,
      facet: target.facet,
    };
    return [
      {
        facet: target.facet,
        status,
        labelKey: labelKeyFor(target.facet),
        votes,
        voteTarget,
      },
    ];
  }
  const status = resolveStatus(null, facetStatusIndex);
  const votes =
    proposalEventId !== undefined
      ? (votesByProposalIndex.get(proposalEventId) ?? EMPTY_VOTES)
      : EMPTY_VOTES;
  const voteTarget: VoteTarget = {
    kind: 'proposal',
    proposal_id: proposalEventId ?? '',
  };
  return [
    {
      facet: 'proposal',
      status,
      labelKey: labelKeyFor('proposal'),
      votes,
      voteTarget,
    },
  ];
}
