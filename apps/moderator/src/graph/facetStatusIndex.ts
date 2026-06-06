// `deriveFacetStatusIndex` — the merged per-`(entityKind, entityId,
// facet)` status index the pending-proposals pane (and the commit chord)
// feed into the commit-gate predicate.
//
// Refinement:
//   tasks/refinements/moderator-ui/mod_proposal_selection_commit_chord.md
//
// Extracted verbatim from `<PendingProposalsPane>`'s inline `useMemo`
// merge so the keyboard commit chord computes the EXACT same gate input
// the row's commit button does — the button and the chord cannot drift
// (Decision §3). The merge rule (unchanged from the pane):
//
//   - Start from the pure event-log derivation
//     (`computeFacetStatuses(events)`), which also carries the
//     annotation facets the broadcast omits.
//   - When the shell store's broadcast-derived
//     `pendingProposalFacetStatus` cell-map is non-empty, overlay it per
//     `(entityKind, entityId, facet)` cell — broadcast wins where both
//     are present.
//   - The broadcast adapter (`buildFacetStatusIndexFromBroadcast`)
//     carries node + edge facets only; the events-derived annotation
//     bucket passes through unchanged.

import type { Event } from '@a-conversa/shared-types';
import {
  buildFacetStatusIndexFromBroadcast,
  computeFacetStatuses,
  type FacetStatus,
  type FacetStatusIndex,
} from '@a-conversa/shell';

/**
 * Merge the event-log-derived facet-status index with the shell store's
 * broadcast-derived per-cell status map. Pure: no closure over time, no
 * `Date.now()`. The pane memoizes the call on `[events,
 * pendingProposalFacetStatus]`; the commit chord reads both fresh via
 * `getState()` at invocation.
 *
 * @param events The session's event log.
 * @param pendingProposalFacetStatus The shell store's broadcast cell-map
 *   (`sessionState[sessionId].pendingProposalFacetStatus`), or
 *   `undefined` in the pre-seed / unit-test window.
 */
export function deriveFacetStatusIndex(
  events: readonly Event[],
  pendingProposalFacetStatus: ReadonlyMap<string, FacetStatus> | undefined,
): FacetStatusIndex {
  const eventsBased = computeFacetStatuses(events);
  const broadcastIndex =
    pendingProposalFacetStatus === undefined || pendingProposalFacetStatus.size === 0
      ? null
      : buildFacetStatusIndexFromBroadcast(pendingProposalFacetStatus);
  if (broadcastIndex === null) return eventsBased;
  const mergedNodes = new Map(eventsBased.nodes);
  for (const [id, cells] of broadcastIndex.nodes) {
    const existing = mergedNodes.get(id);
    mergedNodes.set(id, existing ? { ...existing, ...cells } : cells);
  }
  const mergedEdges = new Map(eventsBased.edges);
  for (const [id, cells] of broadcastIndex.edges) {
    const existing = mergedEdges.get(id);
    mergedEdges.set(id, existing ? { ...existing, ...cells } : cells);
  }
  // The broadcast carries no annotation facets, so the events-derived
  // annotation statuses pass through the merge unchanged.
  return {
    nodes: mergedNodes,
    edges: mergedEdges,
    annotations: eventsBased.annotations,
  };
}
