// Vitest cases for `<GraphView>`.
//
// Refinement: tasks/refinements/participant-ui/part_graph_render.md
//              (Test layers per ADR 0022 — twelve cases per the
//              refinement's "Tests pin" sketch).
// ADRs:        0022 (no throwaway verifications — the projection's
//              algorithmic behaviour is pinned at the pure
//              `projectGraph.test.ts` layer; this layer pins the
//              React-mount + Cytoscape sync behaviour the component
//              owns).
//
// Cytoscape ships a `headless: true` mode for Node, but the component
// uses the DOM container path. happy-dom supplies the DOM; the
// `ResizeObserver` stub mirrors the moderator's `StatementEdge.test.tsx`
// pattern. The test consumes the `cyRef` callback prop to capture the
// live Cytoscape instance and asserts against its `cy.elements()`
// API — same observability seam downstream tasks
// (`part_pan_zoom_tap`, `part_entity_detail_panel`) consume in
// production.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Core } from 'cytoscape';
import type { AnnotationKind, EdgeRole, Event, StatementKind } from '@a-conversa/shared-types';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';

import { GraphView, STYLESHEET } from './GraphView';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';
import { useWsStore } from '../ws/wsStore';

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const ANOTHER_SESSION_ID = '00000000-0000-4000-8000-0000000000bb';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const EDGE_A = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

function nodeCreatedEvent(opts: {
  sequence: number;
  nodeId: string;
  wording: string;
  sessionId?: string;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x100 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: opts.sessionId ?? SESSION_ID,
    sequence: opts.sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: opts.nodeId,
      wording: opts.wording,
      created_by: ACTOR,
      created_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function edgeCreatedEvent(opts: {
  sequence: number;
  edgeId: string;
  source: string;
  target: string;
  role?: EdgeRole;
  sessionId?: string;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x300 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: opts.sessionId ?? SESSION_ID,
    sequence: opts.sequence,
    kind: 'edge-created',
    actor: ACTOR,
    payload: {
      edge_id: opts.edgeId,
      role: opts.role ?? 'supports',
      source_node_id: opts.source,
      target_node_id: opts.target,
      created_by: ACTOR,
      created_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function classifyProposalEvent(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
  classification: StatementKind;
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
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function commitEvent(opts: { sequence: number; proposalEnvelopeId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x200 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      proposal_id: opts.proposalEnvelopeId,
      moderator: ACTOR,
      committed_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function seedEvent(event: Event): void {
  act(() => {
    useWsStore.getState().applyEvent(event);
  });
}

let i18nInstance: I18nInstance;
let cytoscapeEnvHandle: CytoscapeTestEnvRestoreHandle | null = null;

beforeAll(async () => {
  i18nInstance = await createI18nInstance('en-US');
  cytoscapeEnvHandle = installCytoscapeTestEnv();
});

afterAll(() => {
  cytoscapeEnvHandle?.restore();
  cytoscapeEnvHandle = null;
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
});

interface RenderResult {
  getCy: () => Core;
  setCy: (cy: Core | null) => void;
  cyRef: (cy: Core | null) => void;
}

function renderView(opts: { sessionId?: string } = {}): RenderResult {
  const id = opts.sessionId ?? SESSION_ID;
  let captured: Core | null = null;
  const cyRef = (cy: Core | null): void => {
    captured = cy;
  };
  render(
    <I18nProvider i18n={i18nInstance}>
      <GraphView sessionId={id} cyRef={cyRef} />
    </I18nProvider>,
  );
  return {
    getCy: () => {
      if (captured === null) throw new Error('cy instance not captured');
      return captured;
    },
    setCy: (cy: Core | null) => {
      captured = cy;
    },
    cyRef,
  };
}

describe('GraphView — mount + container testid', () => {
  it('(a) mounts without crashing on an empty session', () => {
    const result = renderView();
    expect(result.getCy().elements().length).toBe(0);
  });

  it('(k) renders the participant-graph-root testid on the outer container', () => {
    renderView();
    // The cy instance was captured; the container carries the testid.
    const root = document.querySelector('[data-testid="participant-graph-root"]');
    expect(root).not.toBeNull();
  });

  it('(l) leaves Cytoscape pan + zoom defaults enabled', () => {
    const result = renderView();
    const cy = result.getCy();
    expect(cy.userPanningEnabled()).toBe(true);
    expect(cy.userZoomingEnabled()).toBe(true);
  });
});

describe('GraphView — node projection', () => {
  it('(b) renders one Cytoscape node per node-created event in the seeded slice', () => {
    const result = renderView();
    seedEvent(
      nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'UBI lifts welfare floor' }),
    );
    seedEvent(
      nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'Means-tested aid stigmatises' }),
    );
    const cy = result.getCy();
    expect(cy.nodes().length).toBe(2);
  });

  it('(c) carries the wording on the node data', () => {
    const result = renderView();
    seedEvent(
      nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'UBI lifts welfare floor' }),
    );
    const cy = result.getCy();
    const node = cy.getElementById(NODE_A);
    expect(node.data('wording')).toBe('UBI lifts welfare floor');
  });

  it('(d) keeps kind: null until a classify-node proposal commit lands', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      classifyProposalEvent({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    );
    const cy = result.getCy();
    const node = cy.getElementById(NODE_A);
    expect(node.data('kind')).toBeNull();
    // The localized kind label is the em-dash placeholder.
    expect(node.data('kindLabel')).toBe('—');
  });

  it('(e) flips kind to the committed classification once the commit lands', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      classifyProposalEvent({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'normative',
      }),
    );
    seedEvent(commitEvent({ sequence: 3, proposalEnvelopeId: PROPOSAL_A }));
    const cy = result.getCy();
    const node = cy.getElementById(NODE_A);
    expect(node.data('kind')).toBe('normative');
    // The localized kind label flips to the en-US methodology glossary
    // entry (the catalog ships `methodology.kind.normative: 'Normative'`).
    expect(node.data('kindLabel')).toBe('Normative');
  });
});

describe('GraphView — edge projection', () => {
  it('(f) renders one Cytoscape edge per edge-created with source / target / role', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(
      edgeCreatedEvent({
        sequence: 3,
        edgeId: EDGE_A,
        source: NODE_A,
        target: NODE_B,
        role: 'rebuts',
      }),
    );
    const cy = result.getCy();
    expect(cy.edges().length).toBe(1);
    const edge = cy.getElementById(EDGE_A);
    expect(edge.data('source')).toBe(NODE_A);
    expect(edge.data('target')).toBe(NODE_B);
    expect(edge.data('role')).toBe('rebuts');
    // The localized role label is the en-US methodology glossary entry
    // (`methodology.edgeRole.rebuts.label: 'Rebuts'`).
    expect(edge.data('roleLabel')).toBe('Rebuts');
  });

  it('(g) keeps node-created events from contributing to the edge collection', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    const cy = result.getCy();
    expect(cy.nodes().length).toBe(2);
    expect(cy.edges().length).toBe(0);
  });
});

describe('GraphView — resilience + lifecycle', () => {
  it('(h) renders an empty graph when the per-session slice is absent', () => {
    const result = renderView();
    const cy = result.getCy();
    expect(cy.elements().length).toBe(0);
  });

  it('(i) does not crash when an edge-created references unknown source / target ids', () => {
    const result = renderView();
    // The participant's `<GraphView>` proactively filters dangling
    // edges (per the projector's lenient-projection invariant) before
    // calling `cy.json({ elements })`. Cytoscape never sees the
    // dangling edge so no warning fires — but to keep the
    // warnings-as-errors setup robust against future changes in the
    // filter location, silence console.warn for this case.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      seedEvent(
        edgeCreatedEvent({
          sequence: 1,
          edgeId: EDGE_A,
          source: 'unknown-source',
          target: 'unknown-target',
        }),
      );
      const cy = result.getCy();
      // The component itself did not throw — that's the contract being
      // asserted. Whether Cytoscape decides to keep the dangling edge
      // or drop it is library-internal; both are acceptable.
      expect(cy.nodes().length).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('(j) clears the prior graph before painting the new one when the session prop changes', () => {
    // Seed the first session and render against it.
    seedEvent(
      nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A', sessionId: SESSION_ID }),
    );
    const result = renderView({ sessionId: SESSION_ID });
    const cyFirst = result.getCy();
    expect(cyFirst.nodes().length).toBe(1);
    cleanup();
    // Re-render against a different session id with a different
    // seeded node. The second mount must NOT carry the prior session's
    // element over.
    seedEvent(
      nodeCreatedEvent({
        sequence: 2,
        nodeId: NODE_B,
        wording: 'B',
        sessionId: ANOTHER_SESSION_ID,
      }),
    );
    const result2 = renderView({ sessionId: ANOTHER_SESSION_ID });
    const cySecond = result2.getCy();
    expect(cySecond.nodes().length).toBe(1);
    expect(cySecond.getElementById(NODE_B).length).toBe(1);
    expect(cySecond.getElementById(NODE_A).length).toBe(0);
  });
});

// -------------------------------------------------------------------
// Per-facet state styling — added by
// `participant_ui.part_graph_view.part_per_facet_state_styling`.
// Refinement: tasks/refinements/participant-ui/part_per_facet_state_styling.md
//
// Nine new cases pinning the test-mirror seam (Decision §4) and the
// Cytoscape stylesheet's `[rollupStatus = '<status>']` selector path.
// -------------------------------------------------------------------

function classifyProposalEventOnly(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
  classification: StatementKind;
}): Event {
  return classifyProposalEvent(opts);
}

function setEdgeSubstanceProposalEvent(opts: {
  sequence: number;
  envelopeId: string;
  edgeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'set-edge-substance',
        edge_id: opts.edgeId,
        value: 'agreed',
      },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

describe('GraphView — per-facet status mirror', () => {
  it('(m) the test mirror is present in the DOM after mount', () => {
    renderView();
    const mirror = document.querySelector('[data-testid="participant-graph-status-mirror"]');
    expect(mirror).not.toBeNull();
  });

  it('(n) the test mirror carries aria-hidden="true" so screen readers skip it', () => {
    renderView();
    const mirror = document.querySelector('[data-testid="participant-graph-status-mirror"]');
    expect(mirror?.getAttribute('aria-hidden')).toBe('true');
  });

  it('(o) the mirror emits one <li participant-node-status> per emitted node', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    const items = document.querySelectorAll('[data-testid="participant-node-status"]');
    expect(items.length).toBe(2);
    const nodeIds = Array.from(items).map((el) => el.getAttribute('data-node-id'));
    expect(nodeIds).toEqual(expect.arrayContaining([NODE_A, NODE_B]));
  });

  it('(p) the mirror emits one <li participant-edge-status> per emitted edge', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(
      edgeCreatedEvent({
        sequence: 3,
        edgeId: EDGE_A,
        source: NODE_A,
        target: NODE_B,
      }),
    );
    const items = document.querySelectorAll('[data-testid="participant-edge-status"]');
    expect(items.length).toBe(1);
    expect(items[0]?.getAttribute('data-edge-id')).toBe(EDGE_A);
  });

  it('(q) the node mirror surfaces data-rollup-status="proposed" when a classify-node proposal is seeded (no votes)', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      classifyProposalEventOnly({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item).not.toBeNull();
    expect(item?.getAttribute('data-rollup-status')).toBe('proposed');
    expect(item?.getAttribute('data-facet-classification')).toBe('proposed');
    expect(item?.getAttribute('data-facet-substance')).toBe('');
    expect(item?.getAttribute('data-facet-wording')).toBe('');
  });

  it('(r) the edge mirror surfaces data-rollup-status / data-facet-substance from a set-edge-substance proposal', () => {
    const EDGE_B = '00000000-0000-4000-8000-000000000abe';
    const PROPOSAL_B = '00000000-0000-4000-8000-000000000ab2';
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(
      edgeCreatedEvent({
        sequence: 3,
        edgeId: EDGE_B,
        source: NODE_A,
        target: NODE_B,
      }),
    );
    seedEvent(
      setEdgeSubstanceProposalEvent({
        sequence: 4,
        envelopeId: PROPOSAL_B,
        edgeId: EDGE_B,
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-edge-status"][data-edge-id="${EDGE_B}"]`,
    );
    expect(item).not.toBeNull();
    expect(item?.getAttribute('data-rollup-status')).toBe('proposed');
    expect(item?.getAttribute('data-facet-substance')).toBe('proposed');
  });

  it('(s) the node mirror surfaces empty-string for absent facets (decision §4 sentinel)', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    // No proposals — every per-facet attribute is the empty string and
    // the rollup is 'none'.
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item).not.toBeNull();
    expect(item?.getAttribute('data-rollup-status')).toBe('none');
    expect(item?.getAttribute('data-facet-classification')).toBe('');
    expect(item?.getAttribute('data-facet-substance')).toBe('');
    expect(item?.getAttribute('data-facet-wording')).toBe('');
  });

  it('(t) Cytoscape carries the same data.rollupStatus the mirror surfaces (no drift)', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      classifyProposalEventOnly({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'value',
      }),
    );
    const cy = result.getCy();
    const cyNode = cy.getElementById(NODE_A);
    expect(cyNode.data('rollupStatus')).toBe('proposed');
    const mirrorItem = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(mirrorItem?.getAttribute('data-rollup-status')).toBe('proposed');
  });

  it('(u) a session prop change clears the prior mirror entries before painting the new session', () => {
    seedEvent(
      nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A', sessionId: SESSION_ID }),
    );
    renderView({ sessionId: SESSION_ID });
    expect(document.querySelectorAll('[data-testid="participant-node-status"]').length).toBe(1);
    cleanup();
    seedEvent(
      nodeCreatedEvent({
        sequence: 2,
        nodeId: NODE_B,
        wording: 'B',
        sessionId: ANOTHER_SESSION_ID,
      }),
    );
    renderView({ sessionId: ANOTHER_SESSION_ID });
    const items = document.querySelectorAll('[data-testid="participant-node-status"]');
    expect(items.length).toBe(1);
    expect(items[0]?.getAttribute('data-node-id')).toBe(NODE_B);
  });
});

// -------------------------------------------------------------------
// Axiom-mark decoration — added by
// `participant_ui.part_graph_view.part_axiom_mark_decoration`.
// Refinement: tasks/refinements/participant-ui/part_axiom_mark_decoration.md
//
// Five new cases pinning the boolean `data-is-axiom` mirror attribute,
// the `data.isAxiom` field on the Cytoscape element set, and the
// `node[?isAxiom]` stylesheet selector (module-scope constant
// testable directly).
// -------------------------------------------------------------------

function axiomMarkProposalEvent(opts: {
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
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

const PARTICIPANT_X = '00000000-0000-4000-8000-0000000000c1';
const PARTICIPANT_Y = '00000000-0000-4000-8000-0000000000c2';
const AXIOM_PROPOSAL_X = '00000000-0000-4000-8000-000000000ab1';
const AXIOM_PROPOSAL_Y = '00000000-0000-4000-8000-000000000ab2';

describe('GraphView — axiom-mark overlay', () => {
  it('(v) the node mirror carries data-is-axiom="false" by default', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item).not.toBeNull();
    expect(item?.getAttribute('data-is-axiom')).toBe('false');
  });

  it('(w) when a committed axiom-mark targets the node, the mirror reports data-is-axiom="true"', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      axiomMarkProposalEvent({
        sequence: 2,
        envelopeId: AXIOM_PROPOSAL_X,
        nodeId: NODE_A,
        participantId: PARTICIPANT_X,
      }),
    );
    seedEvent(commitEvent({ sequence: 3, proposalEnvelopeId: AXIOM_PROPOSAL_X }));
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item?.getAttribute('data-is-axiom')).toBe('true');
  });

  it('(x) when two participants mark the same node, the mirror still reports data-is-axiom="true" (boolean OR)', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      axiomMarkProposalEvent({
        sequence: 2,
        envelopeId: AXIOM_PROPOSAL_X,
        nodeId: NODE_A,
        participantId: PARTICIPANT_X,
      }),
    );
    seedEvent(commitEvent({ sequence: 3, proposalEnvelopeId: AXIOM_PROPOSAL_X }));
    seedEvent(
      axiomMarkProposalEvent({
        sequence: 4,
        envelopeId: AXIOM_PROPOSAL_Y,
        nodeId: NODE_A,
        participantId: PARTICIPANT_Y,
      }),
    );
    seedEvent(commitEvent({ sequence: 5, proposalEnvelopeId: AXIOM_PROPOSAL_Y }));
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item?.getAttribute('data-is-axiom')).toBe('true');
  });

  it('(y) Cytoscape carries the same data.isAxiom the mirror surfaces (no drift)', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      axiomMarkProposalEvent({
        sequence: 2,
        envelopeId: AXIOM_PROPOSAL_X,
        nodeId: NODE_A,
        participantId: PARTICIPANT_X,
      }),
    );
    seedEvent(commitEvent({ sequence: 3, proposalEnvelopeId: AXIOM_PROPOSAL_X }));
    const cy = result.getCy();
    const cyNode = cy.getElementById(NODE_A);
    expect(cyNode.data('isAxiom')).toBe(true);
    const mirrorItem = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(mirrorItem?.getAttribute('data-is-axiom')).toBe('true');
  });

  it('(z) STYLESHEET contains the node[?isAxiom] selector with double border + width 3', () => {
    // Cytoscape's `StylesheetJson` is a discriminated union that does
    // not directly assign to our narrow shape; cross through `unknown`
    // for the inspection coercion.
    const sheet = STYLESHEET as unknown as ReadonlyArray<{
      selector: string;
      style: Record<string, unknown>;
    }>;
    const axiomEntry = sheet.find((entry) => entry.selector === 'node[?isAxiom]');
    expect(axiomEntry).toBeDefined();
    expect(axiomEntry?.style['border-style']).toBe('double');
    expect(axiomEntry?.style['border-width']).toBe(3);
  });
});

// -------------------------------------------------------------------
// Annotation overlay — added by
// `participant_ui.part_graph_view.part_annotation_render`.
// Refinement: tasks/refinements/participant-ui/part_annotation_render.md
//
// Six new cases pinning the per-target `data-has-annotation` +
// `data-annotation-count` mirror attributes (Decision §5) on BOTH node
// AND edge rows (Decision §1 — structural symmetry), the corresponding
// `data.hasAnnotation` / `data.annotationCount` fields on the Cytoscape
// element set, and the new `node[?hasAnnotation]` / `edge[?hasAnnotation]`
// stylesheet selectors.
// -------------------------------------------------------------------

function annotationCreatedEvent(opts: {
  sequence: number;
  annotationId: string;
  kind: AnnotationKind;
  targetNodeId: string | null;
  targetEdgeId: string | null;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x500 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'annotation-created',
    actor: ACTOR,
    payload: {
      annotation_id: opts.annotationId,
      kind: opts.kind,
      content: 'annotation body',
      target_node_id: opts.targetNodeId,
      target_edge_id: opts.targetEdgeId,
      created_by: ACTOR,
      created_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

const ANNO_NODE_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa101';
const ANNO_NODE_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa102';
const ANNO_NODE_3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa103';
const ANNO_EDGE_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa201';

describe('GraphView — annotation overlay', () => {
  it('(aa) the node mirror carries data-has-annotation="false" + data-annotation-count="0" by default', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item).not.toBeNull();
    expect(item?.getAttribute('data-has-annotation')).toBe('false');
    expect(item?.getAttribute('data-annotation-count')).toBe('0');
  });

  it('(bb) when one annotation targets the node, the mirror reports data-has-annotation="true" + data-annotation-count="1"', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      annotationCreatedEvent({
        sequence: 2,
        annotationId: ANNO_NODE_1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item?.getAttribute('data-has-annotation')).toBe('true');
    expect(item?.getAttribute('data-annotation-count')).toBe('1');
  });

  it('(cc) when three annotations target the node, the mirror reports data-annotation-count="3"', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      annotationCreatedEvent({
        sequence: 2,
        annotationId: ANNO_NODE_1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    );
    seedEvent(
      annotationCreatedEvent({
        sequence: 3,
        annotationId: ANNO_NODE_2,
        kind: 'reframe',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    );
    seedEvent(
      annotationCreatedEvent({
        sequence: 4,
        annotationId: ANNO_NODE_3,
        kind: 'stance',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item?.getAttribute('data-has-annotation')).toBe('true');
    expect(item?.getAttribute('data-annotation-count')).toBe('3');
  });

  it('(dd) the per-edge mirror carries data-has-annotation + data-annotation-count for edge-targeted annotations', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(
      edgeCreatedEvent({
        sequence: 3,
        edgeId: EDGE_A,
        source: NODE_A,
        target: NODE_B,
      }),
    );
    seedEvent(
      annotationCreatedEvent({
        sequence: 4,
        annotationId: ANNO_EDGE_1,
        kind: 'stance',
        targetNodeId: null,
        targetEdgeId: EDGE_A,
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-edge-status"][data-edge-id="${EDGE_A}"]`,
    );
    expect(item?.getAttribute('data-has-annotation')).toBe('true');
    expect(item?.getAttribute('data-annotation-count')).toBe('1');
    // And node B (unannotated) carries the explicit "false" / "0"
    // baseline so the mirror's symmetry is observable.
    const nodeB = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_B}"]`,
    );
    expect(nodeB?.getAttribute('data-has-annotation')).toBe('false');
    expect(nodeB?.getAttribute('data-annotation-count')).toBe('0');
  });

  it('(ee) Cytoscape carries the same data.hasAnnotation + data.annotationCount the mirror surfaces (no drift)', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      annotationCreatedEvent({
        sequence: 2,
        annotationId: ANNO_NODE_1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    );
    seedEvent(
      annotationCreatedEvent({
        sequence: 3,
        annotationId: ANNO_NODE_2,
        kind: 'reframe',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    );
    const cy = result.getCy();
    const cyNode = cy.getElementById(NODE_A);
    expect(cyNode.data('hasAnnotation')).toBe(true);
    expect(cyNode.data('annotationCount')).toBe(2);
    const mirrorItem = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(mirrorItem?.getAttribute('data-has-annotation')).toBe('true');
    expect(mirrorItem?.getAttribute('data-annotation-count')).toBe('2');
  });

  it('(ff) STYLESHEET contains node[?hasAnnotation] + edge[?hasAnnotation] selectors with the expected overlay / underlay overrides', () => {
    const sheet = STYLESHEET as unknown as ReadonlyArray<{
      selector: string;
      style: Record<string, unknown>;
    }>;
    const nodeEntry = sheet.find((entry) => entry.selector === 'node[?hasAnnotation]');
    expect(nodeEntry).toBeDefined();
    expect(nodeEntry?.style['overlay-color']).toBe('#f59e0b');
    expect(nodeEntry?.style['overlay-opacity']).toBe(0.15);
    expect(nodeEntry?.style['overlay-padding']).toBe(4);
    const edgeEntry = sheet.find((entry) => entry.selector === 'edge[?hasAnnotation]');
    expect(edgeEntry).toBeDefined();
    expect(edgeEntry?.style.width).toBe(4);
    expect(edgeEntry?.style['underlay-color']).toBe('#f59e0b');
    expect(edgeEntry?.style['underlay-opacity']).toBe(0.25);
    expect(edgeEntry?.style['underlay-padding']).toBe(3);
  });
});
