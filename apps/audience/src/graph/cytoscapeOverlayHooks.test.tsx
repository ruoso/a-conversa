// Vitest cases pinning the consolidation properties that
// `useCytoscapeOverlayPlacements<P>` and `useSeenKeysGate<K>` ADD
// (rAF batching, subscription cleanup, latest-ref commit capture,
// lazy-init-on-non-empty seeding timing, `isNew` side-effect
// idempotency). The four overlay test files
// (`PerFacetPillOverlay.test.tsx`, `AxiomMarkOverlay.test.tsx`,
// `AnnotationOverlay.test.tsx`, `NodeAppearOverlay.test.tsx`) cover
// the behavior-preservation surface and pass byte-unchanged post-
// extraction — that is the regression pin for "the refactor did not
// alter observable behavior." This file pins the NEW consolidation
// guarantees the hooks themselves provide.
//
// Refinement: tasks/refinements/audience/aud_dom_overlay_extraction.md
//              (Acceptance — 6 cases per Constraints: rAF batching,
//              cleanup on unmount, re-bind on cy-identity change,
//              latest-ref commit capture, seen-Set empty-render does
//              NOT seed, seen-Set first-non-empty-render seeds with
//              idempotent side effect.)
// ADRs:        0022 (no throwaway verifications — these are permanent
//              consolidation-property pins).

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import cytoscape, { type Core } from 'cytoscape';

import { useCytoscapeOverlayPlacements, useSeenKeysGate } from './cytoscapeOverlayHooks';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';

let cytoscapeEnvHandle: CytoscapeTestEnvRestoreHandle | null = null;

beforeAll(() => {
  cytoscapeEnvHandle = installCytoscapeTestEnv();
});

afterAll(() => {
  cytoscapeEnvHandle?.restore();
  cytoscapeEnvHandle = null;
});

afterEach(() => {
  cleanup();
});

// The cytoscapeTestEnv polyfills rAF via `queueMicrotask`; two
// awaits drain the polyfill's pending microtask queue (the first
// awaits the rAF microtask itself, the second awaits any React
// state-update microtasks the commit produced).
async function flushRaf(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeCy(): Core {
  return cytoscape({ headless: true });
}

describe('useCytoscapeOverlayPlacements', () => {
  it('(1) batches multiple events within a frame into a single commit', async () => {
    const cy = makeCy();
    const commitSpy = vi.fn((_cy: Core): readonly { id: string }[] => []);
    try {
      const { unmount } = renderHook(() => useCytoscapeOverlayPlacements(cy, commitSpy));
      // The hook schedules a commit synchronously inside the useEffect;
      // drain that one first so the assertion is about post-mount
      // batching behavior, not initial-mount scheduling.
      await flushRaf();
      commitSpy.mockClear();

      // Two events synchronously — the second one should be dropped
      // because a frame is already pending from the first.
      cy.emit('pan');
      cy.emit('zoom');
      await flushRaf();

      expect(commitSpy).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      cy.destroy();
    }
  });

  it('(2) deregisters Cytoscape subscriptions on unmount', async () => {
    const cy = makeCy();
    const commitSpy = vi.fn((_cy: Core): readonly { id: string }[] => []);
    try {
      const { unmount } = renderHook(() => useCytoscapeOverlayPlacements(cy, commitSpy));
      await flushRaf();
      commitSpy.mockClear();

      unmount();

      cy.emit('pan');
      await flushRaf();

      expect(commitSpy).not.toHaveBeenCalled();
    } finally {
      cy.destroy();
    }
  });

  it('(3) re-binds subscriptions when the cy identity changes', async () => {
    const cyOld = makeCy();
    const cyNew = makeCy();
    const commitSpy = vi.fn((_cy: Core): readonly { id: string }[] => []);
    try {
      const { rerender, unmount } = renderHook(
        ({ cy }: { cy: Core | null }) => useCytoscapeOverlayPlacements(cy, commitSpy),
        { initialProps: { cy: cyOld } },
      );
      await flushRaf();
      commitSpy.mockClear();

      rerender({ cy: cyNew });
      // The rerender schedules a fresh initial commit against the new
      // instance; drain it so the subsequent assertion is about event
      // delivery, not initial scheduling.
      await flushRaf();
      commitSpy.mockClear();

      cyNew.emit('pan');
      await flushRaf();
      expect(commitSpy).toHaveBeenCalledTimes(1);

      commitSpy.mockClear();
      cyOld.emit('pan');
      await flushRaf();
      expect(commitSpy).not.toHaveBeenCalled();

      unmount();
    } finally {
      cyOld.destroy();
      cyNew.destroy();
    }
  });

  it('(4) the rAF closure reads the LATEST commit (latest-ref pattern)', async () => {
    const cy = makeCy();
    const commitA = vi.fn((_cy: Core): readonly { id: string }[] => []);
    const commitB = vi.fn((_cy: Core): readonly { id: string }[] => []);
    try {
      const { rerender, unmount } = renderHook(
        ({ commit }: { commit: (cy: Core) => readonly { id: string }[] }) =>
          useCytoscapeOverlayPlacements(cy, commit),
        { initialProps: { commit: commitA } },
      );
      await flushRaf();
      commitA.mockClear();
      commitB.mockClear();

      rerender({ commit: commitB });
      // Rerendering does NOT re-fire the useEffect (cy identity is
      // unchanged), so no fresh initial commit is scheduled. The next
      // event drives the rAF.
      cy.emit('pan');
      await flushRaf();

      expect(commitB).toHaveBeenCalledTimes(1);
      expect(commitA).not.toHaveBeenCalled();

      unmount();
    } finally {
      cy.destroy();
    }
  });
});

describe('useSeenKeysGate', () => {
  it('(5) empty-keys render does NOT seed; an un-seeded predicate returns false unconditionally', () => {
    const { result, rerender } = renderHook(
      ({ keys }: { keys: readonly string[] }) => useSeenKeysGate(keys),
      { initialProps: { keys: [] as readonly string[] } },
    );
    // Un-seeded: every probe returns false.
    expect(result.current('a')).toBe(false);
    expect(result.current('b')).toBe(false);

    rerender({ keys: ['x', 'y'] as readonly string[] });
    // Seeded with ['x', 'y']: those are already known.
    expect(result.current('x')).toBe(false);
    expect(result.current('y')).toBe(false);
    // 'z' is genuinely new — first call returns true and the side
    // effect adds it to the set.
    expect(result.current('z')).toBe(true);
    // Repeat call: idempotent side effect, returns false.
    expect(result.current('z')).toBe(false);
  });

  it('(6) first-non-empty render seeds the set; isNew is true-then-false on repeat-call', () => {
    const { result } = renderHook(
      ({ keys }: { keys: readonly string[] }) => useSeenKeysGate(keys),
      { initialProps: { keys: ['a', 'b'] as readonly string[] } },
    );
    // Seeded with the initial non-empty set: pre-existing keys are
    // not "new".
    expect(result.current('a')).toBe(false);
    expect(result.current('a')).toBe(false);
    // 'c' is genuinely new on first probe...
    expect(result.current('c')).toBe(true);
    // ...and seen on repeat.
    expect(result.current('c')).toBe(false);
  });
});
