// Tests for `<GraphCanvasPane>` — the moderator's ReactFlow canvas mount.
//
// Refinement: tasks/refinements/moderator-ui/mod_graph_canvas_pane.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   1. The component renders without throwing.
//   2. The `graph-canvas-root` test id is present so downstream
//      rendering tasks can target the canvas root.
//   3. The ReactFlow library actually mounted — the `.react-flow`
//      class (the wrapper ReactFlow stamps on its outermost element)
//      is present in the rendered DOM.
//   4. The background grid renders — `.react-flow__background` is
//      present in the rendered DOM.
//   5. The canvas mounts with no nodes / no edges — the
//      `.react-flow__node` and `.react-flow__edge` selectors find
//      nothing. This pins the "empty initial state" decision so the
//      downstream rendering tasks have a clean baseline.
//
// ReactFlow internally uses `ResizeObserver`; happy-dom doesn't ship
// one by default. We stub a no-op `ResizeObserver` once at the suite
// level so the canvas mounts cleanly under the test environment.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { GraphCanvasPane } from './GraphCanvasPane';

beforeAll(() => {
  // ReactFlow's core observes its container with ResizeObserver to
  // recompute viewport dims. happy-dom doesn't implement it; without
  // a stub, mounting the canvas throws `ResizeObserver is not defined`.
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
      NoopResizeObserver;
  }
  // ReactFlow also reads `DOMMatrixReadOnly` for some transforms;
  // happy-dom provides it. No additional stub needed at this layer.
});

afterEach(() => {
  cleanup();
});

describe('GraphCanvasPane — ReactFlow mount', () => {
  it('renders without throwing', () => {
    expect(() => render(<GraphCanvasPane />)).not.toThrow();
  });

  it('exposes the graph-canvas-root test id', () => {
    render(<GraphCanvasPane />);
    expect(screen.getByTestId('graph-canvas-root')).toBeTruthy();
  });

  it('mounts the ReactFlow wrapper element', () => {
    // ReactFlow's outermost wrapper carries the `.react-flow` class.
    // If the import resolves but the library doesn't mount, this
    // selector returns nothing — the test catches a broken bundle
    // or a broken peer-dep resolution.
    const { container } = render(<GraphCanvasPane />);
    const wrapper = container.querySelector('.react-flow');
    expect(wrapper).not.toBeNull();
  });

  it('renders the background grid', () => {
    // The `<Background />` child stamps a `.react-flow__background`
    // node into the canvas. Pins the decision to ship the dot-grid
    // background in this task.
    const { container } = render(<GraphCanvasPane />);
    const background = container.querySelector('.react-flow__background');
    expect(background).not.toBeNull();
  });

  it('starts with no nodes and no edges', () => {
    // The empty initial state is load-bearing: downstream rendering
    // tasks (`mod_node_rendering`, `mod_edge_rendering`) read events
    // from the WS store and populate the canvas. If this baseline
    // ever ships with stub nodes/edges, downstream tasks have to
    // route around them. Pin the empty start here.
    const { container } = render(<GraphCanvasPane />);
    expect(container.querySelectorAll('.react-flow__node').length).toBe(0);
    expect(container.querySelectorAll('.react-flow__edge').length).toBe(0);
  });
});
