// Tests for `useCanvasFocusEffect` — the consumer half of the
// participant's canvas-focus command channel (`part_diagnostic_focus`).
//
// Refinement: tasks/refinements/participant-ui/part_diagnostic_focus.md
//             (Acceptance §2)
//
// Per ADR 0022 these are committed Vitest cases. They pin:
//
//   - Advancing `focusRequest.nonce` calls `cy.animate` exactly once,
//     with a `fit.eles` collection built from the request's KNOWN ids
//     (ids the instance doesn't know are filtered out).
//   - A re-render with the SAME nonce does not re-call `animate`
//     (the ref-guard — Decision §D2).
//   - A request whose ids are all unknown is a no-op.
//   - `focusRequest === null` is a no-op.
//   - A request that arrives while `cy === null` is handled on the first
//     render where `cy` becomes non-null (the tab-switch-then-mount
//     path — the `cy === null` guard sits BEFORE the ref touch).
//
// `animate` is deferred through `requestAnimationFrame`, so the tests
// stub rAF and drain it deterministically.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Core } from 'cytoscape';

import { useCanvasFocusEffect } from './useCanvasFocusEffect';
import { useUiStore } from '../stores/uiStore';

const KNOWN_NODE_IDS = new Set(['n1', 'n2', 'n3']);

/**
 * A minimal fake Cytoscape collection exposing only the surface the hook
 * touches: `union`, `empty`, `nonempty`. `_ids` is a test-only field the
 * assertions read to confirm which nodes ended up in the `fit` set.
 */
interface FakeCollection {
  readonly _ids: readonly string[];
  union(other: FakeCollection): FakeCollection;
  empty(): boolean;
  nonempty(): boolean;
}

function makeCollection(ids: readonly string[]): FakeCollection {
  return {
    _ids: ids,
    union(other) {
      return makeCollection([...new Set([...ids, ...other._ids])]);
    },
    empty() {
      return ids.length === 0;
    },
    nonempty() {
      return ids.length > 0;
    },
  };
}

/**
 * A fake `Core` exposing only `collection`, `getElementById`, and a spy
 * `animate`. `getElementById` returns a single-id collection for known
 * ids and an empty collection otherwise.
 */
function makeCy(): { cy: Core; animate: ReturnType<typeof vi.fn> } {
  const animate = vi.fn();
  const cy = {
    collection: () => makeCollection([]),
    getElementById: (id: string) => makeCollection(KNOWN_NODE_IDS.has(id) ? [id] : []),
    animate,
  } as unknown as Core;
  return { cy, animate };
}

function fitEleIds(animate: ReturnType<typeof vi.fn>, call = 0): readonly string[] {
  const arg = animate.mock.calls[call]?.[0] as { fit: { eles: FakeCollection } };
  return arg.fit.eles._ids;
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
  it('calls animate once with a fit.eles collection of the known ids when the nonce advances', () => {
    const { cy, animate } = makeCy();
    renderHook(() => useCanvasFocusEffect(cy));

    act(() => {
      useUiStore.getState().requestCanvasFocus({ nodeIds: ['n1', 'n2'], edgeIds: ['e1'] });
    });
    // Deferred through rAF — nothing yet.
    expect(animate).not.toHaveBeenCalled();
    drainRaf();

    expect(animate).toHaveBeenCalledTimes(1);
    expect(fitEleIds(animate)).toEqual(['n1', 'n2']);
    const arg = animate.mock.calls[0]?.[0] as { fit: { padding: number }; duration: number };
    expect(arg.fit.padding).toBe(48);
    expect(arg.duration).toBe(250);
  });

  it('filters out ids the instance does not currently know', () => {
    const { cy, animate } = makeCy();
    renderHook(() => useCanvasFocusEffect(cy));

    act(() => {
      useUiStore.getState().requestCanvasFocus({ nodeIds: ['n1', 'gone', 'n3'], edgeIds: [] });
    });
    drainRaf();

    expect(animate).toHaveBeenCalledTimes(1);
    expect(fitEleIds(animate)).toEqual(['n1', 'n3']);
  });

  it('does not re-call animate when re-rendered with the same nonce (ref-guard)', () => {
    const { cy, animate } = makeCy();
    const { rerender } = renderHook(() => useCanvasFocusEffect(cy));

    act(() => {
      useUiStore.getState().requestCanvasFocus({ nodeIds: ['n1'], edgeIds: [] });
    });
    drainRaf();
    expect(animate).toHaveBeenCalledTimes(1);

    rerender();
    drainRaf();
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('does not call animate when every requested id is unknown', () => {
    const { cy, animate } = makeCy();
    renderHook(() => useCanvasFocusEffect(cy));

    act(() => {
      useUiStore.getState().requestCanvasFocus({ nodeIds: ['gone-1', 'gone-2'], edgeIds: [] });
    });
    drainRaf();

    expect(animate).not.toHaveBeenCalled();
  });

  it('is a no-op while focusRequest is null', () => {
    const { cy, animate } = makeCy();
    renderHook(() => useCanvasFocusEffect(cy));
    drainRaf();
    expect(animate).not.toHaveBeenCalled();
  });

  it('handles a request dispatched before the instance lands (tab-switch-then-mount path)', () => {
    const { cy, animate } = makeCy();
    // Render first with cy === null (the canvas is not yet mounted).
    const { rerender } = renderHook(({ instance }) => useCanvasFocusEffect(instance), {
      initialProps: { instance: null as Core | null },
    });

    // A tap on a non-graph tab dispatches the request before the canvas
    // mounts — the null guard sits before the ref touch, so it must NOT
    // be consumed (and thus must NOT be dropped) yet.
    act(() => {
      useUiStore.getState().requestCanvasFocus({ nodeIds: ['n1'], edgeIds: [] });
    });
    drainRaf();
    expect(animate).not.toHaveBeenCalled();

    // The freshly-mounted `<GraphView>` now provides the instance — the
    // pending request is handled on this first non-null render.
    rerender({ instance: cy });
    drainRaf();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(fitEleIds(animate)).toEqual(['n1']);
  });
});
