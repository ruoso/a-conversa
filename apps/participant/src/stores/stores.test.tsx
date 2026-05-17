// Smoke tests for the participant's local-state Zustand stores.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md
//
// Covers the acceptance criteria the refinement spells out:
//   1. Each of the three local-UI slices (`useVoteStore`,
//      `useSelectionStore`, `useUiStore`) can be read and mutated via
//      its setters.
//   2. A trivial React component subscribed to each store re-renders
//      on an update (the moderator's `mod_state_management` AC §3
//      mirror — pinned in the test layer per Decision §7 of this
//      refinement instead of via production wiring).
//   3. The UI store clamps zoom to the documented bounds.
//   4. The vote store's per-`(proposalId, facetId)` map handles
//      first-vote, change-vote, remove, and reset.
//
// Per ADR 0022 these are committed tests, not throwaway probes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import {
  MAX_ZOOM,
  MIN_ZOOM,
  useSelectionStore,
  useUiStore,
  useVoteStore,
  voteKey,
} from './index.js';

// Capture the pristine snapshot of each store's state at module load
// time, so individual tests can reset between cases without each having
// to spell out every default. Zustand stores hold their state outside
// React, so leaking state across tests would silently couple them.
const voteInitial = useVoteStore.getState();
const selectionInitial = useSelectionStore.getState();
const uiInitial = useUiStore.getState();

const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const PROPOSAL_B = '00000000-0000-4000-8000-0000000000a2';
const FACET_A = '00000000-0000-4000-8000-0000000000b1';
const FACET_B = '00000000-0000-4000-8000-0000000000b2';

beforeEach(() => {
  useVoteStore.setState(voteInitial, true);
  useSelectionStore.setState(selectionInitial, true);
  useUiStore.setState(uiInitial, true);
});

afterEach(() => {
  cleanup();
});

describe('useVoteStore', () => {
  it('starts with empty votes', () => {
    expect(useVoteStore.getState().votes).toEqual({});
  });

  it('setVote writes the key and getVote reads it back', () => {
    useVoteStore.getState().setVote(PROPOSAL_A, FACET_A, 'agree');
    expect(useVoteStore.getState().votes[voteKey(PROPOSAL_A, FACET_A)]).toBe('agree');
    expect(useVoteStore.getState().getVote(PROPOSAL_A, FACET_A)).toBe('agree');
  });

  it('setVote overwrites in place — the change-vote pre-commit path', () => {
    useVoteStore.getState().setVote(PROPOSAL_A, FACET_A, 'agree');
    useVoteStore.getState().setVote(PROPOSAL_A, FACET_A, 'dispute');
    expect(useVoteStore.getState().getVote(PROPOSAL_A, FACET_A)).toBe('dispute');
    // Only one entry — overwrite, not append.
    expect(Object.keys(useVoteStore.getState().votes)).toHaveLength(1);
  });

  it('removeVote clears the key; removeVote on an absent key is a no-op (same state ref)', () => {
    useVoteStore.getState().setVote(PROPOSAL_A, FACET_A, 'agree');
    useVoteStore.getState().removeVote(PROPOSAL_A, FACET_A);
    expect(useVoteStore.getState().getVote(PROPOSAL_A, FACET_A)).toBeUndefined();
    expect(useVoteStore.getState().votes).toEqual({});

    // No-op path: a remove for an absent key must NOT replace the
    // `votes` object reference (the early-exit branch in the reducer).
    const before = useVoteStore.getState().votes;
    useVoteStore.getState().removeVote(PROPOSAL_B, FACET_B);
    const after = useVoteStore.getState().votes;
    expect(after).toBe(before);
  });

  it('reset clears all pending votes', () => {
    useVoteStore.getState().setVote(PROPOSAL_A, FACET_A, 'agree');
    useVoteStore.getState().setVote(PROPOSAL_B, FACET_B, 'dispute');
    expect(Object.keys(useVoteStore.getState().votes)).toHaveLength(2);
    useVoteStore.getState().reset();
    expect(useVoteStore.getState().votes).toEqual({});
  });
});

describe('useSelectionStore', () => {
  it('starts with nothing selected', () => {
    expect(useSelectionStore.getState().selected).toBeNull();
  });

  it('select() stores the selection and clear() resets it', () => {
    useSelectionStore.getState().select({ kind: 'node', id: 'node-42' });
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'node', id: 'node-42' });
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().selected).toBeNull();
  });
});

describe('useUiStore', () => {
  it('starts with graph tab foregrounded and zoom 1', () => {
    const state = useUiStore.getState();
    expect(state.currentTab).toBe('graph');
    expect(state.zoom).toBe(1);
  });

  it('setCurrentTab() switches the visible tab', () => {
    useUiStore.getState().setCurrentTab('proposals');
    expect(useUiStore.getState().currentTab).toBe('proposals');
  });

  it('setZoom() clamps to the documented bounds (and maps NaN → 1)', () => {
    useUiStore.getState().setZoom(MAX_ZOOM + 10);
    expect(useUiStore.getState().zoom).toBe(MAX_ZOOM);
    useUiStore.getState().setZoom(MIN_ZOOM - 0.5);
    expect(useUiStore.getState().zoom).toBe(MIN_ZOOM);
    useUiStore.getState().setZoom(Number.NaN);
    expect(useUiStore.getState().zoom).toBe(1);
  });
});

describe('React components re-render on store updates', () => {
  function VoteProbe(): ReactElement {
    const votes = useVoteStore((state) => state.votes);
    const entries = Object.entries(votes)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return <span data-testid="probe-vote">{entries || 'none'}</span>;
  }

  function SelectionProbe(): ReactElement {
    const selected = useSelectionStore((state) => state.selected);
    return (
      <span data-testid="probe-selection">
        {selected ? `${selected.kind}:${selected.id}` : 'none'}
      </span>
    );
  }

  function UiProbe(): ReactElement {
    const currentTab = useUiStore((state) => state.currentTab);
    return <span data-testid="probe-ui">{currentTab}</span>;
  }

  it('a component subscribed to useVoteStore re-renders when setVote fires', () => {
    render(<VoteProbe />);
    expect(screen.getByTestId('probe-vote').textContent).toBe('none');
    act(() => {
      useVoteStore.getState().setVote(PROPOSAL_A, FACET_A, 'agree');
    });
    expect(screen.getByTestId('probe-vote').textContent).toBe(
      `${voteKey(PROPOSAL_A, FACET_A)}=agree`,
    );
  });

  it('a component subscribed to useSelectionStore re-renders when select fires', () => {
    render(<SelectionProbe />);
    expect(screen.getByTestId('probe-selection').textContent).toBe('none');
    act(() => {
      useSelectionStore.getState().select({ kind: 'edge', id: 'edge-7' });
    });
    expect(screen.getByTestId('probe-selection').textContent).toBe('edge:edge-7');
  });

  it('a component subscribed to useUiStore re-renders when setCurrentTab fires', () => {
    render(<UiProbe />);
    expect(screen.getByTestId('probe-ui').textContent).toBe('graph');
    act(() => {
      useUiStore.getState().setCurrentTab('proposals');
    });
    expect(screen.getByTestId('probe-ui').textContent).toBe('proposals');
  });
});
