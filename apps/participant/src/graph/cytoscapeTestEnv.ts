// Shared test-environment stubs for tests that mount Cytoscape via
// `<GraphView>` (directly or transitively through `<OperateRoute>`).
//
// Refinement: tasks/refinements/participant-ui/part_graph_render.md
// Refinement: tasks/refinements/participant-ui/part_other_vote_indicators_canvas_dots.md
//              (Decision §6 — adds a `requestAnimationFrame` /
//              `cancelAnimationFrame` polyfill backed by
//              `queueMicrotask` so the `<OtherVotesOverlay>`'s
//              rAF-batched re-render flow runs synchronously enough
//              under Vitest for the post-rAF state to be observable
//              without `await`-ing real timers. Production runs the
//              browser-supplied rAF.)
//
// Cytoscape's `CanvasRenderer` calls `canvas.getContext('2d')` once
// per layer at mount and throws `Could not create canvas of type 2d`
// when the result is null. happy-dom does not ship a Canvas 2D
// implementation. The renderer also observes the container with
// `ResizeObserver` which happy-dom does not ship either. Both stubs
// are noop-shaped: the participant graph view's tests assert on
// `cy.elements()` (the logical element set), not the painted pixels,
// so a duck-typed 2D context + a noop ResizeObserver are sufficient.
//
// The setup is split into `installCytoscapeTestEnv()` / `restoreCytoscapeTestEnv()`
// so each test module can opt in via `beforeAll` / `afterAll`. Calling
// `install` twice is idempotent: the second call notes the prior
// originals already captured and skips re-overwriting them.

export interface CytoscapeTestEnvRestoreHandle {
  readonly restore: () => void;
}

type RafCallback = (timestamp: number) => void;

export function installCytoscapeTestEnv(): CytoscapeTestEnvRestoreHandle {
  const originalResizeObserver = (globalThis as { ResizeObserver?: typeof ResizeObserver })
    .ResizeObserver;
  const originalGetContext = HTMLCanvasElement.prototype.getContext.bind(
    HTMLCanvasElement.prototype,
  );
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

  // requestAnimationFrame / cancelAnimationFrame polyfill — happy-dom
  // does not ship either. `<OtherVotesOverlay>` (and any future overlay
  // following the same singleton-handle rAF batching idiom) needs both
  // surfaces to exist; the test envelope shims them with a
  // `queueMicrotask`-backed callback so post-rAF state is observable
  // without `await`-ing real timers. Each scheduled callback gets a
  // monotonic handle so `cancelAnimationFrame(handle)` can pre-empt
  // its execution before the microtask runs.
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
      // Calls the renderer makes during construction + per-frame.
      // Every method is a noop; every getter returns a benign value.
      measureText: (_text: string) => ({ width: 0 }),
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
