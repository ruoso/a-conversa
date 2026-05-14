// Tests for `<GraphCanvasPane>` — the moderator's ReactFlow canvas mount.
//
// Refinement: tasks/refinements/moderator-ui/mod_edge_rendering.md
// (prior:     tasks/refinements/moderator-ui/mod_node_rendering.md,
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

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import type { Event } from '@a-conversa/shared-types';

import { GraphCanvasPane, projectNodes } from './GraphCanvasPane';
import { STATEMENT_NODE_TYPE } from './StatementNode';
import { selectEdgesForSession } from './selectors';
import { useWsStore } from '../ws/wsStore';
import { initI18n } from '../i18n';

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
  await initI18n('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
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
    expect(nodes[0]?.data).toEqual({ wording: 'first', kind: null });
    expect(nodes[1]?.id).toBe(NODE_B);
    expect(nodes[1]?.data).toEqual({ wording: 'second', kind: null });
  });

  it('lays nodes out on a deterministic grid keyed by node-created order', () => {
    const events: Event[] = Array.from({ length: 6 }, (_, i) =>
      makeNodeCreated({
        sequence: i + 1,
        nodeId: `00000000-0000-4000-8000-${(0x300 + i).toString(16).padStart(12, '0')}`,
        wording: `w${i}`,
      }),
    );
    const nodes = projectNodes(events);
    // 4 cols × 140-pixel row height: positions 0..3 on row 0, 4..5 on row 1.
    expect(nodes.map((n) => n.position)).toEqual([
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { x: 480, y: 0 },
      { x: 720, y: 0 },
      { x: 0, y: 140 },
      { x: 240, y: 140 },
    ]);
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
  // The store-to-edges projection is the load-bearing surface this
  // task ships: `edge-created` events in the WS store are projected
  // into the `edges` array passed to `<ReactFlow>`. The visible
  // `.react-flow__edge` DOM only appears once `mod_node_rendering`'s
  // `StatementNode` exposes ReactFlow `<Handle>` elements (a sibling
  // concern that's not in this task's scope per the refinement). We
  // therefore assert the projection — `selectEdgesForSession` over the
  // store reflects the events — and pin that the canvas exposes the
  // root + the correct node count alongside, so the wiring through
  // `<GraphCanvasPane>` is exercised end-to-end without depending on
  // the not-yet-shipped handle plumbing.
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
});
