// Pure derivation selector — "most-recently-active entity" from the
// selection store.
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_capture_auto_suggest.md
// Predecessor: tasks/refinements/moderator-ui/mod_target_auto_suggest.md
//
// The rule is: "if `state.selected !== null` AND
// `state.selected.kind !== 'edge'`, return
// `{ kind: state.selected.kind, id: state.selected.id }`; otherwise
// return `null`." Both node selections AND annotation selections count
// as "active" for the auto-suggest target — edges are excluded because
// edges are not valid capture-target endpoints (the staged target is
// the source/target endpoint of a future edge or annotation-edge per
// `docs/moderator-ui.md:45`).
//
// The selector lives in its own file because future capture-flow tasks
// (`mod_decompose_flow`, `mod_capture_defeater`, `mod_axiom_mark_flow`)
// need the same derivation — pinning it as one named function lets
// future consumers reuse the rule rather than each task re-implementing
// "what counts as active?".

import type { SelectionState } from './selectionStore.js';

/**
 * Kind-aware most-recently-active entity, derived from the selection
 * store.
 *
 * Returns `{ kind, id }` for the currently-selected node or annotation,
 * or `null` if nothing is selected OR the selection is an edge (only
 * node + annotation selections count as "active" for auto-suggest
 * purposes — see refinement Decision §1).
 *
 * Pure: depends only on the input state; no side effects.
 */
export function selectMostRecentlyActiveEntity(
  state: SelectionState,
): { kind: 'node' | 'annotation'; id: string } | null {
  if (state.selected === null) return null;
  if (state.selected.kind === 'edge') return null;
  return { kind: state.selected.kind, id: state.selected.id };
}
