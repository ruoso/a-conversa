// Tests for `selectMostRecentlyActiveEntity` — the pure derivation
// selector that picks the most-recently-active entity (node or
// annotation) from the selection store's state.
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_capture_auto_suggest.md
// Predecessor: tasks/refinements/moderator-ui/mod_target_auto_suggest.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// The selector pins the load-bearing "what counts as active?" rule for
// the auto-suggest target chip and future capture-flow tasks that need
// the same derivation.

import { describe, expect, it } from 'vitest';

import { selectMostRecentlyActiveEntity } from './recentlyActiveNode.js';
import type { SelectionState } from './selectionStore.js';

function makeState(selected: SelectionState['selected']): SelectionState {
  return {
    selected,
    select: () => {
      /* noop */
    },
    clear: () => {
      /* noop */
    },
  };
}

describe('selectMostRecentlyActiveEntity', () => {
  it('returns null when nothing is selected', () => {
    expect(selectMostRecentlyActiveEntity(makeState(null))).toBeNull();
  });

  it('returns { kind: "node", id } when a node is selected', () => {
    expect(selectMostRecentlyActiveEntity(makeState({ kind: 'node', id: 'n-1' }))).toEqual({
      kind: 'node',
      id: 'n-1',
    });
  });

  it('returns null when an edge is selected', () => {
    expect(selectMostRecentlyActiveEntity(makeState({ kind: 'edge', id: 'e-1' }))).toBeNull();
  });

  it('returns { kind: "annotation", id } when an annotation is selected', () => {
    expect(selectMostRecentlyActiveEntity(makeState({ kind: 'annotation', id: 'a-1' }))).toEqual({
      kind: 'annotation',
      id: 'a-1',
    });
  });
});
