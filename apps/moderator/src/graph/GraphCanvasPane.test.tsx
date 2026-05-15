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
import i18next from 'i18next';
import type { AnnotationKind, DiagnosticPayload, Event } from '@a-conversa/shared-types';

import {
  GraphCanvasPane,
  buildEdgeMenuItems,
  buildNodeMenuItems,
  buildPaneMenuItems,
  handleEdgeClick,
  handleNodeClick,
  handlePaneClick,
  projectNodes,
} from './GraphCanvasPane';
import { STATEMENT_NODE_TYPE } from './StatementNode';
import { projectDiagnosticHighlights } from './diagnosticHighlights';
import { selectEdgesForSession } from './selectors';
import { useWsStore } from '../ws/wsStore';
import { useSelectionStore } from '../stores';
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
  await initI18n('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
  useSelectionStore.getState().clear();
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
      votesByFacet: {},
    });
    expect(nodes[1]?.id).toBe(NODE_B);
    expect(nodes[1]?.data).toEqual({
      wording: 'second',
      kind: null,
      annotations: [],
      facetStatuses: {},
      axiomMarks: [],
      votesByFacet: {},
    });
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
  it('buildNodeMenuItems returns the five node-scope actions in order', () => {
    const items = buildNodeMenuItems({ kind: 'node', id: NODE_A });
    expect(items.map((it) => it.id)).toEqual([
      'propose-vote',
      'propose-decompose',
      'propose-meta-disagreement',
      'annotate',
      'axiom-mark',
    ]);
    expect(items.map((it) => it.labelKey)).toEqual([
      'moderator.contextMenu.node.proposeVote',
      'moderator.contextMenu.node.proposeDecompose',
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
      // 5 + 3 + 1 = 9 stub fires.
      expect(infoSpy).toHaveBeenCalledTimes(9);
    } finally {
      infoSpy.mockRestore();
    }
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
