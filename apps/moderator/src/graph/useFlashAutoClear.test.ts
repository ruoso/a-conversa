// Tests for `useFlashAutoClear` — the self-clearing half of the entity-
// flash channel.
//
// Refinement: tasks/refinements/moderator-ui/mod_history_click_to_flash.md
//             (Acceptance §11)
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// Per ADR 0022 these are committed Vitest cases. They pin the auto-clear
// timing: advancing the clock by `FLASH_DURATION_MS` after a flash clears
// the set; a second flash before expiry resets the timer (the set survives
// until the NEW duration elapses); unmount cancels a pending timer.
//
// The effect schedules a `setTimeout`, so the tests use fake timers and
// advance the clock deterministically.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import { FLASH_DURATION_MS, useFlashAutoClear } from './useFlashAutoClear';
import { useFlashStore } from '../stores/flashStore';

beforeEach(() => {
  vi.useFakeTimers();
  useFlashStore.setState({ flashingIds: new Set<string>(), flashNonce: 0 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useFlashAutoClear', () => {
  it('clears flashingIds after FLASH_DURATION_MS elapses', () => {
    renderHook(() => useFlashAutoClear());

    act(() => {
      useFlashStore.getState().flash(['n1', 'e1']);
    });
    // Still flashing right up to the boundary.
    expect(useFlashStore.getState().flashingIds.size).toBe(2);
    act(() => {
      vi.advanceTimersByTime(FLASH_DURATION_MS - 1);
    });
    expect(useFlashStore.getState().flashingIds.size).toBe(2);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(useFlashStore.getState().flashingIds.size).toBe(0);
  });

  it('a second flash before expiry resets the timer (set survives until the new duration)', () => {
    renderHook(() => useFlashAutoClear());

    act(() => {
      useFlashStore.getState().flash(['n1']);
    });
    act(() => {
      vi.advanceTimersByTime(FLASH_DURATION_MS - 100);
    });
    // Re-flash just before the first timer would fire.
    act(() => {
      useFlashStore.getState().flash(['n2']);
    });

    // The original timer's remaining 100ms must NOT clear the new set.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect([...useFlashStore.getState().flashingIds]).toEqual(['n2']);

    // The new timer fires a full duration after the second flash.
    act(() => {
      vi.advanceTimersByTime(FLASH_DURATION_MS);
    });
    expect(useFlashStore.getState().flashingIds.size).toBe(0);
  });

  it('unmount cancels a pending timer (the set is left untouched)', () => {
    const { unmount } = renderHook(() => useFlashAutoClear());

    act(() => {
      useFlashStore.getState().flash(['n1']);
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(FLASH_DURATION_MS * 2);
    });
    // No timer fired after unmount → the set is still as flashed.
    expect([...useFlashStore.getState().flashingIds]).toEqual(['n1']);
  });
});
