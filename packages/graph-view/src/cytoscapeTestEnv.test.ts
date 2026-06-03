// Vitest cases for `installCytoscapeTestEnv` — the audience's local
// happy-dom-friendly Cytoscape test environment helper.
//
// Refinement: tasks/refinements/audience/aud_cytoscape_init.md
//   (Decision §6 — the helper is duplicated from
//   `apps/participant/src/graph/cytoscapeTestEnv.ts`; this file pins
//   the install + restore contract independently so the audience
//   workspace stays self-contained.)
// ADRs: 0022 (no throwaway verifications — the four cases are the
//   committed regression coverage for the helper's behaviour).
//
// Four cases:
//   (a) `installCytoscapeTestEnv()` installs `ResizeObserver` when
//       absent from `globalThis` (test deletes it first to drive the
//       conditional install path),
//   (b) the canvas-context stub's `measureText('hello')` returns
//       `{ width: 35 }` (the empirical 7 px/char constant),
//   (c) `requestAnimationFrame` polyfill (installed when absent) runs
//       the callback before the next microtask drain completes,
//   (d) `restore()` returns the globals to their pre-install state
//       (deletes `ResizeObserver` / `requestAnimationFrame` /
//       `cancelAnimationFrame` if originally absent, restores
//       `HTMLCanvasElement.prototype.getContext` to its captured
//       reference).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installCytoscapeTestEnv } from './cytoscapeTestEnv';

interface GlobalWithRaf {
  ResizeObserver?: unknown;
  requestAnimationFrame?: (cb: (timestamp: number) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

const g = globalThis as GlobalWithRaf;
// Snapshot the happy-dom-supplied (or undefined) values so tests can
// restore them after deliberately deleting the globals to drive the
// helper's conditional-install path.
const initialResizeObserver = g.ResizeObserver;
const initialRequestAnimationFrame = g.requestAnimationFrame;
const initialCancelAnimationFrame = g.cancelAnimationFrame;
// Intentional unbound capture so `resetGlobals` can write the exact
// original reference back onto the prototype. Identity is significant
// here — the install/restore test pins reference equality.
// eslint-disable-next-line @typescript-eslint/unbound-method
const initialGetContext = HTMLCanvasElement.prototype.getContext;

function resetGlobals(): void {
  if (initialResizeObserver === undefined) delete g.ResizeObserver;
  else g.ResizeObserver = initialResizeObserver;
  if (initialRequestAnimationFrame === undefined) delete g.requestAnimationFrame;
  else g.requestAnimationFrame = initialRequestAnimationFrame;
  if (initialCancelAnimationFrame === undefined) delete g.cancelAnimationFrame;
  else g.cancelAnimationFrame = initialCancelAnimationFrame;
  HTMLCanvasElement.prototype.getContext = initialGetContext;
}

beforeEach(() => {
  resetGlobals();
});

afterEach(() => {
  resetGlobals();
});

describe('installCytoscapeTestEnv — happy-dom Cytoscape compatibility shims', () => {
  it('(a) installs ResizeObserver when absent from globalThis', () => {
    // Delete first so the helper's `if undefined` install branch
    // fires regardless of what the test environment ships with.
    delete g.ResizeObserver;
    expect(g.ResizeObserver).toBeUndefined();
    const handle = installCytoscapeTestEnv();
    try {
      expect(typeof g.ResizeObserver).toBe('function');
      const Observer = g.ResizeObserver as new (cb: () => void) => {
        observe: (target: Element) => void;
        unobserve: (target: Element) => void;
        disconnect: () => void;
      };
      const observer = new Observer(() => undefined);
      expect(() => {
        observer.observe(document.createElement('div'));
        observer.unobserve(document.createElement('div'));
        observer.disconnect();
      }).not.toThrow();
    } finally {
      handle.restore();
    }
  });

  it('(b) canvas 2D-context stub measureText("hello") returns { width: 35 }', () => {
    const handle = installCytoscapeTestEnv();
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      expect(ctx).not.toBeNull();
      const measured = ctx!.measureText('hello');
      expect(measured.width).toBe(35);
    } finally {
      handle.restore();
    }
  });

  it('(c) requestAnimationFrame polyfill (installed when absent) fires the callback on the next microtask drain', async () => {
    delete g.requestAnimationFrame;
    delete g.cancelAnimationFrame;
    const handle = installCytoscapeTestEnv();
    try {
      expect(typeof g.requestAnimationFrame).toBe('function');
      let fired = false;
      const id = g.requestAnimationFrame!(() => {
        fired = true;
      });
      expect(typeof id).toBe('number');
      expect(fired).toBe(false);
      await Promise.resolve();
      expect(fired).toBe(true);
    } finally {
      handle.restore();
    }
  });

  it('(d) restore() returns the globals to their pre-install state', () => {
    // Force-delete the conditional-install surfaces so the install
    // path actually replaces them; getContext is always replaced.
    delete g.ResizeObserver;
    delete g.requestAnimationFrame;
    delete g.cancelAnimationFrame;
    // Identity-comparison against the prototype's current `getContext`
    // value — the test intent is to verify the prototype is swapped on
    // `install()` and restored on `restore()`. The lint rule is
    // defensive against accidentally losing `this` binding via
    // method extraction; this usage is intentional reference capture.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const beforeGetContext = HTMLCanvasElement.prototype.getContext;
    const handle = installCytoscapeTestEnv();
    expect(typeof g.ResizeObserver).toBe('function');
    expect(typeof g.requestAnimationFrame).toBe('function');
    expect(typeof g.cancelAnimationFrame).toBe('function');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(HTMLCanvasElement.prototype.getContext).not.toBe(beforeGetContext);
    handle.restore();
    expect(g.ResizeObserver).toBeUndefined();
    expect(g.requestAnimationFrame).toBeUndefined();
    expect(g.cancelAnimationFrame).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(HTMLCanvasElement.prototype.getContext).toBe(beforeGetContext);
  });
});
