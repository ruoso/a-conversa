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

import type { FacetName, FacetStatus, FacetStatusIndex } from '../graph/facetStatus';

/**
 * The set of facet names the breakdown can surface. Extends `FacetName`
 * with the synthetic `'proposal'` lifecycle facet that structural
 * sub-kinds (decompose, axiom-mark, etc.) map to.
 */
export type LifecycleFacetName = FacetName | 'proposal';

/**
 * One entry in the breakdown's facet list. The component iterates the
 * selector's output array and renders one chip per entry; the chip's
 * `data-facet-name`, `data-facet-status`, and rendered label all flow
 * from this triple.
 *
 * Mirrors the moderator's `ProposalFacetEntry` minus the `votes` field
 * (the participant's vote-indicator extension lands in
 * `part_vote_indicators_in_pane`).
 */
export interface ProposalFacetEntry {
  readonly facet: LifecycleFacetName;
  readonly status: FacetStatus;
  readonly labelKey: string;
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

const FACET_STATUS_VALUES: ReadonlySet<string> = new Set<FacetStatus>([
  'proposed',
  'agreed',
  'disputed',
  'committed',
  'withdrawn',
  'meta-disagreement',
  'awaiting-proposal',
]);

function isFacetStatus(value: string): value is FacetStatus {
  return FACET_STATUS_VALUES.has(value);
}

/**
 * Resolve the per-facet status by precedence: server frame → client
 * mirror → `'proposed'` default.
 */
function resolveStatus(
  facet: LifecycleFacetName,
  target: FacetTarget | null,
  facetStatusIndex: FacetStatusIndex,
  serverPerFacetStatus: Record<string, string> | undefined,
): FacetStatus {
  if (serverPerFacetStatus) {
    const fromServer = serverPerFacetStatus[facet];
    if (fromServer && isFacetStatus(fromServer)) {
      return fromServer;
    }
  }
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
 * @param facetStatusIndex Client-side `computeFacetStatuses(events)` output.
 * @param serverPerFacetStatus Per-proposal server-broadcast status map
 *   (from `useWsStore.sessionState[id].pendingProposals[proposalId].perFacetStatus`).
 *   `undefined` when no server frame has landed for this proposal id.
 * @returns The facet entries the breakdown component renders. Always at
 *   least one entry — facet-targeting sub-kinds emit one real facet
 *   entry, structural sub-kinds emit one synthetic `'proposal'` entry.
 */
export function derivePerProposalFacets(
  proposal: ProposalPayload,
  facetStatusIndex: FacetStatusIndex,
  serverPerFacetStatus: Record<string, string> | undefined,
): readonly ProposalFacetEntry[] {
  const target = facetTargetOf(proposal);
  if (target) {
    const status = resolveStatus(target.facet, target, facetStatusIndex, serverPerFacetStatus);
    return [
      {
        facet: target.facet,
        status,
        labelKey: labelKeyFor(target.facet),
      },
    ];
  }
  const status = resolveStatus('proposal', null, facetStatusIndex, serverPerFacetStatus);
  return [
    {
      facet: 'proposal',
      status,
      labelKey: labelKeyFor('proposal'),
    },
  ];
}
