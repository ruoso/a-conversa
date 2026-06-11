// Client-side derivation of the superseded-node set from a session's
// event log — the visible-graph supersession rule of
// `docs/data-model.md` L276–289: a node is superseded by a SUBSEQUENT
// COMMITTED event of one of three kinds — `decompose` referencing it
// as parent, `interpretive-split` referencing it as parent, or
// `edit-wording` with `edit_kind: 'restructure'` referencing it as the
// old node. Superseded nodes (and, per surface, their incident edges
// by the missing-endpoint rule) are omitted from the rendered graph;
// the underlying events stay in the immutable log (ADR 0021) so
// non-canvas consumers (change history, provenance chains) keep full
// access to the node's data.
//
// Extracted verbatim-in-behaviour from `packages/graph-view`'s
// `projectGraph` walk (the donor implementation) so the moderator,
// participant, and audience/replay surfaces share ONE implementation
// of the rule. No wire emission exists for supersession by design —
// the commit event plus the proposal envelope (both already consumed
// by every projector) determine the superseded node in one lookup,
// and only derivation corrects already-recorded event logs on the
// replay surface.
//
// Refinement: tasks/refinements/moderator-ui/mod_decompose_split_parent_visibility.md
// ADRs:
//   - 0047 (parent supersession reaches the canvases by client-side
//           derivation from the commit event, not wire emission —
//           the seam decision this module implements);
//   - 0043 (`@a-conversa/shell` as the home for client-side
//           projection-family logic with multiple surface consumers);
//   - 0027 (entity / facet layers strictly separate — `entity-removed`
//           stays scoped to withdrawals; supersession is a separate,
//           derived mechanism);
//   - 0022 (no throwaway verifications — pinned by
//           `supersession.test.ts`).

import type { Event } from '@a-conversa/shared-types';

/**
 * Walk an event-log prefix and return the set of node ids superseded
 * by a committed structural resolution.
 *
 * Single forward pass:
 *
 * - `proposal` of `decompose` / `interpretive-split` → cache
 *   (envelope id → `parent_node_id`).
 * - `proposal` of `edit-wording` with `edit_kind: 'restructure'` →
 *   cache (envelope id → `node_id`, the OLD node; the `new_node_id`
 *   replacement arrives via its own `node-created`).
 * - `proposal-withdrawn` → clear the cached record; a withdrawn
 *   structural proposal supersedes nothing.
 * - `commit` with `target: 'proposal'` of a cached proposal → the
 *   cached node id joins the superseded set.
 *
 * Pending and rejected proposals never reach the commit arm, so they
 * supersede nothing. The function is a pure function of the prefix —
 * prefix-stable for the replay scrubber: a parent is absent from the
 * set for every prefix ending before its commit event and present for
 * every prefix at/after it.
 */
export function computeSupersededNodeIds(events: readonly Event[]): ReadonlySet<string> {
  // Map from `proposal` envelope id → the node id the proposal would
  // supersede on commit (the parent for decompose / interpretive-split,
  // the old node for restructure).
  const pendingByProposalId = new Map<string, string>();
  const superseded = new Set<string>();
  for (const event of events) {
    if (event.kind === 'proposal') {
      const inner = event.payload.proposal;
      if (inner.kind === 'decompose' || inner.kind === 'interpretive-split') {
        pendingByProposalId.set(event.id, inner.parent_node_id);
      } else if (inner.kind === 'edit-wording' && inner.edit_kind === 'restructure') {
        pendingByProposalId.set(event.id, inner.node_id);
      }
      continue;
    }
    if (event.kind === 'proposal-withdrawn') {
      pendingByProposalId.delete(event.payload.proposal_id);
      continue;
    }
    if (event.kind === 'commit') {
      // Only the proposal-keyed arm resolves a structural proposal; the
      // facet-keyed arm (ADR 0030 §2) carries no `proposal_id` and the
      // three superseding sub-kinds are proposal-keyed on the wire.
      if (event.payload.target !== 'proposal') continue;
      const supersededId = pendingByProposalId.get(event.payload.proposal_id);
      if (supersededId !== undefined) {
        superseded.add(supersededId);
      }
    }
  }
  return superseded;
}
