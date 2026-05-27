// Pure target-entity selector — maps a `ProposalPayload` to the
// `{ kind, id }` of the graph entity the proposal targets, so the
// arrival-flash machinery (`useNewProposalArrival`) can resolve which
// rendered node / edge should pulse on a fresh proposal arrival.
//
// Refinement: tasks/refinements/participant-ui/part_proposal_notification.md
//              (Decision §2 — the selector covers ALL proposal sub-kinds,
//              not just the facet-targeting subset that
//              `facetTargetOf` already partitions. Structural sub-kinds
//              (decompose, interpretive-split, axiom-mark, meta-move,
//              break-edge, amend-node, annotate) ALSO target a rendered
//              entity; excluding them would silently skip the graph
//              flash for those arrivals.)
// ADRs:
//   - 0030 (per-facet vote keying and 11-arm discriminated union — the
//           per-arm target field set this selector walks).
//
// Naming: `proposalTargetEntity` (not `facetTargetOf`) — the remit is
// the rendered-graph entity for visualization purposes, not the
// facet-keyed vote target the predecessor's selector encodes. The two
// selectors coexist: `facetTargetOf` for vote dispatch (5 facet-
// targeting arms only), `proposalTargetEntity` for flash placement (all
// arms with a renderable target).
//
// The `null` arm is defensive — every current sub-kind has a target,
// but a future zero-target sub-kind (e.g. a session-level meta-move)
// would land here without breaking the consumer (the badge still
// pulses; the graph flash is skipped for that arrival).

import type { ProposalPayload } from '@a-conversa/shared-types';

/**
 * Per-entity flash target. Mirrors the `(kind, id)` tuple shape the
 * Cytoscape element id space uses verbatim.
 */
export interface ProposalTargetEntity {
  readonly kind: 'node' | 'edge';
  readonly id: string;
}

/**
 * Resolve the graph entity the proposal targets, walking the
 * `ProposalPayload` discriminated union. Returns `null` defensively
 * for a future zero-target sub-kind; every current arm produces a
 * `{ kind, id }` tuple.
 */
export function proposalTargetEntity(proposal: ProposalPayload): ProposalTargetEntity | null {
  switch (proposal.kind) {
    case 'capture-node':
      return { kind: 'node', id: proposal.node_id };
    case 'classify-node':
      return { kind: 'node', id: proposal.node_id };
    case 'set-node-substance':
      return { kind: 'node', id: proposal.node_id };
    case 'set-edge-substance':
      return { kind: 'edge', id: proposal.edge_id };
    case 'edit-wording':
      // Both reword + restructure carry the source `node_id`; the
      // restructure arm also mints a `new_node_id` but the existing
      // source node is the rendered entity the participant is looking
      // at (the new node hasn't been emitted yet).
      return { kind: 'node', id: proposal.node_id };
    case 'decompose':
      return { kind: 'node', id: proposal.parent_node_id };
    case 'interpretive-split':
      return { kind: 'node', id: proposal.parent_node_id };
    case 'axiom-mark':
      return { kind: 'node', id: proposal.node_id };
    case 'meta-move':
      return { kind: proposal.target_kind, id: proposal.target_id };
    case 'break-edge':
      return { kind: 'edge', id: proposal.edge_id };
    case 'amend-node':
      return { kind: 'node', id: proposal.node_id };
    case 'annotate':
      return { kind: proposal.target_kind, id: proposal.target_id };
  }
}
