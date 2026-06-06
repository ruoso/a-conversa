// Tests for `useSelectedProposalStore` — the pending-proposal selection
// slice.
//
// Refinement:
//   tasks/refinements/moderator-ui/mod_proposal_selection_commit_chord.md
//
// Per ADR 0022 these are committed Vitest cases pinning the one-field
// slice's contract: select / clear / replace-on-reselect / reset.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetSelectedProposalStore, useSelectedProposalStore } from './selectedProposalStore';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  resetSelectedProposalStore();
});

afterEach(() => {
  resetSelectedProposalStore();
});

describe('useSelectedProposalStore', () => {
  it('defaults to no selection', () => {
    expect(useSelectedProposalStore.getState().selectedProposalId).toBeNull();
  });

  it('select(id) sets the selected proposal id', () => {
    useSelectedProposalStore.getState().select(P1);
    expect(useSelectedProposalStore.getState().selectedProposalId).toBe(P1);
  });

  it('clear() returns to no selection', () => {
    useSelectedProposalStore.getState().select(P1);
    useSelectedProposalStore.getState().clear();
    expect(useSelectedProposalStore.getState().selectedProposalId).toBeNull();
  });

  it('is single-select — selecting a second id replaces the first', () => {
    useSelectedProposalStore.getState().select(P1);
    useSelectedProposalStore.getState().select(P2);
    expect(useSelectedProposalStore.getState().selectedProposalId).toBe(P2);
  });

  it('resetSelectedProposalStore() restores the default', () => {
    useSelectedProposalStore.getState().select(P1);
    resetSelectedProposalStore();
    expect(useSelectedProposalStore.getState().selectedProposalId).toBeNull();
  });
});
