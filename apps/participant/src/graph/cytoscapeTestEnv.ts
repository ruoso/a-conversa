// Shared test-environment stubs for tests that mount Cytoscape via
// `<GraphView>` (directly or transitively through `<OperateRoute>`).
//
// Refinement: tasks/refinements/participant-ui/part_graph_render.md
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

export function installCytoscapeTestEnv(): CytoscapeTestEnvRestoreHandle {
  const originalResizeObserver = (globalThis as { ResizeObserver?: typeof ResizeObserver })
    .ResizeObserver;
  const originalGetContext = HTMLCanvasElement.prototype.getContext.bind(
    HTMLCanvasElement.prototype,
  );

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
    },
  };
}
