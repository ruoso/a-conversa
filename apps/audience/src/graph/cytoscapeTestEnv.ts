// Test-environment stubs for tests that mount Cytoscape via
// `<AudienceGraphView>` under happy-dom.
//
// Refinement: tasks/refinements/audience/aud_cytoscape_init.md
//   (Decision §6 — the participant's `cytoscapeTestEnv.ts` is duplicated
//   verbatim into the audience workspace; cross-app imports are
//   forbidden under our pnpm-workspaces layout, and two callers is YAGNI
//   for a shared package. The extraction trigger is a third Cytoscape
//   consumer — most likely under `replay_test.*` or a moderator-side
//   audience-preview pane — at which point the helper lifts into a
//   shared package.)
//
// Cytoscape's `CanvasRenderer` calls `canvas.getContext('2d')` once
// per layer at mount and throws `Could not create canvas of type 2d`
// when the result is null. happy-dom does not ship a Canvas 2D
// implementation. The renderer also observes the container with
// `ResizeObserver` which happy-dom does not ship either. Both stubs
// are noop-shaped: the audience tests assert on `cy.elements()` (the
// logical element set), not the painted pixels.
//
// `installCytoscapeTestEnv()` returns a `restore()` handle so each test
// module can opt in via `beforeAll` / `afterAll`. The returned handle's
// `restore()` puts the globals back to their pre-install state (or
// deletes them if originally absent).

export interface CytoscapeTestEnvRestoreHandle {
  readonly restore: () => void;
}

type RafCallback = (timestamp: number) => void;

export function installCytoscapeTestEnv(): CytoscapeTestEnvRestoreHandle {
  const originalResizeObserver = (globalThis as { ResizeObserver?: typeof ResizeObserver })
    .ResizeObserver;
  // Intentional unbound capture: `restore()` writes this back onto
  // the prototype where `this` resolves dynamically per call. Binding
  // would create a new function identity, breaking the test that
  // pins install + restore behaviour by reference equality.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalRequestAnimationFrame = (
    globalThis as { requestAnimationFrame?: (cb: RafCallback) => number }
  ).requestAnimationFrame;
  const originalCancelAnimationFrame = (
    globalThis as { cancelAnimationFrame?: (handle: number) => void }
  ).cancelAnimationFrame;

  if (typeof originalResizeObserver === 'undefined') {
    class NoopResizeObserver {
      observe(): void {
        /* noop */
      }
      unobserve(): void {
        /* noop */
      }
      disconnect(): void {
        /* noop */
      }
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = NoopResizeObserver;
  }

  if (typeof originalRequestAnimationFrame === 'undefined') {
    let nextHandle = 1;
    const cancelled = new Set<number>();
    const rafPolyfill = (cb: RafCallback): number => {
      const handle = nextHandle++;
      queueMicrotask(() => {
        if (cancelled.has(handle)) {
          cancelled.delete(handle);
          return;
        }
        cb(performance.now());
      });
      return handle;
    };
    const cafPolyfill = (handle: number): void => {
      cancelled.add(handle);
    };
    (globalThis as { requestAnimationFrame?: (cb: RafCallback) => number }).requestAnimationFrame =
      rafPolyfill;
    (globalThis as { cancelAnimationFrame?: (handle: number) => void }).cancelAnimationFrame =
      cafPolyfill;
  }

  HTMLCanvasElement.prototype.getContext = function getContextStub(
    this: HTMLCanvasElement,
    contextId: string,
  ): RenderingContext | null {
    if (contextId !== '2d') return null;
    const ctx = {
      canvas: this,
      // `measureText` returns a content-sensitive estimate (~7 px per
      // character at 12 px sans-serif). Cytoscape calls this on every
      // label-bearing element to decide where to wrap text; a constant
      // 0 would collapse every wording onto a zero-width line, defeating
      // the wrapping path. The empirical 7 px matches the production
      // measurer closely enough for the audience tests' assertions on
      // `cy.elements()`.
      measureText: (text: string) => ({ width: text.length * 7 }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(0, w) * Math.max(0, h) * 4),
        width: Math.max(0, w),
        height: Math.max(0, h),
      }),
      putImageData: () => undefined,
      drawImage: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      translate: () => undefined,
      scale: () => undefined,
      rotate: () => undefined,
      beginPath: () => undefined,
      closePath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      arc: () => undefined,
      arcTo: () => undefined,
      bezierCurveTo: () => undefined,
      quadraticCurveTo: () => undefined,
      rect: () => undefined,
      fillRect: () => undefined,
      strokeRect: () => undefined,
      clearRect: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      fillText: () => undefined,
      strokeText: () => undefined,
      setTransform: () => undefined,
      resetTransform: () => undefined,
      transform: () => undefined,
      clip: () => undefined,
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      createRadialGradient: () => ({ addColorStop: () => undefined }),
      createPattern: () => null,
      setLineDash: () => undefined,
      getLineDash: () => [],
      isPointInPath: () => false,
      isPointInStroke: () => false,
    };
    return ctx as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;

  return {
    restore: () => {
      if (originalResizeObserver === undefined) {
        delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
      } else {
        (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
          originalResizeObserver;
      }
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      if (originalRequestAnimationFrame === undefined) {
        delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
      } else {
        (
          globalThis as { requestAnimationFrame?: (cb: RafCallback) => number }
        ).requestAnimationFrame = originalRequestAnimationFrame;
      }
      if (originalCancelAnimationFrame === undefined) {
        delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
      } else {
        (globalThis as { cancelAnimationFrame?: (handle: number) => void }).cancelAnimationFrame =
          originalCancelAnimationFrame;
      }
    },
  };
}
