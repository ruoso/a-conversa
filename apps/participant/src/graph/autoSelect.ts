// Auto-select the entity that a moderator (or any actor) is currently
// "talking about" via a proposal envelope. Replaces the participant
// having to manually tap a node/edge to surface its detail panel in
// response to a moderator gesture.
//
// **Scope: proposal events only.** Proposals are the gesture surface
// (capture / classify / set-substance / decompose / annotate / …). Raw
// `node-created` / `edge-created` events are intentionally NOT included
// here for two reasons:
//
//   1. The proposal envelope is emitted LAST in the propose handler's
//      structural-fan-out (per
//      `apps/server/src/methodology/handlers/propose.ts`), so its
//      target is the principal one — for `capture-node` with an inline
//      edge the edge IS the gesture's substance (the spec walks
//      participants onto the edge for the shape-facet vote), and for
//      `decompose` the parent (not the per-child node-created events)
//      is the conversational focus.
//   2. Restricting to proposals keeps the
//      `participant-graph-render.spec.ts` seam test's
//      "baseline → manual tap → flip" flow intact: that test seeds raw
//      `node-created` / `edge-created` events to verify the tap
//      mechanism, and would otherwise see selection auto-flip away
//      from `data-selected="false"` before the tap.
//
// Returns `null` for non-proposal events (votes, commits, lifecycle,
// raw entity events) so the caller leaves selection untouched on those.

import type { Event, ProposalPayload } from '@a-conversa/shared-types';

import type { Selection } from '../stores/selectionStore';

/**
 * Pick the entity the participant should auto-select for a single
 * proposal payload. The mapping is:
 *
 *   - `capture-node` with `edge` set       → `edge` (the inline edge
 *                                             is the gesture's
 *                                             substance; the new node
 *                                             is its source).
 *   - `capture-node` without `edge`        → the new `node_id`.
 *   - `classify-node` / `set-node-substance`
 *     / `edit-wording` / `amend-node`
 *     / `axiom-mark`                       → the targeted `node_id`.
 *   - `set-edge-substance` / `break-edge`  → the targeted `edge_id`.
 *   - `decompose` / `interpretive-split`   → the `parent_node_id`
 *                                             (the focus of the
 *                                             restructure gesture).
 *   - `meta-move` / `annotate`             → the proposal's declared
 *                                             `{ target_kind, target_id }`.
 */
export function autoSelectionFromProposal(proposal: ProposalPayload): Selection | null {
  switch (proposal.kind) {
    case 'capture-node':
      if (proposal.edge !== undefined) {
        return { kind: 'edge', id: proposal.edge.edge_id };
      }
      return { kind: 'node', id: proposal.node_id };
    case 'classify-node':
    case 'set-node-substance':
    case 'edit-wording':
    case 'amend-node':
    case 'axiom-mark':
      return { kind: 'node', id: proposal.node_id };
    case 'set-edge-substance':
    case 'break-edge':
      return { kind: 'edge', id: proposal.edge_id };
    case 'decompose':
    case 'interpretive-split':
      return { kind: 'node', id: proposal.parent_node_id };
    case 'meta-move':
    case 'annotate':
      return { kind: proposal.target_kind, id: proposal.target_id };
    default:
      return null;
  }
}

/**
 * Pick the entity the participant should auto-select for a single
 * `Event`. Only `proposal`-kinded events contribute; every other kind
 * returns `null` so the caller leaves selection untouched.
 */
export function autoSelectionFromEvent(event: Event): Selection | null {
  if (event.kind !== 'proposal') return null;
  return autoSelectionFromProposal(event.payload.proposal);
}
