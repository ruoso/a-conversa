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
//   (i) Cmd/Ctrl+Shift+Enter (the deferred commit chord) is a no-op in
//       this task — the dispatcher has no commit handler yet. This pins
//       the deferral so `mod_proposal_selection_commit_chord`'s first
//       commit test fails-first against a real gap.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { act, type ReactElement } from 'react';

import { resetSnapshotFlowStore, useSnapshotFlowStore } from './useSnapshotFlowStore';
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
});

afterEach(() => {
  cleanup();
  resetSnapshotFlowStore();
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

describe('useGlobalKeymap — commit chord is deferred (i)', () => {
  // The commit chord (`Cmd/Ctrl+Shift+Enter`) is registered in
  // GLOBAL_KEYMAP but has NO live handler in this task (Decision §5).
  // These cases pin the no-op so `mod_proposal_selection_commit_chord`
  // adds its first commit test against a genuine gap.
  it('(i-mac) Cmd+Shift+Enter is a no-op — does not open the snapshot flow', () => {
    const restore = stubPlatform('MacIntel');
    render(<HookProbe />);
    let event!: KeyboardEvent;
    act(() => {
      event = dispatchKeyDown({ key: 'Enter', metaKey: true, shiftKey: true });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
    // No handler claims the chord, so it is not prevented either.
    expect(event.defaultPrevented).toBe(false);
    restore();
  });

  it('(i-other) Ctrl+Shift+Enter is a no-op — does not open the snapshot flow', () => {
    const restore = stubPlatform('Win32');
    render(<HookProbe />);
    let event!: KeyboardEvent;
    act(() => {
      event = dispatchKeyDown({ key: 'Enter', ctrlKey: true, shiftKey: true });
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    restore();
  });
});
