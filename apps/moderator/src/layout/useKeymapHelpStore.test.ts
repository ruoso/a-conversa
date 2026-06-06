// Tests for `useKeymapHelpStore` — the module-scoped Zustand slice that
// gates the `?`-toggled keymap-help overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_keymap_help_overlay.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//   (a) `open()` sets `isOpen` true and is an idempotent no-op when
//       already open,
//   (b) `close()` sets it false and is an idempotent no-op when already
//       closed,
//   (c) `toggle()` flips,
//   (d) `reset` returns to closed.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetKeymapHelpStore, useKeymapHelpStore } from './useKeymapHelpStore';

beforeEach(() => {
  resetKeymapHelpStore();
});

afterEach(() => {
  resetKeymapHelpStore();
});

describe('useKeymapHelpStore', () => {
  it('initial state has isOpen === false', () => {
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
  });

  it('(a) open() sets isOpen true; a second open() is a reference-stable no-op', () => {
    useKeymapHelpStore.getState().open();
    expect(useKeymapHelpStore.getState().isOpen).toBe(true);
    const after1 = useKeymapHelpStore.getState();
    useKeymapHelpStore.getState().open();
    const after2 = useKeymapHelpStore.getState();
    expect(after2.isOpen).toBe(true);
    // Identity check: the no-op branch returns the same `state` object
    // so subscribers observe no spurious update.
    expect(after2).toBe(after1);
  });

  it('(b) close() sets isOpen false; a close() while already closed is a reference-stable no-op', () => {
    useKeymapHelpStore.getState().open();
    useKeymapHelpStore.getState().close();
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
    const before = useKeymapHelpStore.getState();
    useKeymapHelpStore.getState().close();
    const after = useKeymapHelpStore.getState();
    expect(after.isOpen).toBe(false);
    expect(after).toBe(before);
  });

  it('(c) toggle() flips isOpen on each call', () => {
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
    useKeymapHelpStore.getState().toggle();
    expect(useKeymapHelpStore.getState().isOpen).toBe(true);
    useKeymapHelpStore.getState().toggle();
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
  });

  it('(d) reset returns the slice to closed', () => {
    useKeymapHelpStore.getState().open();
    expect(useKeymapHelpStore.getState().isOpen).toBe(true);
    resetKeymapHelpStore();
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
  });
});
