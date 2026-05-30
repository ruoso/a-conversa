// Tests for `<AnnotationHostEdge>` — the synthetic ReactFlow edge that
// tethers a promoted `AnnotationNode` to its host.
//
// Refinement: tasks/refinements/moderator-ui/mod_render_annotation_endpoint_edges.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. The pseudo-edge renders inside a `<g>` carrying the
//      `annotation-host-edge-<annotationId>` test-id seam (Decision §4
//      surface for Playwright assertions).
//   2. The pseudo-edge's wrapping `<g>` carries `pointer-events: none`
//      (Decision §7 — click-through preserved).
//   3. The pseudo-edge is dashed with a low-contrast stroke
//      (Decision §4 baseline styling — Decision §9 defers per-kind
//      theming).
//   4. No `<EdgeLabelRenderer>` overlay, no `markerEnd` arrow (the
//      pseudo-edge is a spatial-association indicator, not a
//      directional methodology edge).

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import ReactFlow, { Position, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';

import { createI18nInstance } from '@a-conversa/shell';
import { ANNOTATION_HOST_EDGE_TYPE, type AnnotationHostEdgeData } from './AnnotationHostEdge';
import { edgeTypes } from './edgeTypes';

const NODES: Node[] = [
  {
    id: 'host-node',
    position: { x: 0, y: 0 },
    data: { label: 'host' },
    width: 100,
    height: 40,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  },
  {
    id: 'promoted-annotation',
    position: { x: 200, y: 200 },
    data: { label: 'annotation' },
    width: 100,
    height: 40,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  },
];

function makeHostEdge(annotationId: string): Edge<AnnotationHostEdgeData> {
  return {
    id: `annotation-host-${annotationId}`,
    source: 'host-node',
    target: 'promoted-annotation',
    type: ANNOTATION_HOST_EDGE_TYPE,
    data: { annotationId },
  };
}

beforeAll(async () => {
  // Same ReactFlow happy-dom shim as `StatementEdge.test.tsx`:
  // immediate `ResizeObserver` + non-zero `offsetWidth/Height`
  // + non-zero `getBoundingClientRect` so the edge renderer fires.
  class ImmediateResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.callback(
        [
          {
            target,
            contentRect: target.getBoundingClientRect(),
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ],
        this,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ImmediateResizeObserver }).ResizeObserver =
    ImmediateResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(): number {
      return 100;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(): number {
      return 40;
    },
  });
  Element.prototype.getBoundingClientRect = function getBoundingClientRectStub(): DOMRect {
    return {
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      top: 0,
      left: 0,
      right: 100,
      bottom: 40,
      toJSON() {
        return this;
      },
    };
  };
  await createI18nInstance('en-US');
});

beforeEach(async () => {
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('AnnotationHostEdge', () => {
  it('renders with the annotation-host-edge-<annotationId> test-id seam', async () => {
    const annotationId = 'anno-x';
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[makeHostEdge(annotationId)]} edgeTypes={edgeTypes} />
      </div>,
    );
    const group = await waitFor(() =>
      document.querySelector(`[data-testid="annotation-host-edge-${annotationId}"]`),
    );
    expect(group).not.toBeNull();
  });

  it('carries pointer-events: none on the wrapping <g> per Decision §7', async () => {
    const annotationId = 'anno-pe';
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[makeHostEdge(annotationId)]} edgeTypes={edgeTypes} />
      </div>,
    );
    const group = await waitFor(() =>
      document.querySelector<SVGGElement>(`[data-testid="annotation-host-edge-${annotationId}"]`),
    );
    expect(group).not.toBeNull();
    // Inline style is the canonical seam — pointer-events stamps as
    // `pointerEvents: 'none'` on the inline style declaration.
    expect(group?.style.pointerEvents).toBe('none');
  });

  it('renders a dashed low-contrast stroke and no arrow marker', async () => {
    const annotationId = 'anno-style';
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[makeHostEdge(annotationId)]} edgeTypes={edgeTypes} />
      </div>,
    );
    const group = await waitFor(() =>
      document.querySelector<SVGGElement>(`[data-testid="annotation-host-edge-${annotationId}"]`),
    );
    expect(group).not.toBeNull();
    // The underlying path lives inside the BaseEdge render. We assert
    // the inline style passed through — Tailwind classes aren't
    // load-bearing here, the style.stroke / style.strokeDasharray are.
    const path = group?.querySelector('path.react-flow__edge-path') as SVGPathElement | null;
    expect(path).not.toBeNull();
    // ReactFlow's BaseEdge renders the SVG path with the style we
    // supplied — assert the slate-300 stroke and 4 3 dash pattern.
    expect(path?.style.stroke).toBe('#cbd5e1');
    expect(path?.style.strokeDasharray).toBe('4 3');
    // No `markerEnd` attribute — the pseudo-edge has no arrow.
    expect(path?.getAttribute('marker-end')).toBeFalsy();
  });
});
