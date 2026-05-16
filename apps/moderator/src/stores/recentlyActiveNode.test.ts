// Tests for `selectMostRecentlyActiveNodeId` — the pure derivation
// selector that picks the most-recently-active node id from the
// selection store's state.
//
// Refinement: tasks/refinements/moderator-ui/mod_target_auto_suggest.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// The selector pins the load-bearing "what counts as active?" rule for
// the auto-suggest target chip and future capture-flow tasks that need
// the same derivation.

import { describe, expect, it } from 'vitest';

import { selectMostRecentlyActiveNodeId } from './recentlyActiveNode.js';
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

describe('selectMostRecentlyActiveNodeId', () => {
  it('returns null when nothing is selected', () => {
    expect(selectMostRecentlyActiveNodeId(makeState(null))).toBeNull();
  });

  it('returns the node id when a node is selected', () => {
    expect(selectMostRecentlyActiveNodeId(makeState({ kind: 'node', id: 'n-1' }))).toBe('n-1');
  });

  it('returns null when an edge is selected', () => {
    expect(selectMostRecentlyActiveNodeId(makeState({ kind: 'edge', id: 'e-1' }))).toBeNull();
  });

  it('returns null when an annotation is selected', () => {
    expect(selectMostRecentlyActiveNodeId(makeState({ kind: 'annotation', id: 'a-1' }))).toBeNull();
  });
});
