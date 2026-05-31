// Tests for `useSnapshotShortcut` — the document-level Cmd/Ctrl+S
// keydown listener that opens the F10 snapshot-label flow.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_action.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//   (a) Cmd+S on a macOS-shaped event calls open(),
//   (b) Ctrl+S on a non-macOS-shaped event calls open(),
//   (c) bare `s` (no modifier) does NOT call open(),
//   (d) Cmd+Shift+S (shift allowed) STILL calls open(),
//   (e) preventDefault() is invoked on match,
//   (f) event.repeat === true is ignored,
//   (g) the listener detaches on unmount,
//   (h) editable-target focus does NOT bail (open() fires even when
//       an <input> is the active element — universal Cmd+S semantics).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { act, type ReactElement } from 'react';

import { resetSnapshotFlowStore, useSnapshotFlowStore } from './useSnapshotFlowStore';
import { useSnapshotShortcut } from './useSnapshotShortcut';

function HookProbe(): ReactElement {
  useSnapshotShortcut();
  return <span data-testid="hook-probe" />;
}

/**
 * Stub `navigator.platform` for the duration of a single test so the
 * hook's mac-vs-other branch resolves deterministically. Returns a
 * restore function to call in cleanup.
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

describe('useSnapshotShortcut — macOS branch (Cmd+S)', () => {
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

describe('useSnapshotShortcut — non-macOS branch (Ctrl+S)', () => {
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

describe('useSnapshotShortcut — no-match bails', () => {
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

describe('useSnapshotShortcut — unmount lifecycle', () => {
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

describe('useSnapshotShortcut — editable-target focus does NOT bail', () => {
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

describe('useSnapshotShortcut — open() called once per physical press', () => {
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
