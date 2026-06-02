// Tests for `useCanvasFocusEffect` — the consumer half of the
// canvas-focus command channel (`mod_diagnostic_focus_action`).
//
// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_focus_action.md
//             (Acceptance §2)
//
// Per ADR 0022 these are committed Vitest cases. They pin:
//
//   - Advancing `focusRequest.nonce` calls `fitView` exactly once, with
//     `nodes` = the request's KNOWN ids mapped to `{ id }` (ids ReactFlow
//     doesn't know are filtered out).
//   - A re-render with the SAME nonce does not re-call `fitView`
//     (the ref-guard — Decision §D2).
//   - A request whose ids are all unknown is a no-op.
//   - `focusRequest === null` is a no-op.
//
// `fitView` is deferred through `requestAnimationFrame`, so the tests
// stub rAF and drain it deterministically.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactFlowInstance } from 'reactflow';

import { useCanvasFocusEffect } from './useCanvasFocusEffect';
import { useUiStore } from '../stores/uiStore';

const KNOWN_NODE_IDS = new Set(['n1', 'n2', 'n3']);

/**
 * A fake `ReactFlowInstance` exposing only what the hook touches:
 * `getNode` (a stub for known ids, `undefined` otherwise) and a spy
 * `fitView`.
 */
function makeReactFlow(): { instance: ReactFlowInstance; fitView: ReturnType<typeof vi.fn> } {
  const fitView = vi.fn();
  const instance = {
    getNode: (id: string) => (KNOWN_NODE_IDS.has(id) ? { id } : undefined),
    fitView,
  } as unknown as ReactFlowInstance;
  return { instance, fitView };
}

let rafCallbacks: FrameRequestCallback[] = [];
let originalRaf: typeof window.requestAnimationFrame;
let originalCancelRaf: typeof window.cancelAnimationFrame;

function drainRaf(): void {
  while (rafCallbacks.length > 0) {
    const cb = rafCallbacks.shift();
    cb?.(0);
  }
}

beforeEach(() => {
  useUiStore.setState({ focusRequest: null });
  rafCallbacks = [];
  originalRaf = window.requestAnimationFrame;
  originalCancelRaf = window.cancelAnimationFrame;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  };
  window.cancelAnimationFrame = (): void => {};
});

afterEach(() => {
  window.requestAnimationFrame = originalRaf;
  window.cancelAnimationFrame = originalCancelRaf;
  cleanup();
});

describe('useCanvasFocusEffect', () => {
  it('calls fitView once with the known ids when the nonce advances', () => {
    const { instance, fitView } = makeReactFlow();
    renderHook(() => useCanvasFocusEffect(instance));

    act(() => {
      useUiStore.getState().requestCanvasFocus({ nodeIds: ['n1', 'n2'], edgeIds: ['e1'] });
    });
    // Deferred through rAF — nothing yet.
    expect(fitView).not.toHaveBeenCalled();
    drainRaf();

    expect(fitView).toHaveBeenCalledTimes(1);
    expect(fitView.mock.calls[0]?.[0]).toEqual({
      nodes: [{ id: 'n1' }, { id: 'n2' }],
      padding: 0.2,
      duration: 250,
    });
  });

  it('filters out ids ReactFlow does not currently know', () => {
    const { instance, fitView } = makeReactFlow();
    renderHook(() => useCanvasFocusEffect(instance));

    act(() => {
      useUiStore.getState().requestCanvasFocus({ nodeIds: ['n1', 'gone', 'n3'], edgeIds: [] });
    });
    drainRaf();

    expect(fitView).toHaveBeenCalledTimes(1);
    expect(fitView.mock.calls[0]?.[0]).toEqual({
      nodes: [{ id: 'n1' }, { id: 'n3' }],
      padding: 0.2,
      duration: 250,
    });
  });

  it('does not re-call fitView when re-rendered with the same nonce (ref-guard)', () => {
    const { instance, fitView } = makeReactFlow();
    const { rerender } = renderHook(() => useCanvasFocusEffect(instance));

    act(() => {
      useUiStore.getState().requestCanvasFocus({ nodeIds: ['n1'], edgeIds: [] });
    });
    drainRaf();
    expect(fitView).toHaveBeenCalledTimes(1);

    // A re-render that does NOT advance the nonce must not re-fire.
    rerender();
    drainRaf();
    expect(fitView).toHaveBeenCalledTimes(1);
  });

  it('re-fires when a fresh request advances the nonce again', () => {
    const { instance, fitView } = makeReactFlow();
    renderHook(() => useCanvasFocusEffect(instance));

    act(() => {
      useUiStore.getState().requestCanvasFocus({ nodeIds: ['n1'], edgeIds: [] });
    });
    drainRaf();
    act(() => {
      useUiStore.getState().requestCanvasFocus({ nodeIds: ['n2'], edgeIds: [] });
    });
    drainRaf();

    expect(fitView).toHaveBeenCalledTimes(2);
    expect(fitView.mock.calls[1]?.[0]).toEqual({
      nodes: [{ id: 'n2' }],
      padding: 0.2,
      duration: 250,
    });
  });

  it('does not call fitView when every requested id is unknown', () => {
    const { instance, fitView } = makeReactFlow();
    renderHook(() => useCanvasFocusEffect(instance));

    act(() => {
      useUiStore.getState().requestCanvasFocus({ nodeIds: ['gone-1', 'gone-2'], edgeIds: [] });
    });
    drainRaf();

    expect(fitView).not.toHaveBeenCalled();
  });

  it('is a no-op while focusRequest is null', () => {
    const { instance, fitView } = makeReactFlow();
    renderHook(() => useCanvasFocusEffect(instance));
    drainRaf();
    expect(fitView).not.toHaveBeenCalled();
  });
});
