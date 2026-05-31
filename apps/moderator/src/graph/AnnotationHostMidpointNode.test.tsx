// Tests for `<AnnotationHostMidpointNode>` — the invisible 1×1
// synthetic node used as the tether endpoint for an edge-hosted
// annotation's `AnnotationHostEdge`. (Decision §3 framed this as the
// 0×0 limit case; the implementation lifts to 1×1 because ReactFlow
// 11.x skips handle-bounds measurement for a 0-dimension node — see
// the component header for the why.)
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_node_edge_host_midpoint.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//
//   1. The root `<div>` renders 1×1 with `pointer-events: none`
//      (Decisions §3 + §7 — effectively invisible and click-through).
//   2. `data-testid` mirrors the `data.hostEdgeId` field through the
//      deterministic `annotation-host-midpoint-<edge-id>` shape.
//   3. The DOM root carries a `data-host-edge-id="<edge-id>"`
//      attribute for diagnosis (Decision §8 — mirrors `data-annotation-
//      kind` on `<AnnotationNode>`).
//   4. The node has no visible text content (the midpoint is a UI
//      scaffold, not a card).

import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  render as rtlRender,
  screen,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import { act, type ReactElement } from 'react';
import { ReactFlowProvider, type NodeProps } from 'reactflow';

import {
  ANNOTATION_HOST_MIDPOINT_NODE_TYPE,
  AnnotationHostMidpointNode,
  type AnnotationHostMidpointNodeData,
} from './AnnotationHostMidpointNode';

async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(ui, options);
    return Promise.resolve();
  });
  return result;
}

function makeProps(
  id: string,
  data: AnnotationHostMidpointNodeData,
): NodeProps<AnnotationHostMidpointNodeData> {
  return {
    id,
    data,
    type: ANNOTATION_HOST_MIDPOINT_NODE_TYPE,
    selected: false,
    isConnectable: false,
    xPos: 0,
    yPos: 0,
    dragging: false,
    zIndex: 0,
    targetPosition: undefined as never,
    sourcePosition: undefined as never,
  };
}

afterEach(() => {
  cleanup();
});

describe('AnnotationHostMidpointNode', () => {
  it('renders a 1×1 div with pointer-events: none', async () => {
    const edgeId = '00000000-0000-4000-8000-0000000000e1';
    const id = `annotation-host-midpoint-${edgeId}`;
    const props = makeProps(id, { hostEdgeId: edgeId });
    await render(
      <ReactFlowProvider>
        <AnnotationHostMidpointNode {...props} />
      </ReactFlowProvider>,
    );
    const root = screen.getByTestId(`annotation-host-midpoint-${edgeId}`);
    expect(root.style.width).toBe('1px');
    expect(root.style.height).toBe('1px');
    expect(root.style.pointerEvents).toBe('none');
  });

  it('stamps data-testid="annotation-host-midpoint-<edge-id>" derived from data.hostEdgeId', async () => {
    const edgeId = 'edge-host-pin';
    const id = `annotation-host-midpoint-${edgeId}`;
    const props = makeProps(id, { hostEdgeId: edgeId });
    await render(
      <ReactFlowProvider>
        <AnnotationHostMidpointNode {...props} />
      </ReactFlowProvider>,
    );
    expect(screen.getByTestId(`annotation-host-midpoint-${edgeId}`)).toBeTruthy();
  });

  it('stamps data-host-edge-id="<edge-id>" on the DOM root (Decision §8)', async () => {
    const edgeId = 'edge-host-attr';
    const id = `annotation-host-midpoint-${edgeId}`;
    const props = makeProps(id, { hostEdgeId: edgeId });
    await render(
      <ReactFlowProvider>
        <AnnotationHostMidpointNode {...props} />
      </ReactFlowProvider>,
    );
    const root = screen.getByTestId(`annotation-host-midpoint-${edgeId}`);
    expect(root.getAttribute('data-host-edge-id')).toBe(edgeId);
  });

  it('renders no visible text content (the midpoint is a UI scaffold)', async () => {
    const edgeId = 'edge-no-text';
    const id = `annotation-host-midpoint-${edgeId}`;
    const props = makeProps(id, { hostEdgeId: edgeId });
    await render(
      <ReactFlowProvider>
        <AnnotationHostMidpointNode {...props} />
      </ReactFlowProvider>,
    );
    const root = screen.getByTestId(`annotation-host-midpoint-${edgeId}`);
    // Only the two ReactFlow handles live inside — no text nodes.
    expect(root.textContent).toBe('');
  });
});
