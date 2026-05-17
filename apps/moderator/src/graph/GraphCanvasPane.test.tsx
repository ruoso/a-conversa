// Tests for `<GraphCanvasPane>` — the moderator's ReactFlow canvas mount.
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md
// (prior:     tasks/refinements/moderator-ui/mod_annotation_rendering.md,
//             tasks/refinements/moderator-ui/mod_edge_rendering.md,
//             tasks/refinements/moderator-ui/mod_node_rendering.md,
//             tasks/refinements/moderator-ui/mod_graph_canvas_pane.md)
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
//   5. The canvas mounts with no nodes / no edges when the session
//      has no events — pinning the empty initial state.
//   6. `projectNodes` is a pure projection from a session's event log
//      to ReactFlow `Node<StatementNodeData>[]` (direct unit tests on
//      the function — no React, no i18next).
//   7. With a `node-created` event in the WS store, the canvas renders
//      one custom `StatementNode` whose wording + (placeholder) kind
//      label show up in the DOM.
//   8. With a `node-created` followed by a `proposal` (classify-node)
//      and a `commit` of that proposal, the rendered kind label flips
//      from the em-dash placeholder to the localized kind text.
//   9. With multiple `node-created` events, every node is rendered.
//  10. With `edge-created` events in the WS store, the canvas renders
//      one `.react-flow__edge` per event for the same session.
//  11. The edge count tracks `edge-created` events only — `node-created`
//      events do NOT contribute to the edge count (the projections are
//      disjoint).
//
// ReactFlow internally uses `ResizeObserver`; happy-dom doesn't ship
// one by default. We stub a no-op `ResizeObserver` once at the suite
// level so the canvas mounts cleanly under the test environment.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ComponentType } from 'react';
import i18next from 'i18next';
import type { AnnotationKind, DiagnosticPayload, Event } from '@a-conversa/shared-types';

// -- Mocks for the tidy-up button cases (mod_layout_tidy_action) -----
//
// Two module-level mocks are installed so the tidy-up cases at the
// bottom of this file can observe the click-handler's effects:
//
// 1. `./layoutEngine` is wrapped so `applyLayout` is a Vitest spy that
//    delegates to the real implementation but captures call args and
//    snapshots `options.cache.size` AT CALL TIME (the canvas writes
//    positions back into the cache after applyLayout returns, so a
//    post-hoc read would always see the populated state). The captured
//    sizes live on `applyLayoutSpy.sizesAtCall` for direct assertions.
//
// 2. `reactflow` is wrapped so `useReactFlow()` returns a `fitView`
//    Vitest spy. The spy is also installed on a global handle
//    (`__aConversaFitViewSpy`) so the tidy-up case can clear it
//    between iterations without re-importing.
//
// The mocks pass every other export through unchanged, so the rest of
// the test file's existing cases continue to exercise the real
// `applyLayout` / real `useReactFlow` semantics.
const sizesAtCall: number[] = [];
const applyLayoutSpy = vi.fn();
vi.mock('./layoutEngine', async () => {
  const actual = await vi.importActual<typeof import('./layoutEngine')>('./layoutEngine');
  return {
    ...actual,
    applyLayout: (...args: Parameters<typeof actual.applyLayout>) => {
      const opts = args[2] as { cache?: Map<string, unknown> } | undefined;
      sizesAtCall.push(opts?.cache?.size ?? -1);
      applyLayoutSpy(...args);
      return actual.applyLayout(...args);
    },
  };
});
// Attach the side array onto the spy for in-test reads.
(applyLayoutSpy as unknown as { sizesAtCall: number[] }).sizesAtCall = sizesAtCall;

const fitViewSpy = vi.fn();
(globalThis as unknown as { __aConversaFitViewSpy?: typeof fitViewSpy }).__aConversaFitViewSpy =
  fitViewSpy;
// Capture every prop set passed to `<ReactFlow>` so the `mod_pan_zoom`
// cases can assert against the configured behaviour-pinning props
// (`panOnDrag`, `zoomOnScroll`, `zoomOnPinch`, `zoomOnDoubleClick`,
// `minZoom`, `maxZoom`, and the deliberately-absent `defaultViewport`).
// The wrapper renders the real `ReactFlow` component unchanged, so the
// rest of the suite (which exercises the actual ReactFlow mount,
// background grid, node-handle measurement, click pipeline) keeps
// observing the genuine library behaviour.
const reactFlowPropCaptures: Record<string, unknown>[] = [];
vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow');
  const RealReactFlow = actual.default;
  const ReactFlowPassthrough = (props: Record<string, unknown>): unknown => {
    reactFlowPropCaptures.push(props);
    return createElement(RealReactFlow as unknown as ComponentType<Record<string, unknown>>, props);
  };
  return {
    ...actual,
    default: ReactFlowPassthrough,
    useReactFlow: () => {
      const real = actual.useReactFlow();
      return {
        ...real,
        fitView: fitViewSpy,
      };
    },
  };
});

import {
  GraphCanvasPane,
  MAX_ZOOM,
  MIN_ZOOM,
  buildEdgeMenuItems,
  buildNodeMenuItems,
  buildPaneMenuItems,
  handleEdgeClick,
  handleNodeClick,
  handlePaneClick,
  projectNodes,
} from './GraphCanvasPane';
import { CaptureTextInput } from '../layout/CaptureTextInput';
import { STATEMENT_NODE_TYPE } from './StatementNode';
import { applyLayout } from './layoutEngine';
import { projectDiagnosticHighlights } from './diagnosticHighlights';
import { selectEdgesForSession } from './selectors';
import { useWsStore } from '../ws/wsStore';
import { useCaptureStore, useSelectionStore } from '../stores';
import { createI18nInstance } from '@a-conversa/shell';

beforeAll(() => {
  // ReactFlow's core observes each node container with `ResizeObserver`
  // and only calls `updateNodeDimensions` (which populates the internal
  // `handleBounds` an edge needs to render) from inside the observer's
  // callback. happy-dom doesn't ship `ResizeObserver`. A bare noop stub
  // would let the mount complete but never fire the callback, so the
  // `.react-flow__edge` SVG `<path>` would stay unrendered — failing
  // the `mod_node_handle_rendering` edge-render assertion below.
  //
  // Install an active stub identical to the one in
  // `StatementEdge.test.tsx`: when `.observe(element)` is called,
  // synchronously fire the callback with one entry for that element.
  // The library reads `offsetWidth` off the entry's target rather than
  // the `contentRect` field, so the per-element rect we hand it doesn't
  // need to be exact — what matters is that the callback runs.
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

  // ReactFlow's dimension probe reads `offsetWidth` / `offsetHeight` on
  // each node element (via the internal `getDimensions(node)` helper).
  // happy-dom returns 0 for both, which makes ReactFlow's `doUpdate`
  // check fail (`dimensions.width && dimensions.height` is falsy) and
  // the node never gets `handleBounds` populated, so the edge renderer
  // skips the edge. Override the two properties to return a non-zero
  // pair on every HTMLElement so the measurement pass succeeds.
  // Similarly, `getHandleBounds` reads `getBoundingClientRect` on the
  // node + handle elements; happy-dom returns zero rects by default.
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
  // ReactFlow also reads `DOMMatrixReadOnly` for some transforms;
  // happy-dom provides it. No additional stub needed at this layer.
});

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

function makeNodeCreated(opts: { sequence: number; nodeId: string; wording: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x100 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: opts.nodeId,
      wording: opts.wording,
      created_by: ACTOR,
      created_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function makeClassifyProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
  classification: 'fact' | 'predictive' | 'value' | 'normative' | 'definitional';
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'classify-node',
        node_id: opts.nodeId,
        classification: opts.classification,
      },
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function makeCommit(opts: { sequence: number; proposalEnvelopeId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x200 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      proposal_id: opts.proposalEnvelopeId,
      moderator: ACTOR,
      committed_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function makeAnnotationCreated(opts: {
  sequence: number;
  annotationId: string;
  kind: AnnotationKind;
  content?: string;
  targetNodeId: string | null;
  targetEdgeId: string | null;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x400 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'annotation-created',
    actor: ACTOR,
    payload: {
      annotation_id: opts.annotationId,
      kind: opts.kind,
      content: opts.content ?? 'annotation body',
      target_node_id: opts.targetNodeId,
      target_edge_id: opts.targetEdgeId,
      created_by: ACTOR,
      created_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function makeEdgeCreated(opts: {
  sequence: number;
  edgeId: string;
  source: string;
  target: string;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x300 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'edge-created',
    actor: ACTOR,
    payload: {
      edge_id: opts.edgeId,
      role: 'supports',
      source_node_id: opts.source,
      target_node_id: opts.target,
      created_by: ACTOR,
      created_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

beforeEach(async () => {
  useWsStore.getState().reset();
  useSelectionStore.getState().clear();
  useCaptureStore.getState().reset();
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
  useSelectionStore.getState().clear();
  useCaptureStore.getState().reset();
});

describe('GraphCanvasPane — ReactFlow mount', () => {
  it('renders without throwing', () => {
    expect(() => render(<GraphCanvasPane sessionId={SESSION_ID} />)).not.toThrow();
  });

  it('exposes the graph-canvas-root test id', () => {
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    expect(screen.getByTestId('graph-canvas-root')).toBeTruthy();
  });

  it('mounts the ReactFlow wrapper element', () => {
    // ReactFlow's outermost wrapper carries the `.react-flow` class.
    // If the import resolves but the library doesn't mount, this
    // selector returns nothing — the test catches a broken bundle
    // or a broken peer-dep resolution.
    const { container } = render(<GraphCanvasPane sessionId={SESSION_ID} />);
    const wrapper = container.querySelector('.react-flow');
    expect(wrapper).not.toBeNull();
  });

  it('renders the background grid', () => {
    // The `<Background />` child stamps a `.react-flow__background`
    // node into the canvas. Pins the decision to ship the dot-grid
    // background from `mod_graph_canvas_pane`.
    const { container } = render(<GraphCanvasPane sessionId={SESSION_ID} />);
    const background = container.querySelector('.react-flow__background');
    expect(background).not.toBeNull();
  });

  it('starts with no nodes and no edges when the session has no events', () => {
    // The empty initial state is load-bearing: every subsequent test
    // assumes the canvas starts clean. With no events in the store
    // for SESSION_ID, the projection yields zero nodes.
    const { container } = render(<GraphCanvasPane sessionId={SESSION_ID} />);
    expect(container.querySelectorAll('.react-flow__node').length).toBe(0);
    expect(container.querySelectorAll('.react-flow__edge').length).toBe(0);
  });
});

describe('projectNodes — pure projection from events to ReactFlow nodes', () => {
  it('returns an empty array for an empty event log', () => {
    expect(projectNodes([])).toEqual([]);
  });

  it('emits one Node per node-created event with kind=null', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'first' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'second' }),
    ];
    const nodes = projectNodes(events);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.id).toBe(NODE_A);
    expect(nodes[0]?.type).toBe(STATEMENT_NODE_TYPE);
    expect(nodes[0]?.data).toEqual({
      wording: 'first',
      kind: null,
      annotations: [],
      facetStatuses: {},
      axiomMarks: [],
      pendingAxiomMarks: [],
      votesByFacet: {},
    });
    expect(nodes[1]?.id).toBe(NODE_B);
    expect(nodes[1]?.data).toEqual({
      wording: 'second',
      kind: null,
      annotations: [],
      facetStatuses: {},
      axiomMarks: [],
      pendingAxiomMarks: [],
      votesByFacet: {},
    });
  });

  it('emits every node at the placeholder origin (positions are owned by applyLayout per mod_layout_engine_choice)', () => {
    // `projectNodes` no longer assigns grid coordinates — the layout
    // engine (ADR 0025) overwrites each node's position before the
    // node reaches `<ReactFlow>`. The projection's contract here is
    // simply: every emitted node carries the placeholder `(0, 0)`,
    // and `applyLayout` produces a non-overlapping arrangement for
    // a connected pair.
    const events: Event[] = Array.from({ length: 6 }, (_, i) =>
      makeNodeCreated({
        sequence: i + 1,
        nodeId: `00000000-0000-4000-8000-${(0x300 + i).toString(16).padStart(12, '0')}`,
        wording: `w${i}`,
      }),
    );
    const projected = projectNodes(events);
    for (const node of projected) {
      expect(node.position).toEqual({ x: 0, y: 0 });
    }

    // Drive the projection through the layout engine for a parent→child
    // pair; the dagre TB direction places the parent above the child.
    const parentChild = projected.slice(0, 2);
    const laidOut = applyLayout(parentChild, [
      {
        id: 'parent->child',
        source: parentChild[0]?.id ?? '',
        target: parentChild[1]?.id ?? '',
        type: 'statement',
      },
    ]);
    expect(laidOut).toHaveLength(2);
    const parentY = laidOut[0]?.position.y ?? Number.NaN;
    const childY = laidOut[1]?.position.y ?? Number.NaN;
    expect(parentY).toBeLessThan(childY);
    // Distinct x AND y is sufficient for the "not all stacked at the
    // origin" baseline.
    expect(laidOut[0]?.position).not.toEqual(laidOut[1]?.position);
  });

  it('applies a committed classify-node proposal to the matching node', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'first' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const nodes = projectNodes(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.kind).toBe('fact');
  });

  it('leaves the node unclassified when the proposal exists but no commit has landed', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'first' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    ];
    const nodes = projectNodes(events);
    expect(nodes[0]?.data.kind).toBeNull();
  });

  it('ignores a commit referencing an unknown proposal id', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'first' }),
      makeCommit({ sequence: 2, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const nodes = projectNodes(events);
    expect(nodes[0]?.data.kind).toBeNull();
  });
});

describe('GraphCanvasPane — events from the WS store render as custom nodes', () => {
  it('renders one custom node with wording + placeholder kind when one node-created event lives in the store', () => {
    useWsStore.getState().applyEvent(
      makeNodeCreated({
        sequence: 1,
        nodeId: NODE_A,
        wording: 'The minimum wage should be raised.',
      }),
    );
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    // The custom StatementNode renders with the wording verbatim.
    expect(screen.getByTestId(`statement-node-${NODE_A}`)).toBeTruthy();
    expect(screen.getByTestId(`statement-node-wording-${NODE_A}`).textContent).toBe(
      'The minimum wage should be raised.',
    );
    // No classify-node commit has landed → em-dash placeholder.
    expect(screen.getByTestId(`statement-node-kind-${NODE_A}`).textContent).toBe('—');
  });

  it('flips the kind label to the localized text after a classify-node commit', () => {
    const store = useWsStore.getState();
    store.applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A node' }));
    store.applyEvent(
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'normative',
      }),
    );
    store.applyEvent(makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_A }));
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    // en-US is initialized in beforeEach; `normative` resolves to
    // "Normative" per packages/i18n-catalogs/src/catalogs/en-US.json.
    expect(screen.getByTestId(`statement-node-kind-${NODE_A}`).textContent).toBe('Normative');
  });

  it('renders every node when multiple node-created events live in the store', () => {
    const store = useWsStore.getState();
    store.applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'alpha' }));
    store.applyEvent(makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'beta' }));
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    expect(screen.getByTestId(`statement-node-wording-${NODE_A}`).textContent).toBe('alpha');
    expect(screen.getByTestId(`statement-node-wording-${NODE_B}`).textContent).toBe('beta');
  });
});

describe('GraphCanvasPane — store-derived edges (mod_edge_rendering)', () => {
  // The store-to-edges projection is the load-bearing surface
  // `mod_edge_rendering` shipped: `edge-created` events in the WS store
  // are projected into the `edges` array passed to `<ReactFlow>`. The
  // visible `.react-flow__edge` SVG DOM only appears once `<StatementNode>`
  // exposes ReactFlow `<Handle>` elements — which `mod_node_handle_rendering`
  // (the refinement at
  // `tasks/refinements/moderator-ui/mod_node_handle_rendering.md`) now
  // ships. The projection-level assertions below stay (the disjointness
  // between node and edge projections is still load-bearing); the new
  // `.react-flow__edge` count assertion lifts the formerly-deferred
  // "edges actually paint" check from the projection layer to the DOM
  // layer under happy-dom.
  it('projects every edge-created event into the canvas edge list', () => {
    const store = useWsStore.getState();
    store.applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }));
    store.applyEvent(makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'b' }));
    store.applyEvent(
      makeEdgeCreated({ sequence: 3, edgeId: 'edge-1', source: NODE_A, target: NODE_B }),
    );
    store.applyEvent(
      makeEdgeCreated({ sequence: 4, edgeId: 'edge-2', source: NODE_B, target: NODE_A }),
    );
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    // The canvas root mounts; that's the wiring this test cares about.
    expect(screen.getByTestId('graph-canvas-root')).toBeTruthy();
    // The store-side projection (which the component subscribes to via
    // `selectEdgesForSession`) reflects both edge-created events.
    const edges = selectEdgesForSession(useWsStore.getState(), SESSION_ID);
    expect(edges.map((e) => e.id)).toEqual(['edge-1', 'edge-2']);
    expect(edges.every((e) => e.type === 'statement')).toBe(true);
  });

  it('separates edge-created from node-created in the projection', () => {
    const store = useWsStore.getState();
    store.applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }));
    store.applyEvent(makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'b' }));
    store.applyEvent(
      makeEdgeCreated({ sequence: 3, edgeId: 'edge-1', source: NODE_A, target: NODE_B }),
    );
    const { container } = render(<GraphCanvasPane sessionId={SESSION_ID} />);
    // Two nodes render to the DOM (handles wiring lands later but the
    // node bodies render today via the custom `StatementNode`).
    expect(container.querySelectorAll('.react-flow__node').length).toBe(2);
    // The edges projection picks up exactly the one `edge-created`
    // event — the disjointness pins that node and edge projections
    // don't cross-contaminate.
    const edges = selectEdgesForSession(useWsStore.getState(), SESSION_ID);
    expect(edges.map((e) => e.id)).toEqual(['edge-1']);
    expect(edges[0]?.source).toBe(NODE_A);
    expect(edges[0]?.target).toBe(NODE_B);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_node_handle_rendering.md
  //
  // With `<Handle>` elements now on `<StatementNode>` (Position.Top
  // target + Position.Bottom source), ReactFlow's edge-renderer can
  // resolve every edge's endpoint coordinates and paint the SVG
  // `<path>` for each projected edge. This case lifts the
  // formerly-deferred "edges actually render" assertion from the
  // projection layer (the two cases above) to the DOM layer: for one
  // `edge-created` event in the store, exactly one `.react-flow__edge`
  // SVG group appears in the rendered canvas.
  it('renders one .react-flow__edge per edge-created event in the store', () => {
    const store = useWsStore.getState();
    store.applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }));
    store.applyEvent(makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'b' }));
    store.applyEvent(
      makeEdgeCreated({ sequence: 3, edgeId: 'edge-1', source: NODE_A, target: NODE_B }),
    );
    const { container } = render(<GraphCanvasPane sessionId={SESSION_ID} />);
    // Both nodes render.
    expect(container.querySelectorAll('.react-flow__node').length).toBe(2);
    // Exactly one edge SVG renders — the projection layer's edge list
    // (asserted above) is now reflected in the DOM because both nodes
    // expose `<Handle>` anchors at top + bottom.
    expect(container.querySelectorAll('.react-flow__edge').length).toBe(1);
  });
});

describe('projectNodes — annotation enrichment (mod_annotation_rendering)', () => {
  it('attaches a node-targeted annotation to the matching node data.annotations', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: 'anno-1',
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    ];
    const nodes = projectNodes(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.annotations).toHaveLength(1);
    expect(nodes[0]?.data.annotations[0]?.id).toBe('anno-1');
    expect(nodes[0]?.data.annotations[0]?.kind).toBe('note');
  });

  it('leaves a node with no matching annotation with an empty data.annotations array', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'b' }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: 'anno-1',
        kind: 'note',
        targetNodeId: NODE_B,
        targetEdgeId: null,
      }),
    ];
    const nodes = projectNodes(events);
    expect(nodes).toHaveLength(2);
    const nodeA = nodes.find((n) => n.id === NODE_A);
    const nodeB = nodes.find((n) => n.id === NODE_B);
    expect(nodeA?.data.annotations).toEqual([]);
    expect(nodeB?.data.annotations).toHaveLength(1);
    expect(nodeB?.data.annotations[0]?.id).toBe('anno-1');
  });
});

describe('GraphCanvasPane — annotation badges (mod_annotation_rendering)', () => {
  it('renders an annotation badge inside the target node card', () => {
    const store = useWsStore.getState();
    store.applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }));
    store.applyEvent(
      makeAnnotationCreated({
        sequence: 2,
        annotationId: 'anno-1',
        kind: 'reframe',
        content: 'reframe to a value claim',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    );
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    // The node renders with the badge list container and the badge
    // inside it; the localized en-US label is "Reframe".
    expect(screen.getByTestId(`annotation-badge-list-node-${NODE_A}`)).toBeTruthy();
    const badge = screen.getByTestId('annotation-badge-anno-1');
    expect(badge.textContent).toBe('Reframe');
    expect(badge.getAttribute('data-annotation-kind')).toBe('reframe');
    expect(badge.getAttribute('title')).toBe('reframe to a value claim');
  });
});

describe('projectNodes — facet-status enrichment (mod_proposed_state_styling)', () => {
  it('attaches facetStatuses.classification === proposed to a node with a classify-node proposal and no commit', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    ];
    const nodes = projectNodes(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.facetStatuses).toEqual({ classification: 'proposed' });
  });

  it('leaves facetStatuses empty for a node with no facet-targeting proposals', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' })];
    const nodes = projectNodes(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.facetStatuses).toEqual({});
  });
});

describe('GraphCanvasPane — proposed-state node styling (mod_proposed_state_styling)', () => {
  it('renders the target node with border-dashed + data-facet-status when a classify-node proposal lives in the store', () => {
    const store = useWsStore.getState();
    store.applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'in-flight' }));
    store.applyEvent(
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    );
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    const card = screen.getByTestId(`statement-node-${NODE_A}`);
    expect(card.getAttribute('data-facet-status')).toBe('proposed');
    expect(card.className).toContain('border-dashed');
    expect(card.className).toContain('opacity-60');
  });
});

// -- Axiom-mark decoration (mod_axiom_mark_decoration) ----------------
//
// `projectNodes` enriches each emitted node's `data.axiomMarks` from the
// (committed) axiom-mark projection. The badge is rendered by
// `<StatementNode>` from that field. These cases pin both:
//
//   - The projection-level enrichment (a node gets the matching
//     committed marks; pre-commit proposals contribute nothing).
//   - The end-to-end render path through the canvas: a node-created +
//     axiom-mark proposal + commit yield a rendered badge inside the
//     node card.

// Hash bucket 1 (sum-of-hex-digits = 13 mod 6 = 1). See the same
// constants in `selectors.test.ts` for the rationale.
const PARTICIPANT_A = '00000000-0000-4000-8000-000000000001';
const AXIOM_PROPOSAL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001';

function makeAxiomMarkProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
  participantId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: opts.participantId,
    payload: {
      proposal: {
        kind: 'axiom-mark',
        node_id: opts.nodeId,
        participant: opts.participantId,
      },
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

describe('projectNodes — axiom-mark enrichment (mod_axiom_mark_decoration)', () => {
  it('attaches a committed axiom-mark to the matching node data.axiomMarks', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a bedrock statement' }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: AXIOM_PROPOSAL_A,
        nodeId: NODE_A,
        participantId: PARTICIPANT_A,
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: AXIOM_PROPOSAL_A }),
    ];
    const nodes = projectNodes(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.axiomMarks).toHaveLength(1);
    expect(nodes[0]?.data.axiomMarks[0]?.participantId).toBe(PARTICIPANT_A);
    expect(nodes[0]?.data.axiomMarks[0]?.nodeId).toBe(NODE_A);
  });

  it('leaves data.axiomMarks empty when the proposal exists but no commit has landed', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: AXIOM_PROPOSAL_A,
        nodeId: NODE_A,
        participantId: PARTICIPANT_A,
      }),
      // No commit — the badge does NOT render pre-commit per the
      // refinement's "committed-only" decision.
    ];
    const nodes = projectNodes(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.axiomMarks).toEqual([]);
  });
});

describe('GraphCanvasPane — axiom-mark badges (mod_axiom_mark_decoration)', () => {
  it('renders an axiom-mark badge inside the target node card after a committed axiom-mark proposal', () => {
    const store = useWsStore.getState();
    store.applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'bedrock' }));
    store.applyEvent(
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: AXIOM_PROPOSAL_A,
        nodeId: NODE_A,
        participantId: PARTICIPANT_A,
      }),
    );
    store.applyEvent(makeCommit({ sequence: 3, proposalEnvelopeId: AXIOM_PROPOSAL_A }));
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    // The axiom-mark badge list container renders on the node card and
    // contains the per-participant badge. The badge's `data-participant-id`
    // is the stable selector.
    expect(screen.getByTestId(`axiom-mark-list-node-${NODE_A}`)).toBeTruthy();
    const badge = screen.getByTestId(`axiom-mark-badge-${NODE_A}-${PARTICIPANT_A}`);
    expect(badge.getAttribute('data-participant-id')).toBe(PARTICIPANT_A);
    expect(badge.textContent).toBe('A');
  });
});

// -- Pending axiom-mark decoration (mod_axiom_mark_pending_render) ----
//
// `projectNodes` enriches each emitted node's `data.pendingAxiomMarks`
// from the pending axiom-mark projection — the same single-up-front-
// pass pattern the committed enrichment uses. The pending badge is
// rendered by `<StatementNode>` from that field. These cases pin both:
//
//   - The projection-level enrichment (a node gets the matching
//     pending marks; a commit removes the entry).
//   - The end-to-end render path through the canvas: a node-created +
//     pending axiom-mark proposal (no commit) renders the pending
//     badge inside the node card.

describe('projectNodes — pending axiom-mark enrichment (mod_axiom_mark_pending_render)', () => {
  it('attaches a pending axiom-mark to the matching node data.pendingAxiomMarks', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a proposed-bedrock statement' }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: AXIOM_PROPOSAL_A,
        nodeId: NODE_A,
        participantId: PARTICIPANT_A,
      }),
      // No commit, no meta-disagreement-marked — the proposal stays
      // pending.
    ];
    const nodes = projectNodes(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.pendingAxiomMarks).toHaveLength(1);
    expect(nodes[0]?.data.pendingAxiomMarks[0]?.participantId).toBe(PARTICIPANT_A);
    expect(nodes[0]?.data.pendingAxiomMarks[0]?.nodeId).toBe(NODE_A);
    expect(nodes[0]?.data.pendingAxiomMarks[0]?.proposalEventId).toBe(AXIOM_PROPOSAL_A);
  });

  it('leaves data.pendingAxiomMarks empty after the commit terminator (the proposal moved from pending to committed)', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: AXIOM_PROPOSAL_A,
        nodeId: NODE_A,
        participantId: PARTICIPANT_A,
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: AXIOM_PROPOSAL_A }),
    ];
    const nodes = projectNodes(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.pendingAxiomMarks).toEqual([]);
    // Sanity — the committed-side enrichment surfaces it as committed.
    expect(nodes[0]?.data.axiomMarks).toHaveLength(1);
  });
});

describe('GraphCanvasPane — pending axiom-mark badges (mod_axiom_mark_pending_render)', () => {
  it('renders a pending axiom-mark badge inside the target node card after an uncommitted axiom-mark proposal', () => {
    const store = useWsStore.getState();
    store.applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'pending bedrock' }));
    store.applyEvent(
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: AXIOM_PROPOSAL_A,
        nodeId: NODE_A,
        participantId: PARTICIPANT_A,
      }),
    );
    // No commit yet — the proposal is pending.
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    // The pending badge list container renders on the node card and
    // contains the per-participant pending badge. The badge stamps
    // `data-pending="true"` (the new stable seam from Decision §5).
    expect(screen.getByTestId(`pending-axiom-mark-list-node-${NODE_A}`)).toBeTruthy();
    const badge = screen.getByTestId(`pending-axiom-mark-badge-${NODE_A}-${PARTICIPANT_A}`);
    expect(badge.getAttribute('data-participant-id')).toBe(PARTICIPANT_A);
    expect(badge.getAttribute('data-pending')).toBe('true');
    expect(badge.textContent).toBe('A');
    // The committed row is NOT present until the commit lands.
    expect(screen.queryByTestId(`axiom-mark-list-node-${NODE_A}`)).toBeNull();
  });
});

// -- Click-to-select handlers (mod_selection) -------------------------
//
// The canvas wires ReactFlow's `onNodeClick` / `onEdgeClick` /
// `onPaneClick` props to module-scope handlers that write to
// `useSelectionStore`. Two layers of assertion:
//
//   1. Direct handler invocation — pinning the store-update contract.
//      ReactFlow's internal click pipeline (which gates the user-facing
//      `onNodeClick` callback on `nodeInternals.get(id)` returning a
//      measured node) doesn't fire in happy-dom because the internal
//      node map is populated by ResizeObserver measurements that don't
//      run under the no-op observer stub. Calling the handler the way
//      ReactFlow would call it pins the wire-up regardless.
//
//   2. End-to-end via the store — selecting a node via the store and
//      verifying the rendered DOM picks up `data-selected="true"`.
//      Confirms the read-side (the per-card selector subscription in
//      `<StatementNode>`) is wired in the live canvas tree.

describe('GraphCanvasPane — click-to-select handlers (mod_selection)', () => {
  it('handleNodeClick writes { kind: "node", id } to the selection store', () => {
    expect(useSelectionStore.getState().selected).toBeNull();
    handleNodeClick(undefined, { id: NODE_A } as Parameters<typeof handleNodeClick>[1]);
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'node', id: NODE_A });
  });

  it('handleEdgeClick writes { kind: "edge", id } to the selection store', () => {
    expect(useSelectionStore.getState().selected).toBeNull();
    handleEdgeClick(undefined, {
      id: 'edge-7',
      source: NODE_A,
      target: NODE_B,
    });
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'edge', id: 'edge-7' });
  });

  it('handlePaneClick clears the selection store', () => {
    useSelectionStore.getState().select({ kind: 'node', id: NODE_A });
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'node', id: NODE_A });
    handlePaneClick();
    expect(useSelectionStore.getState().selected).toBeNull();
  });

  it('handleNodeClick overrides a prior edge selection (last-write-wins)', () => {
    useSelectionStore.getState().select({ kind: 'edge', id: 'edge-prior' });
    handleNodeClick(undefined, { id: NODE_B } as Parameters<typeof handleNodeClick>[1]);
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'node', id: NODE_B });
  });
});

describe('GraphCanvasPane — selection visual layer (mod_selection)', () => {
  it('the rendered StatementNode picks up data-selected="true" once the store is updated', () => {
    // Confirms the read-side subscription inside `<StatementNode>` is
    // wired into the canvas tree: writing to the store flips the
    // attribute on the corresponding rendered card.
    useWsStore.getState().applyEvent(
      makeNodeCreated({
        sequence: 1,
        nodeId: NODE_A,
        wording: 'select me',
      }),
    );
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    const card = screen.getByTestId(`statement-node-${NODE_A}`);
    expect(card.getAttribute('data-selected')).toBe('false');

    // Drive the store the way the handler would. The store-update path
    // ends in a React re-render of the subscribed `<StatementNode>`;
    // `act(...)` flushes the resulting render queue synchronously so the
    // post-assertions see the updated DOM.
    act(() => {
      handleNodeClick(undefined, { id: NODE_A } as Parameters<typeof handleNodeClick>[1]);
    });

    // The same card now reflects the selection.
    expect(card.getAttribute('data-selected')).toBe('true');
    expect(card.className).toContain('ring-4');
    expect(card.className).toContain('ring-sky-500');
  });
});

// -- Context-menu builders (mod_context_menus) ------------------------
//
// `buildNodeMenuItems` / `buildEdgeMenuItems` / `buildPaneMenuItems` are
// pure factories that produce the `MenuItem[]` arrays the menu shell
// consumes. Unit-testing them here pins the per-target action vocabulary
// (which stubs live on the node menu vs edge menu vs pane menu) — the
// downstream tasks that replace each stub with a real handler can swap
// the `onSelect` body without changing this contract.
describe('GraphCanvasPane — context-menu item factories (mod_context_menus)', () => {
  it('buildNodeMenuItems returns the seven node-scope actions in order (run-operationalization-test lands between propose-interpretive-split and propose-meta-disagreement per mod_operationalization_mode Decision §D5)', () => {
    const items = buildNodeMenuItems({ kind: 'node', id: NODE_A });
    expect(items.map((it) => it.id)).toEqual([
      'propose-vote',
      'propose-decompose',
      'propose-interpretive-split',
      'run-operationalization-test',
      'propose-meta-disagreement',
      'annotate',
      'axiom-mark',
    ]);
    expect(items.map((it) => it.labelKey)).toEqual([
      'moderator.contextMenu.node.proposeVote',
      'moderator.contextMenu.node.proposeDecompose',
      'moderator.contextMenu.node.proposeInterpretiveSplit',
      'moderator.contextMenu.node.runOperationalization',
      'moderator.contextMenu.node.proposeMetaDisagreement',
      'moderator.contextMenu.node.annotate',
      'moderator.contextMenu.node.axiomMark',
    ]);
  });

  it('buildEdgeMenuItems returns the three edge-scope actions in order', () => {
    const items = buildEdgeMenuItems({ kind: 'edge', id: 'edge-9' });
    expect(items.map((it) => it.id)).toEqual([
      'propose-vote',
      'propose-meta-disagreement',
      'annotate',
    ]);
    expect(items.map((it) => it.labelKey)).toEqual([
      'moderator.contextMenu.edge.proposeVote',
      'moderator.contextMenu.edge.proposeMetaDisagreement',
      'moderator.contextMenu.edge.annotate',
    ]);
  });

  it('buildPaneMenuItems returns the single create-statement action', () => {
    const items = buildPaneMenuItems({ kind: 'pane', id: null });
    expect(items.map((it) => it.id)).toEqual(['create-statement']);
    expect(items[0]?.labelKey).toBe('moderator.contextMenu.pane.createStatement');
  });

  it('buildPaneMenuItems wires create-statement to the onCreateStatement handler when provided', () => {
    // Ad-hoc fix seam: the canvas threads in a real handler that focuses
    // the capture textarea. Without the optional argument, the legacy
    // actionStub is used (covered by the stub-onSelect case below).
    const handler = vi.fn();
    const items = buildPaneMenuItems({ kind: 'pane', id: null }, handler);
    expect(items).toHaveLength(1);
    items[0]?.onSelect();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('every menu-item stub onSelect runs without throwing (console.info placeholder)', () => {
    // Refinement decision: each stub `console.info`s and is replaced by
    // downstream tasks. Pin that the stubs are callable today — a future
    // refactor that breaks the stub signature would fail this case.
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      for (const item of buildNodeMenuItems({ kind: 'node', id: NODE_A })) {
        expect(() => item.onSelect()).not.toThrow();
      }
      for (const item of buildEdgeMenuItems({ kind: 'edge', id: 'edge-9' })) {
        expect(() => item.onSelect()).not.toThrow();
      }
      for (const item of buildPaneMenuItems({ kind: 'pane', id: null })) {
        expect(() => item.onSelect()).not.toThrow();
      }
      // 7 + 3 + 1 = 11 stub fires (the node menu grew by the
      // run-operationalization-test item — mod_operationalization_mode).
      expect(infoSpy).toHaveBeenCalledTimes(11);
    } finally {
      infoSpy.mockRestore();
    }
  });

  // Refinement: tasks/refinements/moderator-ui/mod_decompose_mode.md
  //
  // The propose-decompose item gains an optional handler-factory
  // parameter (same shape as `onOpenAxiomMarkSubmenu`). When omitted,
  // the legacy stub path is retained — pin both branches so the
  // factory-extension cannot regress.
  it('buildNodeMenuItems (no extra args) wires propose-decompose to the legacy actionStub', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const items = buildNodeMenuItems({ kind: 'node', id: NODE_A });
      const decompose = items.find((it) => it.id === 'propose-decompose');
      expect(decompose).toBeDefined();
      decompose?.onSelect();
      // The stub's signature is `actionStub('propose-decompose', target)`;
      // it logs via console.info exactly once per activation.
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy.mock.calls[0]?.[0]).toContain('propose-decompose');
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('buildNodeMenuItems wires propose-decompose to onEnterDecomposeMode when supplied', () => {
    const onEnter = vi.fn<(nodeId: string) => void>();
    const items = buildNodeMenuItems({ kind: 'node', id: NODE_A }, undefined, onEnter);
    const decompose = items.find((it) => it.id === 'propose-decompose');
    expect(decompose).toBeDefined();
    decompose?.onSelect();
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledWith(NODE_A);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
  //
  // The propose-interpretive-split item adds a fourth optional handler
  // parameter to `buildNodeMenuItems` (peer to `onEnterDecomposeMode`).
  // Same shape: when omitted, the legacy stub runs; when supplied, the
  // handler is invoked with the target node id.
  it('buildNodeMenuItems (no extra args) wires propose-interpretive-split to the legacy actionStub', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const items = buildNodeMenuItems({ kind: 'node', id: NODE_A });
      const isplit = items.find((it) => it.id === 'propose-interpretive-split');
      expect(isplit).toBeDefined();
      isplit?.onSelect();
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy.mock.calls[0]?.[0]).toContain('propose-interpretive-split');
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('buildNodeMenuItems wires propose-interpretive-split to onEnterInterpretiveSplitMode when supplied', () => {
    const onEnter = vi.fn<(nodeId: string) => void>();
    const items = buildNodeMenuItems({ kind: 'node', id: NODE_A }, undefined, undefined, onEnter);
    const isplit = items.find((it) => it.id === 'propose-interpretive-split');
    expect(isplit).toBeDefined();
    isplit?.onSelect();
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledWith(NODE_A);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_operationalization_mode.md
  //
  // The run-operationalization-test item adds a fifth optional handler
  // parameter to `buildNodeMenuItems` (peer to the decompose / interpretive
  // -split seams) plus a sixth `disabled` boolean argument computed by the
  // canvas call site from `disputationOutcome(node.facetStatuses.substance)`.
  // When omitted, the legacy stub path is retained and the item is enabled.
  it('buildNodeMenuItems (no extra args) wires run-operationalization-test to the legacy actionStub', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const items = buildNodeMenuItems({ kind: 'node', id: NODE_A });
      const op = items.find((it) => it.id === 'run-operationalization-test');
      expect(op).toBeDefined();
      op?.onSelect();
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy.mock.calls[0]?.[0]).toContain('run-operationalization-test');
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('buildNodeMenuItems wires run-operationalization-test to onEnterOperationalizationMode when supplied (node target)', () => {
    const onEnter = vi.fn<(nodeId: string) => void>();
    const items = buildNodeMenuItems(
      { kind: 'node', id: NODE_A },
      undefined,
      undefined,
      undefined,
      onEnter,
    );
    const op = items.find((it) => it.id === 'run-operationalization-test');
    expect(op).toBeDefined();
    op?.onSelect();
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledWith(NODE_A);
  });

  it('buildNodeMenuItems falls back to actionStub for run-operationalization-test on non-node targets', () => {
    // Defensive — buildNodeMenuItems is only called for node targets in
    // practice, but a non-node target shape must not throw and must not
    // dispatch the per-node mode-entry handler.
    const onEnter = vi.fn<(nodeId: string) => void>();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const items = buildNodeMenuItems(
        { kind: 'pane', id: null },
        undefined,
        undefined,
        undefined,
        onEnter,
      );
      const op = items.find((it) => it.id === 'run-operationalization-test');
      expect(op).toBeDefined();
      op?.onSelect();
      expect(onEnter).not.toHaveBeenCalled();
      expect(
        infoSpy.mock.calls.some((c) => String(c[0]).includes('run-operationalization-test')),
      ).toBe(true);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('buildNodeMenuItems defaults the run-operationalization-test item to enabled when the disabled flag is omitted', () => {
    const items = buildNodeMenuItems({ kind: 'node', id: NODE_A });
    const op = items.find((it) => it.id === 'run-operationalization-test');
    expect(op).toBeDefined();
    expect(op?.disabled).toBe(false);
  });

  it('buildNodeMenuItems marks run-operationalization-test as disabled when the disabled flag is true', () => {
    const items = buildNodeMenuItems(
      { kind: 'node', id: NODE_A },
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
    const op = items.find((it) => it.id === 'run-operationalization-test');
    expect(op?.disabled).toBe(true);
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_decompose_mode.md
//
// End-to-end wire-up of the propose-decompose context menu item:
// right-click a rendered node → click "Propose decompose" → the
// capture store flips mode to 'decompose' and stashes the right-clicked
// node id in `decomposeTargetNodeId`. The canvas's
// `enterDecomposeMode` callback (threaded into `buildNodeMenuItems`)
// is the bridge under test.
describe('GraphCanvasPane — propose-decompose mode entry (mod_decompose_mode)', () => {
  it('right-clicking a node and clicking "Propose decompose" enters decompose mode for that node', () => {
    useWsStore.getState().applyEvent(
      makeNodeCreated({
        sequence: 1,
        nodeId: NODE_A,
        wording: 'A statement to decompose.',
      }),
    );
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    expect(useCaptureStore.getState().mode).toBe('idle');
    expect(useCaptureStore.getState().decomposeTargetNodeId).toBeNull();

    const card = screen.getByTestId(`statement-node-${NODE_A}`);
    act(() => {
      fireEvent.contextMenu(card, { clientX: 10, clientY: 20 });
    });
    const decomposeItem = screen.getByTestId('graph-context-menu-item-propose-decompose');
    expect(decomposeItem).toBeTruthy();

    act(() => {
      fireEvent.click(decomposeItem);
    });

    // The store flipped atomically to decompose mode for the
    // right-clicked node. The menu auto-closes on item activation
    // (per the menu shell contract — covered separately).
    expect(useCaptureStore.getState().mode).toBe('decompose');
    expect(useCaptureStore.getState().decomposeTargetNodeId).toBe(NODE_A);
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
//
// Sibling end-to-end wire-up for the propose-interpretive-split item.
describe('GraphCanvasPane — propose-interpretive-split mode entry (mod_interpretive_split_mode)', () => {
  it('right-clicking a node and clicking "Propose interpretive split" enters interpretive-split mode for that node', () => {
    useWsStore.getState().applyEvent(
      makeNodeCreated({
        sequence: 1,
        nodeId: NODE_A,
        wording: 'A statement to split.',
      }),
    );
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    expect(useCaptureStore.getState().mode).toBe('idle');
    expect(useCaptureStore.getState().interpretiveSplitTargetNodeId).toBeNull();

    const card = screen.getByTestId(`statement-node-${NODE_A}`);
    act(() => {
      fireEvent.contextMenu(card, { clientX: 10, clientY: 20 });
    });
    const item = screen.getByTestId('graph-context-menu-item-propose-interpretive-split');
    expect(item).toBeTruthy();

    act(() => {
      fireEvent.click(item);
    });

    expect(useCaptureStore.getState().mode).toBe('interpretive-split');
    expect(useCaptureStore.getState().interpretiveSplitTargetNodeId).toBe(NODE_A);
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_operationalization_mode.md
//
// End-to-end wire-up of the run-operationalization-test context menu
// item plus the methodology gate. The gate computation at the canvas
// call site reads `node.data.facetStatuses.substance` and disables the
// item unless `disputationOutcome(...) === 'claim'`. These cases pin
// (a) the disabled-when-no-substance default,
// (b) the disabled-when-data path (substance facet agreed),
// (c) the enabled-when-claim path (substance facet disputed via a
//     dispute vote on a `set-node-substance` proposal),
// (d) the click-through wiring to `enterOperationalizationMode`.
describe('GraphCanvasPane — run-operationalization-test entry (mod_operationalization_mode)', () => {
  const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000a1';
  const PARTICIPANT_B = '00000000-0000-4000-8000-0000000000a2';
  const SUBSTANCE_PROPOSAL = '00000000-0000-4000-8000-0000000000b1';

  function makeParticipantJoined(opts: {
    sequence: number;
    userId: string;
    role: 'debater-A' | 'debater-B';
  }): Event {
    return {
      id: `00000000-0000-4000-8000-${(0x500 + opts.sequence).toString(16).padStart(12, '0')}`,
      sessionId: SESSION_ID,
      sequence: opts.sequence,
      kind: 'participant-joined',
      actor: opts.userId,
      payload: {
        user_id: opts.userId,
        screen_name: `user-${opts.sequence}`,
        role: opts.role,
        joined_at: '2026-05-11T00:00:00.000Z',
      },
      createdAt: '2026-05-11T00:00:00.000Z',
    };
  }

  function makeSetNodeSubstanceProposal(opts: {
    sequence: number;
    envelopeId: string;
    nodeId: string;
    value: 'agreed' | 'disputed';
  }): Event {
    return {
      id: opts.envelopeId,
      sessionId: SESSION_ID,
      sequence: opts.sequence,
      kind: 'proposal',
      actor: ACTOR,
      payload: {
        proposal: {
          kind: 'set-node-substance',
          node_id: opts.nodeId,
          value: opts.value,
        },
      },
      createdAt: '2026-05-11T00:00:00.000Z',
    };
  }

  function makeVote(opts: {
    sequence: number;
    proposalId: string;
    participant: string;
    vote: 'agree' | 'dispute' | 'withdraw';
  }): Event {
    return {
      id: `00000000-0000-4000-8000-${(0x600 + opts.sequence).toString(16).padStart(12, '0')}`,
      sessionId: SESSION_ID,
      sequence: opts.sequence,
      kind: 'vote',
      actor: opts.participant,
      payload: {
        proposal_id: opts.proposalId,
        participant: opts.participant,
        vote: opts.vote,
        voted_at: '2026-05-11T00:00:10.000Z',
      },
      createdAt: '2026-05-11T00:00:10.000Z',
    };
  }

  it('right-clicking a node whose substance facet is absent renders the item disabled (no disputation reading yet)', () => {
    useWsStore.getState().applyEvent(
      makeNodeCreated({
        sequence: 1,
        nodeId: NODE_A,
        wording: 'A statement with no substance facet.',
      }),
    );
    render(<GraphCanvasPane sessionId={SESSION_ID} />);

    const card = screen.getByTestId(`statement-node-${NODE_A}`);
    act(() => {
      fireEvent.contextMenu(card, { clientX: 10, clientY: 20 });
    });
    const item = screen.getByTestId('graph-context-menu-item-run-operationalization-test');
    expect(item).toBeTruthy();
    expect(item.hasAttribute('disabled')).toBe(true);
    expect(item.getAttribute('aria-disabled')).toBe('true');

    // Click is a no-op on the disabled item — the mode does not change.
    act(() => {
      fireEvent.click(item);
    });
    expect(useCaptureStore.getState().mode).toBe('idle');
    expect(useCaptureStore.getState().operationalizationTargetNodeId).toBeNull();
  });

  it('right-clicking a node whose substance facet is agreed (disputation outcome data) renders the item disabled', () => {
    const store = useWsStore.getState();
    store.applyEvent(
      makeParticipantJoined({ sequence: 1, userId: PARTICIPANT_A, role: 'debater-A' }),
    );
    store.applyEvent(
      makeParticipantJoined({ sequence: 2, userId: PARTICIPANT_B, role: 'debater-B' }),
    );
    store.applyEvent(
      makeNodeCreated({ sequence: 3, nodeId: NODE_A, wording: 'Agreed-substance node.' }),
    );
    store.applyEvent(
      makeSetNodeSubstanceProposal({
        sequence: 4,
        envelopeId: SUBSTANCE_PROPOSAL,
        nodeId: NODE_A,
        value: 'agreed',
      }),
    );
    store.applyEvent(
      makeVote({
        sequence: 5,
        proposalId: SUBSTANCE_PROPOSAL,
        participant: PARTICIPANT_A,
        vote: 'agree',
      }),
    );
    store.applyEvent(
      makeVote({
        sequence: 6,
        proposalId: SUBSTANCE_PROPOSAL,
        participant: PARTICIPANT_B,
        vote: 'agree',
      }),
    );
    render(<GraphCanvasPane sessionId={SESSION_ID} />);

    const card = screen.getByTestId(`statement-node-${NODE_A}`);
    act(() => {
      fireEvent.contextMenu(card, { clientX: 10, clientY: 20 });
    });
    const item = screen.getByTestId('graph-context-menu-item-run-operationalization-test');
    expect(item.hasAttribute('disabled')).toBe(true);
    expect(item.getAttribute('aria-disabled')).toBe('true');
  });

  it('right-clicking a node whose substance facet is disputed (disputation outcome claim) renders the item enabled and a click enters operationalization mode', () => {
    const store = useWsStore.getState();
    store.applyEvent(
      makeParticipantJoined({ sequence: 1, userId: PARTICIPANT_A, role: 'debater-A' }),
    );
    store.applyEvent(
      makeParticipantJoined({ sequence: 2, userId: PARTICIPANT_B, role: 'debater-B' }),
    );
    store.applyEvent(
      makeNodeCreated({ sequence: 3, nodeId: NODE_A, wording: 'Disputed-substance node.' }),
    );
    store.applyEvent(
      makeSetNodeSubstanceProposal({
        sequence: 4,
        envelopeId: SUBSTANCE_PROPOSAL,
        nodeId: NODE_A,
        value: 'disputed',
      }),
    );
    // One dispute vote is enough to flip the facet to 'disputed'.
    store.applyEvent(
      makeVote({
        sequence: 5,
        proposalId: SUBSTANCE_PROPOSAL,
        participant: PARTICIPANT_A,
        vote: 'dispute',
      }),
    );
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    expect(useCaptureStore.getState().mode).toBe('idle');
    expect(useCaptureStore.getState().operationalizationTargetNodeId).toBeNull();

    const card = screen.getByTestId(`statement-node-${NODE_A}`);
    act(() => {
      fireEvent.contextMenu(card, { clientX: 10, clientY: 20 });
    });
    const item = screen.getByTestId('graph-context-menu-item-run-operationalization-test');
    expect(item.hasAttribute('disabled')).toBe(false);
    expect(item.getAttribute('aria-disabled')).toBe('false');

    act(() => {
      fireEvent.click(item);
    });

    expect(useCaptureStore.getState().mode).toBe('operationalization');
    expect(useCaptureStore.getState().operationalizationTargetNodeId).toBe(NODE_A);
  });
});

// -- Context-menu wire-up (mod_context_menus) -------------------------
//
// The handlers wire ReactFlow's `onNodeContextMenu` / `onEdgeContextMenu`
// / `onPaneContextMenu` to `useState` on the canvas; the menu renders
// when the state is non-null. Two layers of assertion:
//
//   1. The handlers themselves — driven via `contextmenu` events on the
//      node card / edge label (the DOM surfaces ReactFlow attaches its
//      own listeners to). Right-clicking a card opens a menu with the
//      node items; right-clicking the canvas root (pane) opens the
//      pane menu.
//   2. The close paths — clicking outside / Escape / clicking an item
//      closes the menu (the menu element disappears from the DOM).
describe('GraphCanvasPane — context-menu wire-up (mod_context_menus)', () => {
  it('right-clicking a rendered node opens the node menu with target=node', () => {
    useWsStore.getState().applyEvent(
      makeNodeCreated({
        sequence: 1,
        nodeId: NODE_A,
        wording: 'right-click me',
      }),
    );
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    // No menu before the right-click.
    expect(screen.queryByTestId('graph-context-menu')).toBeNull();

    // Fire a contextmenu event on the rendered card. The card lives
    // inside ReactFlow's node-renderer chain; ReactFlow's
    // `onNodeContextMenu` prop fires when the user right-clicks a
    // rendered node. `fireEvent.contextMenu` bubbles up through the
    // React event system to ReactFlow's listener.
    const card = screen.getByTestId(`statement-node-${NODE_A}`);
    act(() => {
      fireEvent.contextMenu(card, { clientX: 100, clientY: 200 });
    });

    const menu = screen.getByTestId('graph-context-menu');
    expect(menu.getAttribute('data-target-kind')).toBe('node');
    expect(menu.getAttribute('data-target-id')).toBe(NODE_A);
    expect(menu.style.top).toBe('200px');
    expect(menu.style.left).toBe('100px');

    // Every node-scope action item is rendered.
    expect(screen.getByTestId('graph-context-menu-item-propose-vote')).toBeTruthy();
    expect(screen.getByTestId('graph-context-menu-item-propose-decompose')).toBeTruthy();
    expect(screen.getByTestId('graph-context-menu-item-propose-interpretive-split')).toBeTruthy();
    expect(screen.getByTestId('graph-context-menu-item-run-operationalization-test')).toBeTruthy();
    expect(screen.getByTestId('graph-context-menu-item-propose-meta-disagreement')).toBeTruthy();
    expect(screen.getByTestId('graph-context-menu-item-annotate')).toBeTruthy();
    expect(screen.getByTestId('graph-context-menu-item-axiom-mark')).toBeTruthy();
  });

  it('right-clicking a node also selects it (mirrors desktop graph-editor convention)', () => {
    useWsStore.getState().applyEvent(
      makeNodeCreated({
        sequence: 1,
        nodeId: NODE_A,
        wording: 'select via right-click',
      }),
    );
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    expect(useSelectionStore.getState().selected).toBeNull();
    const card = screen.getByTestId(`statement-node-${NODE_A}`);
    act(() => {
      fireEvent.contextMenu(card, { clientX: 10, clientY: 20 });
    });
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'node', id: NODE_A });
  });

  it('right-clicking the pane (canvas background) opens the pane menu', () => {
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    expect(screen.queryByTestId('graph-context-menu')).toBeNull();

    // The pane right-click target is the ReactFlow pane background.
    // ReactFlow stamps the `react-flow__pane` class on it; in
    // happy-dom that element is present in the rendered tree.
    const paneEl = document.querySelector('.react-flow__pane');
    expect(paneEl).toBeTruthy();
    if (paneEl === null) return;
    act(() => {
      fireEvent.contextMenu(paneEl, { clientX: 50, clientY: 75 });
    });

    const menu = screen.getByTestId('graph-context-menu');
    expect(menu.getAttribute('data-target-kind')).toBe('pane');
    expect(menu.getAttribute('data-target-id')).toBe('');
    expect(screen.getByTestId('graph-context-menu-item-create-statement')).toBeTruthy();
  });

  it('selecting the pane menu "Create new statement" item focuses the capture textarea', () => {
    // Ad-hoc fix regression cover: the pane menu item shipped in
    // `mod_context_menus` had its onSelect set to a placeholder
    // actionStub. The canvas now threads a real handler that focuses
    // the bottom-strip capture textarea via `requestAnimationFrame`.
    //
    // The textarea lives in `<CaptureTextInput>`, which the moderator
    // shell mounts inside the bottom-strip slot. Rendering both the
    // canvas and the capture-text-input side-by-side here mirrors the
    // production tree well enough to drive the focus seam end-to-end
    // without the rest of the layout chrome.
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback): number => {
        cb(0);
        return 0;
      });
    try {
      render(
        <>
          <GraphCanvasPane sessionId={SESSION_ID} />
          <CaptureTextInput />
        </>,
      );
      const textarea = screen.getByTestId('capture-text-input-textarea');
      expect(document.activeElement).not.toBe(textarea);

      const paneEl = document.querySelector('.react-flow__pane');
      expect(paneEl).toBeTruthy();
      if (paneEl === null) return;
      act(() => {
        fireEvent.contextMenu(paneEl, { clientX: 50, clientY: 75 });
      });

      const item = screen.getByTestId('graph-context-menu-item-create-statement');
      act(() => {
        fireEvent.click(item);
      });

      // The menu closes on item-click; the focus lands on the textarea
      // inside the rAF callback (mocked to fire synchronously above).
      expect(document.activeElement).toBe(textarea);
      expect(screen.queryByTestId('graph-context-menu')).toBeNull();
    } finally {
      rafSpy.mockRestore();
    }
  });

  it('clicking a menu item closes the menu (action stubs are fire-and-close)', () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'w' }));
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    const card = screen.getByTestId(`statement-node-${NODE_A}`);
    act(() => {
      fireEvent.contextMenu(card, { clientX: 1, clientY: 2 });
    });
    expect(screen.getByTestId('graph-context-menu')).toBeTruthy();

    // Silence the stub's console.info noise while the menu item fires.
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      act(() => {
        fireEvent.click(screen.getByTestId('graph-context-menu-item-annotate'));
      });
    } finally {
      infoSpy.mockRestore();
    }

    expect(screen.queryByTestId('graph-context-menu')).toBeNull();
  });

  it('Escape closes an open context menu', () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'w' }));
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    const card = screen.getByTestId(`statement-node-${NODE_A}`);
    act(() => {
      fireEvent.contextMenu(card, { clientX: 1, clientY: 2 });
    });
    expect(screen.getByTestId('graph-context-menu')).toBeTruthy();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(screen.queryByTestId('graph-context-menu')).toBeNull();
  });

  it('an outside mousedown closes an open context menu', () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'w' }));
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    const card = screen.getByTestId(`statement-node-${NODE_A}`);
    act(() => {
      fireEvent.contextMenu(card, { clientX: 1, clientY: 2 });
    });
    expect(screen.getByTestId('graph-context-menu')).toBeTruthy();

    act(() => {
      fireEvent.mouseDown(document.body);
    });

    expect(screen.queryByTestId('graph-context-menu')).toBeNull();
  });
});

// -- Diagnostic-highlight enrichment + end-to-end render
//    (mod_diagnostic_highlighting) ---------------------------------
//
// `projectNodes(events, highlights)` enriches each emitted node's
// `data.diagnosticHighlight` from the precomputed index;
// `selectEdgesForSession(state, sessionId, highlights)` does the same
// for edges. The end-to-end cases drive a `fired` then `cleared`
// envelope through the store and assert the canvas card picks up the
// amber halo on fired and drops it on cleared.

function firedCycleDiagnostic(nodes: string[]): DiagnosticPayload {
  return {
    sessionId: SESSION_ID,
    kind: 'cycle',
    severity: 'blocking',
    status: 'fired',
    sequence: 99,
    diagnostic: { kind: 'cycle', nodes },
  };
}

function clearedCycleDiagnostic(nodes: string[]): DiagnosticPayload {
  return {
    sessionId: SESSION_ID,
    kind: 'cycle',
    severity: 'blocking',
    status: 'cleared',
    sequence: 100,
    diagnostic: { kind: 'cycle', nodes },
  };
}

describe('projectNodes — diagnostic-highlight enrichment (mod_diagnostic_highlighting)', () => {
  it('enriches data.diagnosticHighlight on a node whose id is in the highlights index', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'b' }),
    ];
    const payload = firedCycleDiagnostic([NODE_A, NODE_B]);
    const highlights = projectDiagnosticHighlights(new Map([['k', payload]]));
    const nodes = projectNodes(events, highlights);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.data.diagnosticHighlight).toEqual({
      severity: 'blocking',
      kinds: ['cycle'],
    });
    expect(nodes[1]?.data.diagnosticHighlight).toEqual({
      severity: 'blocking',
      kinds: ['cycle'],
    });
  });

  it('leaves data.diagnosticHighlight undefined for a node whose id is NOT in the highlights index', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' })];
    // Highlights only touch a different node id.
    const payload = firedCycleDiagnostic(['some-other-node-id', NODE_B]);
    const highlights = projectDiagnosticHighlights(new Map([['k', payload]]));
    const nodes = projectNodes(events, highlights);
    expect(nodes[0]?.data.diagnosticHighlight).toBeUndefined();
  });
});

describe('selectEdgesForSession — diagnostic-highlight enrichment (mod_diagnostic_highlighting)', () => {
  it('enriches data.diagnosticHighlight on an edge whose id is in the highlights index', () => {
    const EDGE_ID = '00000000-0000-4000-8000-00000000ee01';
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'b' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_ID, source: NODE_A, target: NODE_B }),
    ];
    // Build a contradiction diagnostic that affects this edge.
    const payload: DiagnosticPayload = {
      sessionId: SESSION_ID,
      kind: 'contradiction',
      severity: 'blocking',
      status: 'fired',
      sequence: 4,
      diagnostic: {
        kind: 'contradiction',
        nodeA: NODE_A,
        nodeB: NODE_B,
        edges: [EDGE_ID],
      },
    };
    const highlights = projectDiagnosticHighlights(new Map([['k', payload]]));
    // Hand-build a WsState containing only this session.
    const state = {
      sessionState: {
        [SESSION_ID]: {
          lastAppliedSequence: 0,
          events,
          pendingProposals: {},
          activeDiagnostics: new Map(),
        },
      },
    } as unknown as Parameters<typeof selectEdgesForSession>[0];
    const edges = selectEdgesForSession(state, SESSION_ID, highlights);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.diagnosticHighlight).toEqual({
      severity: 'blocking',
      kinds: ['contradiction'],
    });
  });

  it('leaves data.diagnosticHighlight undefined for an edge whose id is NOT in the highlights index', () => {
    const EDGE_ID = '00000000-0000-4000-8000-00000000ee02';
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'b' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_ID, source: NODE_A, target: NODE_B }),
    ];
    // Empty highlights.
    const state = {
      sessionState: {
        [SESSION_ID]: {
          lastAppliedSequence: 0,
          events,
          pendingProposals: {},
          activeDiagnostics: new Map(),
        },
      },
    } as unknown as Parameters<typeof selectEdgesForSession>[0];
    const edges = selectEdgesForSession(state, SESSION_ID);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.diagnosticHighlight).toBeUndefined();
  });
});

describe('GraphCanvasPane — end-to-end diagnostic halo flow (mod_diagnostic_highlighting)', () => {
  it('renders the amber ring + data-diagnostic-severity="blocking" on the card when a fired cycle diagnostic lives in the store', () => {
    const store = useWsStore.getState();
    store.applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'cycled' }));
    store.applyEvent(makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'cycled too' }));
    store.applyDiagnostic(firedCycleDiagnostic([NODE_A, NODE_B]));
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    const card = screen.getByTestId(`statement-node-${NODE_A}`);
    expect(card.getAttribute('data-diagnostic-severity')).toBe('blocking');
    expect(card.className).toContain('ring-amber-500/80');
  });

  it('clears the ring + the attribute after a cleared envelope for the same identity arrives', () => {
    const store = useWsStore.getState();
    store.applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'cycled' }));
    store.applyEvent(makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'cycled too' }));
    store.applyDiagnostic(firedCycleDiagnostic([NODE_A, NODE_B]));
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    // Sanity: ring present after fired.
    expect(
      screen.getByTestId(`statement-node-${NODE_A}`).getAttribute('data-diagnostic-severity'),
    ).toBe('blocking');

    // Now clear the same identity.
    act(() => {
      useWsStore.getState().applyDiagnostic(clearedCycleDiagnostic([NODE_A, NODE_B]));
    });

    const card = screen.getByTestId(`statement-node-${NODE_A}`);
    expect(card.getAttribute('data-diagnostic-severity')).toBeNull();
    expect(card.className).not.toContain('ring-amber-500/80');
  });
});

// -- Hover popover edge endpoint enrichment (mod_hover_details) -------
//
// End-to-end: a session with one node-created + one node-created + one
// edge-created in the WS store projects an `Edge<StatementEdgeData>`
// whose `data.sourceWording` / `data.targetWording` come from the
// node-created payloads. The selector wiring inside `<GraphCanvasPane>`
// passes the events array through `selectEdgesForSession`, which builds
// the per-node wording index. Refinement: `mod_hover_details`.

describe('GraphCanvasPane — edge wording enrichment end-to-end (mod_hover_details)', () => {
  it('threads node-created wordings onto the projected edge data via the canvas wiring', () => {
    const store = useWsStore.getState();
    store.applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'data wording' }));
    store.applyEvent(makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'claim wording' }));
    store.applyEvent(
      makeEdgeCreated({ sequence: 3, edgeId: 'edge-wording-e2e', source: NODE_A, target: NODE_B }),
    );
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    // The canvas root mounts.
    expect(screen.getByTestId('graph-canvas-root')).toBeTruthy();
    // The selector-side projection (the same one the canvas
    // subscribes to) carries the enriched wordings.
    const edges = selectEdgesForSession(useWsStore.getState(), SESSION_ID);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.sourceWording).toBe('data wording');
    expect(edges[0]?.data?.targetWording).toBe('claim wording');
  });
});

// -- Measurement-driven re-layout (mod_layout_measured_dimensions) ---
//
// `<GraphCanvasPane>` subscribes to ReactFlow's internal `nodeInternals`
// store via `useStore` (gated on `useNodesInitialized`) and on
// measurement change, debounces 75 ms before evicting the position
// cache for the changed ids and bumping a layout-revision counter. The
// next memoization tick re-runs `applyLayout` with the freshly-populated
// measurement cache. These cases pin both the re-measure flow (a tall
// rect for one node moves THAT node and only that node) and the steady-
// state silence (no further re-layouts once measurements stabilize).
//
// Test idiom: per the refinement, the existing `ImmediateResizeObserver`
// stub fires synchronously on `observe()`, so the only latency is the
// 75 ms `setTimeout` debounce. We use `vi.useFakeTimers()` +
// `vi.advanceTimersByTime(80)` to fast-forward past it.

/**
 * Read a rendered node's translate position from the ReactFlow node
 * wrapper's inline `transform` style. ReactFlow stamps
 * `transform: translate(Xpx, Ypx)` on each `.react-flow__node` element;
 * the values are the same `{x, y}` written to `Node.position`. Returns
 * `null` if the node wrapper isn't in the DOM yet (e.g. the first
 * paint hasn't completed) or the transform style is empty.
 */
function readNodeTransform(
  container: HTMLElement,
  nodeId: string,
): { x: number; y: number } | null {
  const card = container.querySelector(`[data-testid="statement-node-${nodeId}"]`);
  if (card === null) return null;
  // The card itself is the inner StatementNode; the ReactFlow wrapper
  // is its ancestor with class `react-flow__node`.
  let wrapper: Element | null = card;
  while (wrapper !== null && !wrapper.classList.contains('react-flow__node')) {
    wrapper = wrapper.parentElement;
  }
  if (wrapper === null) return null;
  const style = (wrapper as HTMLElement).style.transform;
  const match = style.match(/translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px\s*\)/);
  if (match === null) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

describe('GraphCanvasPane — measurement-driven re-layout (mod_layout_measured_dimensions)', () => {
  // Stash the prototype's measurement stubs so per-test overrides can
  // restore them on teardown.
  let originalOffsetWidth!: PropertyDescriptor;
  let originalOffsetHeight!: PropertyDescriptor;
  let originalGetBoundingClientRect!: typeof Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;
    originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
    // Capture the original prototype method for restoration. The
    // assignment loses `this` binding, which is exactly what we want
    // here — we'll write the captured function back onto the prototype
    // in `afterEach`, where `this` resolves dynamically on every
    // invocation. The lint rule is defensive against accidental
    // unbinding; this usage is intentional.
    //
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  });

  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    vi.useRealTimers();
  });

  /**
   * Override the per-prototype measurement helpers so each rendered
   * node returns its OWN per-id rect, looked up by the `data-id`
   * attribute ReactFlow stamps on the `.react-flow__node` wrapper.
   * Nodes whose id isn't in the rect map fall back to a default.
   */
  function installPerNodeRects(
    rectsById: ReadonlyMap<string, { width: number; height: number }>,
    fallback: { width: number; height: number },
  ): void {
    function rectFor(el: HTMLElement): { width: number; height: number } {
      // Walk up to find the `.react-flow__node` wrapper carrying
      // `data-id`. The inner card and its children all resolve to the
      // same per-node rect.
      let cur: HTMLElement | null = el;
      while (cur !== null) {
        if (cur.classList?.contains?.('react-flow__node')) {
          const id = cur.getAttribute('data-id');
          if (id !== null && rectsById.has(id)) return rectsById.get(id)!;
          break;
        }
        cur = cur.parentElement;
      }
      return fallback;
    }
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(): number {
        return rectFor(this as HTMLElement).width;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(): number {
        return rectFor(this as HTMLElement).height;
      },
    });
    Element.prototype.getBoundingClientRect = function (): DOMRect {
      const rect = rectFor(this as HTMLElement);
      return {
        x: 0,
        y: 0,
        width: rect.width,
        height: rect.height,
        top: 0,
        left: 0,
        right: rect.width,
        bottom: rect.height,
        toJSON() {
          return this;
        },
      };
    };
  }

  it('re-runs applyLayout with measured dimensions after the 75 ms debounce; tall node moves', async () => {
    // Install per-node rects BEFORE rendering so ReactFlow's first
    // measurement pass picks up the per-id values. Node A is "tall"
    // (200 x 160 — well over the 90 px default); node B is baseline.
    // The edge A→B forces dagre into two ranks (A above B), so the
    // vertical gap is observably sensitive to A's measured height.
    const rectsById = new Map<string, { width: number; height: number }>([
      [NODE_A, { width: 200, height: 160 }],
      [NODE_B, { width: 100, height: 40 }],
    ]);
    installPerNodeRects(rectsById, { width: 100, height: 40 });

    // Seed two node-created events + an edge.
    const store = useWsStore.getState();
    store.applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'tall' }));
    store.applyEvent(makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'baseline' }));
    store.applyEvent(
      makeEdgeCreated({ sequence: 3, edgeId: 'edge-AB', source: NODE_A, target: NODE_B }),
    );

    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { container } = render(<GraphCanvasPane sessionId={SESSION_ID} />);

    // First-paint positions. ReactFlow's synchronous ResizeObserver
    // callback has fired by now (the stub is synchronous), but the
    // measurement effect's 75 ms debounce has NOT yet committed —
    // positions are still from the constant 288 x 90 first-paint
    // layout pass.
    const firstA = readNodeTransform(container, NODE_A);
    const firstB = readNodeTransform(container, NODE_B);
    expect(firstA, 'first-paint position for node A must exist').not.toBeNull();
    expect(firstB, 'first-paint position for node B must exist').not.toBeNull();
    if (firstA === null || firstB === null) return;

    // First-paint TB direction: A above B.
    expect(firstA.y).toBeLessThan(firstB.y);
    const firstGap = firstB.y - firstA.y;

    // Advance past the debounce window. The pending eviction commits;
    // applyLayout re-runs with the per-node measured rects; React
    // re-renders.
    await act(async () => {
      vi.advanceTimersByTime(80);
      // Flush microtasks so React processes the state update queued
      // by the debounce callback before the next assertion reads the
      // rendered DOM.
      await Promise.resolve();
    });

    const secondA = readNodeTransform(container, NODE_A);
    const secondB = readNodeTransform(container, NODE_B);
    expect(secondA, 'post-debounce position for node A must exist').not.toBeNull();
    expect(secondB, 'post-debounce position for node B must exist').not.toBeNull();
    if (secondA === null || secondB === null) return;

    // After the measured re-layout, node A's rendered height is 160
    // (vs the 90 px first-paint constant). The gap between A.y and
    // B.y reflects ((heightA + heightB) / 2 + ranksep), so growing
    // A's height by 70 px should widen the gap. We assert the gap
    // CHANGED by a non-trivial amount — proving dagre received the
    // measured rect on the second pass.
    const secondGap = secondB.y - secondA.y;
    expect(
      Math.abs(secondGap - firstGap),
      `vertical gap between A and B should change after measurement: firstGap=${firstGap}, secondGap=${secondGap}`,
    ).toBeGreaterThanOrEqual(10);
  });

  it('does NOT re-run applyLayout once measurements stabilize (no further eviction → steady-state silence)', async () => {
    // Per-node rects that DON'T match the 288 x 90 constants — every
    // node's first measurement crosses the threshold once and then
    // stays put.
    const rectsById = new Map<string, { width: number; height: number }>([
      [NODE_A, { width: 120, height: 50 }],
      [NODE_B, { width: 120, height: 50 }],
    ]);
    installPerNodeRects(rectsById, { width: 120, height: 50 });

    const store = useWsStore.getState();
    store.applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }));
    store.applyEvent(makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'b' }));

    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { container } = render(<GraphCanvasPane sessionId={SESSION_ID} />);

    // Drain the first re-layout (the one triggered by the very first
    // measurement of each node).
    await act(async () => {
      vi.advanceTimersByTime(80);
      // Flush microtasks so React processes the state update queued
      // by the debounce callback before the next assertion reads the
      // rendered DOM.
      await Promise.resolve();
    });

    const afterFirstSettle = readNodeTransform(container, NODE_A);
    expect(afterFirstSettle).not.toBeNull();

    // Now advance another window — no new measurements means no new
    // pending evictions; the timer never arms. The position remains
    // identical.
    await act(async () => {
      vi.advanceTimersByTime(80);
      // Flush microtasks so React processes the state update queued
      // by the debounce callback before the next assertion reads the
      // rendered DOM.
      await Promise.resolve();
    });
    const afterSecondSettle = readNodeTransform(container, NODE_A);
    expect(afterSecondSettle).toEqual(afterFirstSettle);

    // Advance another window for paranoia — still stable.
    await act(async () => {
      vi.advanceTimersByTime(80);
      // Flush microtasks so React processes the state update queued
      // by the debounce callback before the next assertion reads the
      // rendered DOM.
      await Promise.resolve();
    });
    expect(readNodeTransform(container, NODE_A)).toEqual(afterFirstSettle);
  });
});

// -- Tidy-up button (mod_layout_tidy_action) -------------------------
//
// Six committed Vitest cases per ADR 0022. The button binds to a click
// handler that (a) clears `positionCacheRef.current`, (b) bumps the
// existing `layoutRevision` counter, (c) schedules a rAF callback
// that calls `useReactFlow().fitView({ duration: 0, padding: 0.1 })`.
// These cases pin all three behaviours plus the localized rendering and
// the empty-canvas no-op semantics.

describe('GraphCanvasPane — tidy-up button (mod_layout_tidy_action)', () => {
  beforeEach(() => {
    // Reset the mocked-applyLayout spy + the size-at-call side array.
    // Otherwise call counts leak across cases.
    applyLayoutSpy.mockClear();
    sizesAtCall.length = 0;
    fitViewSpy.mockClear();
  });

  it('renders with a localized accessible name, title, and visible label', () => {
    // Seed at least one node so the canvas isn't strictly empty; the
    // button must render regardless of node count, but a non-empty
    // fixture mirrors the typical operator flow.
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'tidy-up fixture' }));
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    const button = screen.getByTestId('graph-tidy-up-button');
    expect(button).toBeTruthy();
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    // Localized strings resolve to NON-key text (not the raw catalog
    // key). The en-US authoritative values are pinned by the catalog.
    expect(button.getAttribute('aria-label')).toBe('Re-layout the graph to a fresh arrangement');
    expect(button.getAttribute('title')).toBe(
      "Recalculates every node's position from scratch — useful when the canvas feels cluttered.",
    );
    expect(button.textContent).toBe('Tidy up');
  });

  it('clicking it clears the position cache (spy on Map.prototype.clear)', () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }));
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'b' }));
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    // Spy on Map.prototype.clear AFTER the initial render — otherwise
    // any internal Map.clear() invocations during mount would pollute
    // the count.
    const clearSpy = vi.spyOn(Map.prototype, 'clear');
    try {
      const button = screen.getByTestId('graph-tidy-up-button');
      fireEvent.click(button);
      // At least one Map was cleared on click — that's the position
      // cache. We don't assert exact equality (1) because React /
      // ReactFlow internals are free to call .clear() too; the
      // load-bearing property is "at least one call happened, and the
      // click handler ran without throwing."
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });

  it('clicking it bumps layoutRevision so applyLayout re-runs against an empty cache', () => {
    // The `applyLayoutSpy` is installed at the top of this file by the
    // `./layoutEngine` mock; it delegates to the real implementation
    // but captures call args + per-call `cache.size`. The spy was
    // cleared in `beforeEach`.
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }));
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'b' }));
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    // The initial render populated the cache via at least one
    // applyLayout call.
    const callsBeforeClick = applyLayoutSpy.mock.calls.length;
    expect(callsBeforeClick).toBeGreaterThan(0);
    // The most-recent pre-click call should have populated the cache;
    // capture its post-state by reading the call's `options.cache`
    // argument — Vitest snapshots the OBJECT reference at call time,
    // and the canvas mutates that same Map after the call returns.
    const lastBeforeCall = applyLayoutSpy.mock.calls[callsBeforeClick - 1];
    const cacheBefore = (lastBeforeCall?.[2] as { cache?: Map<string, unknown> } | undefined)
      ?.cache;
    expect(cacheBefore).toBeDefined();
    // The canvas's useMemo writes positions back into the cache after
    // applyLayout returns, so after the initial render the cache has
    // entries for both seeded nodes.
    expect(cacheBefore?.size).toBe(2);

    const button = screen.getByTestId('graph-tidy-up-button');
    act(() => {
      fireEvent.click(button);
    });

    // After click, applyLayout was invoked at least once more — the
    // revision bump invalidated the `nodes` `useMemo` and React re-ran
    // it on the next render.
    const callsAfterClick = applyLayoutSpy.mock.calls.length;
    expect(callsAfterClick).toBeGreaterThan(callsBeforeClick);
  });

  it('the post-click applyLayout invocation sees an empty cache (cache was cleared synchronously before the re-run)', () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }));
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'b' }));
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    const callsBefore = applyLayoutSpy.mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);

    // Snapshot the cache SIZE AT INVOCATION for each pre-click call.
    // The canvas writes positions back into the cache AFTER applyLayout
    // returns, so the snapshot uses each call's recorded size (the
    // mock factory records `options.cache.size` at call time, captured
    // in a side array keyed off the call index).
    const cacheSizesPre = applyLayoutSpy.mock.calls.map(
      (args) => (args[2] as { cache?: Map<string, unknown> } | undefined)?.cache?.size ?? -1,
    );
    // The most-recent pre-click call: the cache had been re-populated
    // by the previous render's write-back. (Initial pass: 0; subsequent
    // passes: 2.)
    expect(cacheSizesPre[cacheSizesPre.length - 1]).toBe(2);

    const button = screen.getByTestId('graph-tidy-up-button');
    act(() => {
      fireEvent.click(button);
    });

    // The post-click invocation: the click handler cleared the cache
    // synchronously BEFORE the revision bump triggered the useMemo
    // re-run; the next applyLayout call sees `options.cache.size === 0`.
    const postClickCall = applyLayoutSpy.mock.calls[callsBefore];
    expect(postClickCall).toBeDefined();
    const cacheAtPostClick = (postClickCall?.[2] as { cache?: Map<string, unknown> } | undefined)
      ?.cache;
    // The cache that applyLayout was invoked with: the same Map
    // reference the canvas held. After the post-click writes, that
    // Map ends at size 2 again (the canvas wrote positions back for
    // both nodes). What we need to assert is that at the MOMENT of
    // invocation the cache was empty — we captured that via the
    // sizesAtCall side array. The post-click size must equal 0
    // because the click handler `.clear()`ed the cache before the
    // revision bump triggered the re-run.
    // The captured size is the position-cache size AT CALL TIME
    // (mock factory snapshots it). The most-recent post-click call's
    // size is exactly 0.
    expect((applyLayoutSpy as unknown as { sizesAtCall: number[] }).sizesAtCall[callsBefore]).toBe(
      0,
    );
    expect(cacheAtPostClick).toBeDefined();
  });

  it('clicking it on an empty canvas is a no-op (no throw, applyLayout invoked with empty inputs)', () => {
    // No events in the WS store for SESSION_ID.
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    const callsBefore = applyLayoutSpy.mock.calls.length;
    const button = screen.getByTestId('graph-tidy-up-button');
    expect(() => {
      act(() => {
        fireEvent.click(button);
      });
    }).not.toThrow();
    // The click handler still bumped the revision; useMemo re-ran with
    // an empty events array and applyLayout was called with `[]`.
    const callsAfter = applyLayoutSpy.mock.calls.length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
    const postClickCall = applyLayoutSpy.mock.calls[callsBefore];
    expect(postClickCall?.[0]).toEqual([]);
  });

  it('fitView is called via requestAnimationFrame after the click, with {duration: 0, padding: 0.1}', () => {
    // The mock factory for `reactflow` (module-scope) exposes a
    // `fitViewSpy` that captures every `useReactFlow().fitView(...)`
    // call. The handler defers the fitView through rAF, so the spy
    // must NOT see a call synchronously inside the click handler;
    // draining rAF then triggers exactly one call with the configured
    // padding + zero-duration options.
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    };
    try {
      useWsStore
        .getState()
        .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a' }));
      render(<GraphCanvasPane sessionId={SESSION_ID} />);

      const button = screen.getByTestId('graph-tidy-up-button');
      fireEvent.click(button);
      // Synchronous: fitView NOT called yet.
      expect(fitViewSpy.mock.calls.length).toBe(0);
      // Drain rAF callbacks scheduled by the click handler.
      while (rafCallbacks.length > 0) {
        const cb = rafCallbacks.shift();
        cb?.(0);
      }
      expect(fitViewSpy.mock.calls.length).toBe(1);
      expect(fitViewSpy.mock.calls[0]?.[0]).toEqual({ duration: 0, padding: 0.1 });
    } finally {
      window.requestAnimationFrame = originalRaf;
    }
  });
});

// -- Pan + zoom configuration (mod_pan_zoom) -------------------------
//
// Four committed Vitest cases per ADR 0022 pinning the props the canvas
// mount passes to `<ReactFlow>`. The reactflow mock at the top of this
// file (module scope) installs a passthrough wrapper that captures
// every prop-set the canvas sends to the library, so these cases assert
// against `reactFlowPropCaptures` — the same wire the production code
// writes to. The four behaviour props pin against literal `true` (not
// truthy) so a future regression that flips one to `false` trips the
// test exactly; the zoom-range props pin against the exported
// `MIN_ZOOM` / `MAX_ZOOM` constants (no magic numbers, no drift).

describe('mod_pan_zoom (pan + zoom configuration)', () => {
  beforeEach(() => {
    reactFlowPropCaptures.length = 0;
  });

  it('pins the four pan/zoom behaviour props to the literal `true`', () => {
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    // At least one render captured props — the canvas mounted.
    expect(reactFlowPropCaptures.length).toBeGreaterThan(0);
    const props = reactFlowPropCaptures[reactFlowPropCaptures.length - 1];
    expect(props?.panOnDrag).toBe(true);
    expect(props?.zoomOnScroll).toBe(true);
    expect(props?.zoomOnPinch).toBe(true);
    expect(props?.zoomOnDoubleClick).toBe(true);
  });

  it('passes `minZoom` equal to the exported MIN_ZOOM constant (0.1)', () => {
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    expect(reactFlowPropCaptures.length).toBeGreaterThan(0);
    const props = reactFlowPropCaptures[reactFlowPropCaptures.length - 1];
    expect(props?.minZoom).toBe(MIN_ZOOM);
    expect(MIN_ZOOM).toBe(0.1);
  });

  it('passes `maxZoom` equal to the exported MAX_ZOOM constant (2.5)', () => {
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    expect(reactFlowPropCaptures.length).toBeGreaterThan(0);
    const props = reactFlowPropCaptures[reactFlowPropCaptures.length - 1];
    expect(props?.maxZoom).toBe(MAX_ZOOM);
    expect(MAX_ZOOM).toBe(2.5);
  });

  it('does NOT pass a `defaultViewport` prop (the library default `{x:0,y:0,zoom:1}` is intentional)', () => {
    // Setting `defaultViewport` explicitly would override ReactFlow's
    // first-paint heuristics and break the position-cache → fitView
    // interaction in subtle ways. A future regression that adds an
    // unexamined `defaultViewport` trips this case.
    render(<GraphCanvasPane sessionId={SESSION_ID} />);
    expect(reactFlowPropCaptures.length).toBeGreaterThan(0);
    const props = reactFlowPropCaptures[reactFlowPropCaptures.length - 1];
    expect(props?.defaultViewport).toBeUndefined();
  });
});
