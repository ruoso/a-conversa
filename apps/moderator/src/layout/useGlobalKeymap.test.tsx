// Tests for `useGlobalKeymap` — the moderator's document-level
// action-chord dispatcher.
//
// Refinement: tasks/refinements/moderator-ui/mod_global_keymap.md
//
// Per ADR 0022 these are committed Vitest cases. They are the snapshot
// binding cases migrated from the retired `useSnapshotShortcut.test.tsx`
// (the binding behaviour is preserved byte-for-byte through the
// consolidation) plus the deferral pin for the commit chord:
//   (a) Cmd+S on a macOS-shaped event calls open(),
//   (b) Ctrl+S on a non-macOS-shaped event calls open(),
//   (c) bare `s` (no modifier) does NOT call open(),
//   (d) Cmd+Shift+S (shift allowed) STILL calls open(),
//   (e) preventDefault() is invoked on match,
//   (f) event.repeat === true is ignored,
//   (g) the listener detaches on unmount,
//   (h) editable-target focus does NOT bail (open() fires even when
//       an <input> is the active element — universal Cmd+S semantics),
//   (i) Cmd/Ctrl+Shift+Enter (the commit chord, now live per
//       `mod_proposal_selection_commit_chord`):
//         (i1) invokes the registered `useCommitChordStore` `run`
//              callback (spy fired, preventDefault called, repeat
//              ignored);
//         (i2) is a safe no-op when no `run` is registered (no throw).
//       The whole suite runs with NO `<WsClientProvider>` — the
//       dispatcher stays context-free (Decision §2).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { act, type ReactElement } from 'react';

import { resetSnapshotFlowStore, useSnapshotFlowStore } from './useSnapshotFlowStore';
import { resetCommitChordStore, useCommitChordStore } from './useCommitChordStore';
import { useGlobalKeymap } from './useGlobalKeymap';

function HookProbe(): ReactElement {
  useGlobalKeymap();
  return <span data-testid="hook-probe" />;
}

/**
 * Stub `navigator.platform` for the duration of a single test so the
 * dispatcher's mac-vs-other branch resolves deterministically. Returns
 * a restore function to call in cleanup.
 */
function stubPlatform(platform: string): () => void {
  const nav = globalThis.navigator;
  const prior = Object.getOwnPropertyDescriptor(nav, 'platform');
  Object.defineProperty(nav, 'platform', { value: platform, configurable: true });
  return () => {
    if (prior !== undefined) {
      Object.defineProperty(nav, 'platform', prior);
    } else {
      // Roll the per-instance override off so the test runner's
      // prototype-default takes over again.
      delete (nav as unknown as Record<string, unknown>).platform;
    }
  };
}

function dispatchKeyDown(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  resetSnapshotFlowStore();
  resetCommitChordStore();
});

afterEach(() => {
  cleanup();
  resetSnapshotFlowStore();
  resetCommitChordStore();
});

describe('useGlobalKeymap — snapshot, macOS branch (Cmd+S)', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = stubPlatform('MacIntel');
  });
  afterEach(() => {
    restore();
  });

  it('(a) Cmd+S on a macOS-shaped event calls open()', () => {
    render(<HookProbe />);
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
    act(() => {
      dispatchKeyDown({ key: 's', metaKey: true });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
  });

  it('(d) Cmd+Shift+S still calls open() — shift is allowed', () => {
    render(<HookProbe />);
    act(() => {
      dispatchKeyDown({ key: 'S', metaKey: true, shiftKey: true });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
  });

  it('(e) preventDefault() is invoked on match', () => {
    render(<HookProbe />);
    let event!: KeyboardEvent;
    act(() => {
      event = dispatchKeyDown({ key: 's', metaKey: true });
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('Ctrl+S on macOS (wrong modifier) does NOT call open()', () => {
    render(<HookProbe />);
    act(() => {
      dispatchKeyDown({ key: 's', ctrlKey: true });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
  });
});

describe('useGlobalKeymap — snapshot, non-macOS branch (Ctrl+S)', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = stubPlatform('Win32');
  });
  afterEach(() => {
    restore();
  });

  it('(b) Ctrl+S on a non-macOS-shaped event calls open()', () => {
    render(<HookProbe />);
    act(() => {
      dispatchKeyDown({ key: 's', ctrlKey: true });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
  });

  it('Cmd+S on Windows (metaKey = Windows key) does NOT call open()', () => {
    render(<HookProbe />);
    act(() => {
      dispatchKeyDown({ key: 's', metaKey: true });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
  });

  it('Ctrl+Shift+S still calls open() — shift is allowed', () => {
    render(<HookProbe />);
    act(() => {
      dispatchKeyDown({ key: 'S', ctrlKey: true, shiftKey: true });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
  });
});

describe('useGlobalKeymap — snapshot no-match bails', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = stubPlatform('Win32');
  });
  afterEach(() => {
    restore();
  });

  it('(c) bare `s` (no modifier) does NOT call open()', () => {
    render(<HookProbe />);
    act(() => {
      dispatchKeyDown({ key: 's' });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
  });

  it('Ctrl+A does NOT call open() (wrong key)', () => {
    render(<HookProbe />);
    act(() => {
      dispatchKeyDown({ key: 'a', ctrlKey: true });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
  });

  it('Ctrl+Alt+S does NOT call open() (altKey rejected)', () => {
    render(<HookProbe />);
    act(() => {
      dispatchKeyDown({ key: 's', ctrlKey: true, altKey: true });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
  });

  it('(f) event.repeat === true is ignored', () => {
    render(<HookProbe />);
    act(() => {
      dispatchKeyDown({ key: 's', ctrlKey: true, repeat: true });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
  });
});

describe('useGlobalKeymap — unmount lifecycle', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = stubPlatform('Win32');
  });
  afterEach(() => {
    restore();
  });

  it('(g) the listener detaches on unmount — Ctrl+S after unmount does NOT call open()', () => {
    const { unmount } = render(<HookProbe />);
    unmount();
    act(() => {
      dispatchKeyDown({ key: 's', ctrlKey: true });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
  });
});

describe('useGlobalKeymap — editable-target focus does NOT bail', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = stubPlatform('Win32');
  });
  afterEach(() => {
    restore();
  });

  it('(h) Ctrl+S fires even when an <input> is document.activeElement', () => {
    render(<HookProbe />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    act(() => {
      dispatchKeyDown({ key: 's', ctrlKey: true });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);

    input.remove();
  });

  it('Ctrl+S fires even when a <textarea> is document.activeElement', () => {
    render(<HookProbe />);
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    act(() => {
      dispatchKeyDown({ key: 's', ctrlKey: true });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);

    textarea.remove();
  });
});

describe('useGlobalKeymap — snapshot open() called once per physical press', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = stubPlatform('Win32');
  });
  afterEach(() => {
    restore();
  });

  it('repeat-skip plus idempotent open: a held key fires open() exactly once', () => {
    render(<HookProbe />);
    // Replace `open` with a spy so we can count invocations. The spy
    // also mirrors the real idempotent flip so subsequent assertions
    // about `isLabelInputOpen` would observe the same true state.
    const openSpy = vi.fn(() => {
      useSnapshotFlowStore.setState((state) =>
        state.isLabelInputOpen ? state : { ...state, isLabelInputOpen: true },
      );
    });
    useSnapshotFlowStore.setState((state) => ({ ...state, open: openSpy }));

    // First press: not a repeat, fires.
    act(() => {
      dispatchKeyDown({ key: 's', ctrlKey: true });
    });
    // Subsequent repeats from the held key: ignored by the listener.
    act(() => {
      dispatchKeyDown({ key: 's', ctrlKey: true, repeat: true });
      dispatchKeyDown({ key: 's', ctrlKey: true, repeat: true });
      dispatchKeyDown({ key: 's', ctrlKey: true, repeat: true });
    });
    expect(openSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useGlobalKeymap — commit chord is live (i)', () => {
  // The commit chord (`Cmd/Ctrl+Shift+Enter`) now resolves to
  // `useCommitChordStore.getState().run?.()` (Decision §2). The
  // dispatcher stays context-free — these cases run with NO
  // `<WsClientProvider>`. The WsClient-bound commit work is the bridge
  // hook's concern (`useProposalCommitChord.test.tsx`), not this one's.

  it('(i1-mac) Cmd+Shift+Enter invokes the registered run, prevents default, and does NOT open snapshot', () => {
    const restore = stubPlatform('MacIntel');
    const run = vi.fn();
    useCommitChordStore.getState().setRun(run);
    render(<HookProbe />);
    let event!: KeyboardEvent;
    act(() => {
      event = dispatchKeyDown({ key: 'Enter', metaKey: true, shiftKey: true });
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    // The commit chord must NOT leak into the snapshot branch.
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
    restore();
  });

  it('(i1-other) Ctrl+Shift+Enter invokes the registered run and prevents default', () => {
    const restore = stubPlatform('Win32');
    const run = vi.fn();
    useCommitChordStore.getState().setRun(run);
    render(<HookProbe />);
    let event!: KeyboardEvent;
    act(() => {
      event = dispatchKeyDown({ key: 'Enter', ctrlKey: true, shiftKey: true });
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    restore();
  });

  it('(i1-repeat) a held commit chord (event.repeat) does NOT re-fire run', () => {
    const restore = stubPlatform('Win32');
    const run = vi.fn();
    useCommitChordStore.getState().setRun(run);
    render(<HookProbe />);
    act(() => {
      dispatchKeyDown({ key: 'Enter', ctrlKey: true, shiftKey: true, repeat: true });
    });
    expect(run).not.toHaveBeenCalled();
    restore();
  });

  it('(i1-no-shift) Cmd/Ctrl+Enter WITHOUT shift (the propose chord) is NOT claimed by the dispatcher', () => {
    const restore = stubPlatform('Win32');
    const run = vi.fn();
    useCommitChordStore.getState().setRun(run);
    render(<HookProbe />);
    let event!: KeyboardEvent;
    act(() => {
      event = dispatchKeyDown({ key: 'Enter', ctrlKey: true });
    });
    expect(run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    restore();
  });

  it('(i2) with no run registered the commit chord is a safe no-op (no throw)', () => {
    const restore = stubPlatform('Win32');
    // No setRun — `run` is null.
    expect(useCommitChordStore.getState().run).toBeNull();
    render(<HookProbe />);
    let event!: KeyboardEvent;
    expect(() => {
      act(() => {
        event = dispatchKeyDown({ key: 'Enter', ctrlKey: true, shiftKey: true });
      });
    }).not.toThrow();
    // The chord still matched and was swallowed (preventDefault) even
    // though there was nothing to run.
    expect(event.defaultPrevented).toBe(true);
    restore();
  });
});
