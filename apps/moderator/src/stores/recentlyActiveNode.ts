// Pure derivation selector — "most-recently-active node id" from the
// selection store.
//
// Refinement: tasks/refinements/moderator-ui/mod_target_auto_suggest.md
//
// The rule is: "if `state.selected !== null` AND
// `state.selected.kind === 'node'`, return `state.selected.id`; otherwise
// return `null`." Only node selections count as "active" for the
// auto-suggest target — edges and annotations are excluded because the
// auto-suggested target is the node-end of a future edge (per
// `docs/moderator-ui.md:45`).
//
// The selector lives in its own file because future capture-flow tasks
// (`mod_decompose_flow`, `mod_capture_defeater`, `mod_axiom_mark_flow`)
// need the same derivation — pinning it as one named function lets
// future consumers reuse the rule rather than each task re-implementing
// "what counts as active?".

import type { SelectionState } from './selectionStore.js';

/**
 * Most-recently-active node id, derived from the selection store.
 *
 * Returns the id of the currently-selected node, or `null` if nothing
 * is selected OR the selection is an edge / annotation (only node
 * selections count as "active" for auto-suggest purposes — see
 * refinement Decision §1).
 *
 * Pure: depends only on the input state; no side effects.
 */
export function selectMostRecentlyActiveNodeId(state: SelectionState): string | null {
  if (state.selected === null) return null;
  if (state.selected.kind !== 'node') return null;
  return state.selected.id;
}
