// Tests for `useFlashStore` — the transient entity-flash channel.
//
// Refinement: tasks/refinements/moderator-ui/mod_history_click_to_flash.md
//             (Acceptance §10, Constraint §11)
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// Per ADR 0022 these are committed Vitest cases. They pin the store's
// `flash` / `clear` semantics: `flash(ids)` sets exactly those ids and
// advances the nonce; a second `flash` replaces (no accumulation);
// `clear` empties the set.

import { beforeEach, describe, expect, it } from 'vitest';

import { useFlashStore } from './flashStore';

beforeEach(() => {
  useFlashStore.setState({ flashingIds: new Set<string>(), flashNonce: 0 });
});

describe('useFlashStore', () => {
  it('flash(ids) sets flashingIds to exactly those ids and advances flashNonce by 1', () => {
    useFlashStore.getState().flash(['n1', 'e1']);
    const state = useFlashStore.getState();
    expect([...state.flashingIds].sort()).toEqual(['e1', 'n1']);
    expect(state.flashingIds.has('n1')).toBe(true);
    expect(state.flashingIds.has('e1')).toBe(true);
    expect(state.flashNonce).toBe(1);
  });

  it('a second flash REPLACES the set (no accumulation) and advances the nonce again', () => {
    useFlashStore.getState().flash(['n1', 'n2']);
    useFlashStore.getState().flash(['n3']);
    const state = useFlashStore.getState();
    expect([...state.flashingIds]).toEqual(['n3']);
    expect(state.flashingIds.has('n1')).toBe(false);
    expect(state.flashNonce).toBe(2);
  });

  it('flashing an empty list clears the set while still advancing the nonce', () => {
    useFlashStore.getState().flash(['n1']);
    useFlashStore.getState().flash([]);
    const state = useFlashStore.getState();
    expect(state.flashingIds.size).toBe(0);
    expect(state.flashNonce).toBe(2);
  });

  it('clear() empties flashingIds (and does not touch the nonce)', () => {
    useFlashStore.getState().flash(['n1', 'e1']);
    const nonceBeforeClear = useFlashStore.getState().flashNonce;
    useFlashStore.getState().clear();
    const state = useFlashStore.getState();
    expect(state.flashingIds.size).toBe(0);
    expect(state.flashNonce).toBe(nonceBeforeClear);
  });
});
