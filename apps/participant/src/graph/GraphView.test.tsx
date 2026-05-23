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

import * as React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Core } from 'cytoscape';
import type {
  AnnotationKind,
  DiagnosticPayload,
  EdgeRole,
  Event,
  StatementKind,
} from '@a-conversa/shared-types';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';

import { GraphView, MAX_ZOOM, MIN_ZOOM, STYLESHEET, handleTap } from './GraphView';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';
import { projectDiagnosticHighlights, type DiagnosticHighlight } from './diagnosticHighlights';
import { groupAnnotationsByEdge, groupAnnotationsByNode, projectAnnotations } from './annotations';
import { groupAxiomMarksByNode, projectAxiomMarks } from './axiomMarks';
import { computeFacetStatuses } from './facetStatus';
import { projectOwnVotes } from './ownVotes';
import { projectOtherVotes } from './otherVotes';
import { projectGraph } from './projectGraph';
import { useSelectionStore } from '../stores/selectionStore';
import { useWsStore } from '../ws/wsStore';

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const ANOTHER_SESSION_ID = '00000000-0000-4000-8000-0000000000bb';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const EDGE_A = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const ME = '00000000-0000-4000-8000-0000000000ad';
const SOMEONE_ELSE = '00000000-0000-4000-8000-0000000000ae';

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
      target: 'proposal',
      proposal_id: opts.proposalEnvelopeId,
      committed_by: ACTOR,
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
  // Clear any selection written by `handleTap` so the next test's
  // baseline reads cleanly. The selection store has no `reset()`
  // helper; `clear()` resets the slot to `null`, which is the
  // store's initial state.
  useSelectionStore.getState().clear();
});

interface RenderResult {
  getCy: () => Core;
  setCy: (cy: Core | null) => void;
  cyRef: (cy: Core | null) => void;
}

/**
 * Per Decision §2 of `part_entity_detail_panel`, `<GraphView>` no
 * longer derives the projection chain internally — the route hoist
 * threads the projection outputs in as props. The tests preserved
 * their `useWsStore` seeding pattern; this thin wrapper re-runs the
 * projector inside the React render so the test's existing
 * `seedEvent(...)` mutations still drive what `<GraphView>` paints,
 * without bloating the per-test factory with explicit projection
 * scaffolding.
 */
function ProjectingGraphView(props: {
  sessionId: string;
  currentParticipantId: string;
  cyRef: (cy: Core | null) => void;
}): React.ReactElement {
  const events = useWsStore(
    (state) => state.sessionState[props.sessionId]?.events ?? EMPTY_TEST_EVENTS,
  );
  const activeDiagnostics = useWsStore(
    (state) => state.sessionState[props.sessionId]?.activeDiagnostics ?? EMPTY_TEST_DIAGNOSTICS,
  );
  const facetStatusIndex = React.useMemo(() => computeFacetStatuses(events), [events]);
  const axiomMarkIndex = React.useMemo(
    () => groupAxiomMarksByNode(projectAxiomMarks(events)),
    [events],
  );
  const annotations = React.useMemo(() => projectAnnotations(events), [events]);
  const nodeAnnotationIndex = React.useMemo(
    () => groupAnnotationsByNode(annotations),
    [annotations],
  );
  const edgeAnnotationIndex = React.useMemo(
    () => groupAnnotationsByEdge(annotations),
    [annotations],
  );
  const diagnosticHighlightIndex = React.useMemo(
    () => projectDiagnosticHighlights(activeDiagnostics),
    [activeDiagnostics],
  );
  const ownVoteIndex = React.useMemo(
    () => projectOwnVotes(events, props.currentParticipantId),
    [events, props.currentParticipantId],
  );
  const othersVoteIndex = React.useMemo(
    () => projectOtherVotes(events, props.currentParticipantId),
    [events, props.currentParticipantId],
  );
  const projected = React.useMemo(
    () =>
      projectGraph(
        events,
        facetStatusIndex,
        axiomMarkIndex,
        nodeAnnotationIndex,
        edgeAnnotationIndex,
        diagnosticHighlightIndex,
        ownVoteIndex,
        othersVoteIndex,
      ),
    [
      events,
      facetStatusIndex,
      axiomMarkIndex,
      nodeAnnotationIndex,
      edgeAnnotationIndex,
      diagnosticHighlightIndex,
      ownVoteIndex,
      othersVoteIndex,
    ],
  );
  return (
    <GraphView
      sessionId={props.sessionId}
      currentParticipantId={props.currentParticipantId}
      projectedNodes={projected.nodes}
      projectedEdges={projected.edges}
      facetStatusIndex={facetStatusIndex}
      axiomMarkIndex={axiomMarkIndex}
      nodeAnnotationIndex={nodeAnnotationIndex}
      edgeAnnotationIndex={edgeAnnotationIndex}
      diagnosticHighlightIndex={diagnosticHighlightIndex}
      ownVoteIndex={ownVoteIndex}
      othersVoteIndex={othersVoteIndex}
      cyRef={props.cyRef}
    />
  );
}

const EMPTY_TEST_EVENTS: readonly Event[] = Object.freeze([]);
const EMPTY_TEST_DIAGNOSTICS: ReadonlyMap<string, DiagnosticPayload> = Object.freeze(new Map());

function renderView(
  opts: { sessionId?: string; currentParticipantId?: string } = {},
): RenderResult {
  const id = opts.sessionId ?? SESSION_ID;
  const participantId = opts.currentParticipantId ?? ME;
  let captured: Core | null = null;
  const cyRef = (cy: Core | null): void => {
    captured = cy;
  };
  render(
    <I18nProvider i18n={i18nInstance}>
      <ProjectingGraphView sessionId={id} currentParticipantId={participantId} cyRef={cyRef} />
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

// -------------------------------------------------------------------
// Diagnostic-highlight overlay — added by
// `participant_ui.part_graph_view.part_diagnostic_highlights`.
// Refinement: tasks/refinements/participant-ui/part_diagnostic_highlights.md
//
// Seven new cases pinning the per-target `data-diagnostic-severity` +
// `data-diagnostic-kinds` mirror attributes (Decision §5) on BOTH node
// AND edge rows (Decision §1 — structural symmetry), the corresponding
// `data.diagnosticHighlight` + `data.diagnosticSeverity` fields on the
// Cytoscape element set, the four new
// `node[diagnosticSeverity = "..."]` / `edge[diagnosticSeverity = "..."]`
// stylesheet selectors (Decision §3), and the reactive update path
// through the widened `applyDiagnostic` reducer (a `cleared` envelope
// drops the entity's mirror back to the `"none"` baseline).
// -------------------------------------------------------------------

function firedCycleDiagnostic(opts: {
  nodes: readonly string[];
  sequence?: number;
}): DiagnosticPayload {
  return {
    sessionId: SESSION_ID,
    kind: 'cycle',
    severity: 'blocking',
    status: 'fired',
    sequence: opts.sequence ?? 1,
    diagnostic: { kind: 'cycle', nodes: opts.nodes },
  };
}

function clearedCycleDiagnostic(opts: {
  nodes: readonly string[];
  sequence?: number;
}): DiagnosticPayload {
  return {
    sessionId: SESSION_ID,
    kind: 'cycle',
    severity: 'blocking',
    status: 'cleared',
    sequence: opts.sequence ?? 2,
    diagnostic: { kind: 'cycle', nodes: opts.nodes },
  };
}

function firedMultiWarrantDiagnostic(opts: {
  dataNodeId: string;
  claimNodeId: string;
  warrantNodeIds: readonly string[];
  sequence?: number;
}): DiagnosticPayload {
  return {
    sessionId: SESSION_ID,
    kind: 'multi-warrant',
    severity: 'advisory',
    status: 'fired',
    sequence: opts.sequence ?? 3,
    diagnostic: {
      kind: 'multi-warrant',
      dataNodeId: opts.dataNodeId,
      claimNodeId: opts.claimNodeId,
      warrantNodeIds: opts.warrantNodeIds,
    },
  };
}

function firedContradictionDiagnostic(opts: {
  nodeA: string;
  nodeB: string;
  edges: readonly string[];
  sequence?: number;
}): DiagnosticPayload {
  return {
    sessionId: SESSION_ID,
    kind: 'contradiction',
    severity: 'blocking',
    status: 'fired',
    sequence: opts.sequence ?? 4,
    diagnostic: {
      kind: 'contradiction',
      nodeA: opts.nodeA,
      nodeB: opts.nodeB,
      edges: opts.edges,
    },
  };
}

function seedDiagnostic(payload: DiagnosticPayload): void {
  act(() => {
    useWsStore.getState().applyDiagnostic(payload);
  });
}

describe('GraphView — diagnostic-highlight overlay', () => {
  it('(gg) the node mirror carries data-diagnostic-severity="none" + data-diagnostic-kinds="" by default', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item).not.toBeNull();
    expect(item?.getAttribute('data-diagnostic-severity')).toBe('none');
    expect(item?.getAttribute('data-diagnostic-kinds')).toBe('');
  });

  it('(hh) when a cycle diagnostic fires targeting the node, the mirror reports severity="blocking" + kinds="cycle"', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedDiagnostic(firedCycleDiagnostic({ nodes: [NODE_A] }));
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item?.getAttribute('data-diagnostic-severity')).toBe('blocking');
    expect(item?.getAttribute('data-diagnostic-kinds')).toBe('cycle');
  });

  it('(ii) when cycle + multi-warrant both fire on the same node, the mirror reports blocking + encounter-ordered kinds', () => {
    // Blocking (cycle) wins over advisory (multi-warrant); kinds are
    // recorded in encounter order — cycle first, multi-warrant second.
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedDiagnostic(firedCycleDiagnostic({ nodes: [NODE_A] }));
    seedDiagnostic(
      firedMultiWarrantDiagnostic({
        dataNodeId: NODE_A,
        claimNodeId: NODE_B,
        warrantNodeIds: [],
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item?.getAttribute('data-diagnostic-severity')).toBe('blocking');
    expect(item?.getAttribute('data-diagnostic-kinds')).toBe('cycle,multi-warrant');
  });

  it('(jj) the edge mirror surfaces data-diagnostic-severity + data-diagnostic-kinds for contradiction edges', () => {
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
    seedDiagnostic(
      firedContradictionDiagnostic({
        nodeA: NODE_A,
        nodeB: NODE_B,
        edges: [EDGE_A],
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-edge-status"][data-edge-id="${EDGE_A}"]`,
    );
    expect(item?.getAttribute('data-diagnostic-severity')).toBe('blocking');
    expect(item?.getAttribute('data-diagnostic-kinds')).toBe('contradiction');
  });

  it('(kk) Cytoscape carries the same data.diagnosticHighlight + data.diagnosticSeverity the mirror surfaces (no drift)', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedDiagnostic(firedCycleDiagnostic({ nodes: [NODE_A] }));
    const cy = result.getCy();
    const cyNode = cy.getElementById(NODE_A);
    expect(cyNode.data('diagnosticSeverity')).toBe('blocking');
    const highlight = cyNode.data('diagnosticHighlight') as DiagnosticHighlight | null;
    expect(highlight).not.toBeNull();
    expect(highlight?.severity).toBe('blocking');
    expect(highlight?.kinds).toEqual(['cycle']);
    const mirrorItem = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(mirrorItem?.getAttribute('data-diagnostic-severity')).toBe('blocking');
    expect(mirrorItem?.getAttribute('data-diagnostic-kinds')).toBe('cycle');
  });

  it('(ll) STYLESHEET contains the four diagnostic selectors with the expected border / underlay overrides', () => {
    const sheet = STYLESHEET as unknown as ReadonlyArray<{
      selector: string;
      style: Record<string, unknown>;
    }>;
    const nodeBlocking = sheet.find(
      (entry) => entry.selector === 'node[diagnosticSeverity = "blocking"]',
    );
    expect(nodeBlocking).toBeDefined();
    expect(nodeBlocking?.style['border-color']).toBe('#b45309');
    expect(nodeBlocking?.style['border-width']).toBe(4);
    expect(nodeBlocking?.style['border-opacity']).toBe(0.9);

    const nodeAdvisory = sheet.find(
      (entry) => entry.selector === 'node[diagnosticSeverity = "advisory"]',
    );
    expect(nodeAdvisory).toBeDefined();
    expect(nodeAdvisory?.style['border-color']).toBe('#fbbf24');
    expect(nodeAdvisory?.style['border-width']).toBe(2);
    expect(nodeAdvisory?.style['border-opacity']).toBe(0.7);

    const edgeBlocking = sheet.find(
      (entry) => entry.selector === 'edge[diagnosticSeverity = "blocking"]',
    );
    expect(edgeBlocking).toBeDefined();
    expect(edgeBlocking?.style.width).toBe(5);
    expect(edgeBlocking?.style['underlay-color']).toBe('#b45309');
    expect(edgeBlocking?.style['underlay-opacity']).toBe(0.45);
    expect(edgeBlocking?.style['underlay-padding']).toBe(4);

    const edgeAdvisory = sheet.find(
      (entry) => entry.selector === 'edge[diagnosticSeverity = "advisory"]',
    );
    expect(edgeAdvisory).toBeDefined();
    expect(edgeAdvisory?.style.width).toBe(3);
    expect(edgeAdvisory?.style['underlay-color']).toBe('#fbbf24');
    expect(edgeAdvisory?.style['underlay-opacity']).toBe(0.3);
    expect(edgeAdvisory?.style['underlay-padding']).toBe(2);
  });

  it('(mm) a cleared envelope for a previously-fired diagnostic drops the mirror back to severity="none" + kinds=""', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedDiagnostic(firedCycleDiagnostic({ nodes: [NODE_A], sequence: 1 }));
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item?.getAttribute('data-diagnostic-severity')).toBe('blocking');
    seedDiagnostic(clearedCycleDiagnostic({ nodes: [NODE_A], sequence: 2 }));
    // The reactive update flows through `applyDiagnostic`'s widened
    // reducer (cleared removes the entry from the active map); the
    // memo re-runs; the mirror flips back to the "none" baseline.
    const item2 = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item2?.getAttribute('data-diagnostic-severity')).toBe('none');
    expect(item2?.getAttribute('data-diagnostic-kinds')).toBe('');
  });
});

// -------------------------------------------------------------------
// Own-vote overlay — added by
// `participant_ui.part_graph_view.part_own_vote_indicators`.
// Refinement: tasks/refinements/participant-ui/part_own_vote_indicators.md
//
// Six new cases pinning the per-target `data-own-vote` mirror attribute
// (Decision §5) on BOTH node AND edge rows (Decision §1 — structural
// symmetry), the corresponding `data.ownVote` field on the Cytoscape
// element set, and the four new `node[ownVote = "..."]` /
// `edge[ownVote = "..."]` stylesheet selectors (Decision §3).
// -------------------------------------------------------------------

function setEdgeSubstanceProposalEventOwn(opts: {
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

function voteEvent(opts: {
  sequence: number;
  proposalId: string;
  participant: string;
  vote: 'agree' | 'dispute' | 'withdraw';
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x700 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'vote',
    actor: opts.participant,
    payload: {
      target: 'proposal' as const,
      proposal_id: opts.proposalId,
      participant: opts.participant,
      choice: opts.vote as 'agree' | 'dispute',
      voted_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

describe('GraphView — own-vote overlay', () => {
  it('(nn) the node mirror carries data-own-vote="none" by default', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item).not.toBeNull();
    expect(item?.getAttribute('data-own-vote')).toBe('none');
  });

  it('(oo) when the current participant votes agree on a classify-node proposal, the node mirror reports data-own-vote="agree"', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      classifyProposalEvent({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    );
    seedEvent(
      voteEvent({
        sequence: 3,
        proposalId: PROPOSAL_A,
        participant: ME,
        vote: 'agree',
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item?.getAttribute('data-own-vote')).toBe('agree');
  });

  it('(pp) when the current participant retakes the vote to dispute, the node mirror reports data-own-vote="dispute" (latest-wins)', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      classifyProposalEvent({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    );
    seedEvent(
      voteEvent({
        sequence: 3,
        proposalId: PROPOSAL_A,
        participant: ME,
        vote: 'agree',
      }),
    );
    seedEvent(
      voteEvent({
        sequence: 4,
        proposalId: PROPOSAL_A,
        participant: ME,
        vote: 'dispute',
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item?.getAttribute('data-own-vote')).toBe('dispute');
  });

  it('(qq) when the current participant disputes a set-edge-substance proposal, the edge mirror reports data-own-vote="dispute"', () => {
    const EDGE_OWN = '00000000-0000-4000-8000-000000000abe';
    const SUBSTANCE_PROPOSAL = '00000000-0000-4000-8000-000000000ab2';
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(
      edgeCreatedEvent({
        sequence: 3,
        edgeId: EDGE_OWN,
        source: NODE_A,
        target: NODE_B,
      }),
    );
    seedEvent(
      setEdgeSubstanceProposalEventOwn({
        sequence: 4,
        envelopeId: SUBSTANCE_PROPOSAL,
        edgeId: EDGE_OWN,
      }),
    );
    seedEvent(
      voteEvent({
        sequence: 5,
        proposalId: SUBSTANCE_PROPOSAL,
        participant: ME,
        vote: 'dispute',
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-edge-status"][data-edge-id="${EDGE_OWN}"]`,
    );
    expect(item?.getAttribute('data-own-vote')).toBe('dispute');
  });

  it('(rr) Cytoscape carries the same data.ownVote the mirror surfaces (no drift); another participant\'s vote stays "none" for me', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(
      classifyProposalEvent({
        sequence: 3,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    );
    const PROPOSAL_B = '00000000-0000-4000-8000-0000000000b1';
    seedEvent(
      classifyProposalEvent({
        sequence: 4,
        envelopeId: PROPOSAL_B,
        nodeId: NODE_B,
        classification: 'fact',
      }),
    );
    // ME votes agree on NODE_A's classify-node proposal.
    seedEvent(
      voteEvent({
        sequence: 5,
        proposalId: PROPOSAL_A,
        participant: ME,
        vote: 'agree',
      }),
    );
    // SOMEONE_ELSE votes on NODE_B's classify-node proposal — the
    // per-participant filter means this MUST NOT surface on ME's
    // mirror.
    seedEvent(
      voteEvent({
        sequence: 6,
        proposalId: PROPOSAL_B,
        participant: SOMEONE_ELSE,
        vote: 'agree',
      }),
    );
    const cy = result.getCy();
    expect(cy.getElementById(NODE_A).data('ownVote')).toBe('agree');
    expect(cy.getElementById(NODE_B).data('ownVote')).toBe('none');
    const nodeAMirror = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    const nodeBMirror = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_B}"]`,
    );
    expect(nodeAMirror?.getAttribute('data-own-vote')).toBe('agree');
    // The per-participant filter contract: another participant's vote
    // on NODE_B does NOT change my own-vote on NODE_B.
    expect(nodeBMirror?.getAttribute('data-own-vote')).toBe('none');
  });

  it('(ss) STYLESHEET contains the four own-vote selectors with the expected text-outline overrides', () => {
    const sheet = STYLESHEET as unknown as ReadonlyArray<{
      selector: string;
      style: Record<string, unknown>;
    }>;
    const nodeAgree = sheet.find((entry) => entry.selector === 'node[ownVote = "agree"]');
    expect(nodeAgree).toBeDefined();
    expect(nodeAgree?.style['text-outline-color']).toBe('#10b981');
    expect(nodeAgree?.style['text-outline-width']).toBe(3);
    expect(nodeAgree?.style['text-outline-opacity']).toBe(1);

    const nodeDispute = sheet.find((entry) => entry.selector === 'node[ownVote = "dispute"]');
    expect(nodeDispute).toBeDefined();
    expect(nodeDispute?.style['text-outline-color']).toBe('#e11d48');
    expect(nodeDispute?.style['text-outline-width']).toBe(3);
    expect(nodeDispute?.style['text-outline-opacity']).toBe(1);

    const edgeAgree = sheet.find((entry) => entry.selector === 'edge[ownVote = "agree"]');
    expect(edgeAgree).toBeDefined();
    expect(edgeAgree?.style['text-outline-color']).toBe('#10b981');
    expect(edgeAgree?.style['text-outline-width']).toBe(2);
    expect(edgeAgree?.style['text-outline-opacity']).toBe(1);

    const edgeDispute = sheet.find((entry) => entry.selector === 'edge[ownVote = "dispute"]');
    expect(edgeDispute).toBeDefined();
    expect(edgeDispute?.style['text-outline-color']).toBe('#e11d48');
    expect(edgeDispute?.style['text-outline-width']).toBe(2);
    expect(edgeDispute?.style['text-outline-opacity']).toBe(1);
  });
});

// -------------------------------------------------------------------
// Other-vote overlay — added by
// `participant_ui.part_graph_view.part_other_vote_indicators`.
// Refinement: tasks/refinements/participant-ui/part_other_vote_indicators.md
//
// Six new cases pinning the per-target nested `<ul data-other-votes>`
// mirror (Decision §6) on BOTH node AND edge rows (Decision §1 —
// structural symmetry): empty default, single agree by an other
// participant, two distinct other voters in first-vote-arrival order,
// arm-switching keeps the original position (Decision §5),
// edge-targeted per-other-voter list, and the per-participant filter
// excludes the current participant's vote from the list.
// -------------------------------------------------------------------

function setEdgeSubstanceProposalEventOther(opts: {
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

function voteEventOther(opts: {
  sequence: number;
  proposalId: string;
  participant: string;
  vote: 'agree' | 'dispute' | 'withdraw';
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x900 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'vote',
    actor: opts.participant,
    payload: {
      target: 'proposal' as const,
      proposal_id: opts.proposalId,
      participant: opts.participant,
      choice: opts.vote as 'agree' | 'dispute',
      voted_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

const OTHER_VOTER_A = '00000000-0000-4000-8000-0000000000a1';
const OTHER_VOTER_B = '00000000-0000-4000-8000-0000000000b1';

describe('GraphView — other-vote overlay', () => {
  it('(tt) the per-node mirror renders an empty nested <ul data-other-votes> by default', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(item).not.toBeNull();
    const otherVotesList = item?.querySelector('ul[data-other-votes]');
    // The <ul> itself MUST be present (the explicit empty-list
    // contract — Decision §6); the count of children MUST be 0.
    expect(otherVotesList).not.toBeNull();
    expect(otherVotesList?.querySelectorAll('li[data-other-vote]').length).toBe(0);
  });

  it('(uu) when an OTHER participant votes agree on a classify-node proposal, the node mirror has one <li data-other-vote data-voter-id="..." data-vote="agree"> in the nested <ul>', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      classifyProposalEvent({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    );
    seedEvent(
      voteEventOther({
        sequence: 3,
        proposalId: PROPOSAL_A,
        participant: OTHER_VOTER_A,
        vote: 'agree',
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    const voteEntries = item?.querySelectorAll('ul[data-other-votes] li[data-other-vote]');
    expect(voteEntries?.length).toBe(1);
    expect(voteEntries?.[0]?.getAttribute('data-voter-id')).toBe(OTHER_VOTER_A);
    expect(voteEntries?.[0]?.getAttribute('data-vote')).toBe('agree');
  });

  it('(vv) two distinct other voters surface as TWO <li> entries in first-vote-arrival order (Decision §5)', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      classifyProposalEvent({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    );
    // OTHER_VOTER_A votes first → index 0.
    seedEvent(
      voteEventOther({
        sequence: 3,
        proposalId: PROPOSAL_A,
        participant: OTHER_VOTER_A,
        vote: 'agree',
      }),
    );
    // OTHER_VOTER_B votes second → index 1.
    seedEvent(
      voteEventOther({
        sequence: 4,
        proposalId: PROPOSAL_A,
        participant: OTHER_VOTER_B,
        vote: 'dispute',
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    const voteEntries = item?.querySelectorAll('ul[data-other-votes] li[data-other-vote]');
    expect(voteEntries?.length).toBe(2);
    expect(voteEntries?.[0]?.getAttribute('data-voter-id')).toBe(OTHER_VOTER_A);
    expect(voteEntries?.[0]?.getAttribute('data-vote')).toBe('agree');
    expect(voteEntries?.[1]?.getAttribute('data-voter-id')).toBe(OTHER_VOTER_B);
    expect(voteEntries?.[1]?.getAttribute('data-vote')).toBe('dispute');
  });

  it('(ww) when the same other voter switches arm, the nested <ul> still has ONE <li> with the latest arm, at the original position (Decision §5)', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      classifyProposalEvent({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    );
    seedEvent(
      voteEventOther({
        sequence: 3,
        proposalId: PROPOSAL_A,
        participant: OTHER_VOTER_A,
        vote: 'agree',
      }),
    );
    seedEvent(
      voteEventOther({
        sequence: 4,
        proposalId: PROPOSAL_A,
        participant: OTHER_VOTER_A,
        vote: 'dispute',
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    const voteEntries = item?.querySelectorAll('ul[data-other-votes] li[data-other-vote]');
    expect(voteEntries?.length).toBe(1);
    expect(voteEntries?.[0]?.getAttribute('data-voter-id')).toBe(OTHER_VOTER_A);
    expect(voteEntries?.[0]?.getAttribute('data-vote')).toBe('dispute');
  });

  it('(xx) when an OTHER participant disputes a set-edge-substance proposal, the edge mirror has one <li data-vote="dispute"> in the nested <ul>', () => {
    const EDGE_OTHER = '00000000-0000-4000-8000-000000000ace';
    const SUBSTANCE_PROPOSAL = '00000000-0000-4000-8000-000000000ac2';
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(
      edgeCreatedEvent({
        sequence: 3,
        edgeId: EDGE_OTHER,
        source: NODE_A,
        target: NODE_B,
      }),
    );
    seedEvent(
      setEdgeSubstanceProposalEventOther({
        sequence: 4,
        envelopeId: SUBSTANCE_PROPOSAL,
        edgeId: EDGE_OTHER,
      }),
    );
    seedEvent(
      voteEventOther({
        sequence: 5,
        proposalId: SUBSTANCE_PROPOSAL,
        participant: OTHER_VOTER_A,
        vote: 'dispute',
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-edge-status"][data-edge-id="${EDGE_OTHER}"]`,
    );
    const voteEntries = item?.querySelectorAll('ul[data-other-votes] li[data-other-vote]');
    expect(voteEntries?.length).toBe(1);
    expect(voteEntries?.[0]?.getAttribute('data-voter-id')).toBe(OTHER_VOTER_A);
    expect(voteEntries?.[0]?.getAttribute('data-vote')).toBe('dispute');
  });

  it('(yy) votes by the CURRENT participant do NOT appear in the nested <ul> (per-participant filter excludes self)', () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      classifyProposalEvent({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    );
    // Only the current participant (`ME`) votes; the filter
    // (`voter.id !== currentParticipantId`) drops the vote so the
    // nested <ul> stays empty.
    seedEvent(
      voteEventOther({
        sequence: 3,
        proposalId: PROPOSAL_A,
        participant: ME,
        vote: 'agree',
      }),
    );
    const item = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    const otherVotesList = item?.querySelector('ul[data-other-votes]');
    expect(otherVotesList).not.toBeNull();
    expect(otherVotesList?.querySelectorAll('li[data-other-vote]').length).toBe(0);
  });
});

// -------------------------------------------------------------------
// Canvas-side per-other-voter dot row overlay — added by
// `participant_ui.part_graph_view.part_other_vote_indicators_canvas_dots`.
// Refinement: tasks/refinements/participant-ui/part_other_vote_indicators_canvas_dots.md
//
// Four new cases pin the integration of `<OtherVotesOverlay>` into the
// `<GraphView>` return JSX: the overlay mounts as a sibling of the
// canvas, the `participant-graph-root` containing block becomes
// `relative` (so the absolute-positioned overlay anchors inside the
// graph root), and the overlay surfaces per-element dot-row containers
// keyed by Cytoscape element id when the `data.otherVotes` field is
// populated. The per-component behaviours of the overlay itself
// (rAF batching, listener cleanup, per-arm color mapping) are pinned
// at the dedicated `OtherVotesOverlay.test.tsx` layer.
// -------------------------------------------------------------------

describe('GraphView — canvas-side other-vote dot row overlay', () => {
  it('(zz1) the overlay is mounted as a sibling of the canvas inside the graph root after mount', () => {
    renderView();
    const overlay = document.querySelector('[data-testid="participant-other-votes-overlay"]');
    expect(overlay).not.toBeNull();
  });

  it('(zz2) the participant-graph-root container carries the `relative` positioning ancestor class', () => {
    renderView();
    const root = document.querySelector('[data-testid="participant-graph-root"]');
    expect(root).not.toBeNull();
    const className = root?.getAttribute('class') ?? '';
    expect(className).toContain('relative');
  });

  it('(zz3) when a node has non-empty otherVotes, the overlay renders one <div data-canvas-vote-dots> with the per-voter dot count', async () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      classifyProposalEvent({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    );
    seedEvent(
      voteEventOther({
        sequence: 3,
        proposalId: PROPOSAL_A,
        participant: OTHER_VOTER_A,
        vote: 'agree',
      }),
    );
    seedEvent(
      voteEventOther({
        sequence: 4,
        proposalId: PROPOSAL_A,
        participant: OTHER_VOTER_B,
        vote: 'dispute',
      }),
    );
    // The overlay's commit runs inside a rAF; the happy-dom polyfill
    // schedules via `queueMicrotask`, so a few microtask drains
    // (wrapped in `act`) flush the commit + React's resulting re-render.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const container = document.querySelector(
      `[data-canvas-vote-dots][data-element-id="${NODE_A}"]`,
    );
    expect(container).not.toBeNull();
    const dots = container?.querySelectorAll('[data-canvas-vote-dot]');
    expect(dots?.length).toBe(2);
    expect(dots?.[0]?.getAttribute('data-voter-id')).toBe(OTHER_VOTER_A);
    expect(dots?.[0]?.getAttribute('data-vote')).toBe('agree');
    expect(dots?.[1]?.getAttribute('data-voter-id')).toBe(OTHER_VOTER_B);
    expect(dots?.[1]?.getAttribute('data-vote')).toBe('dispute');
  });

  it('(zz4) the overlay short-circuits to an empty render when no element has non-empty otherVotes (early-exit branch)', () => {
    renderView();
    // Two un-voted nodes — the overlay wrapper renders but contains
    // zero `<div data-canvas-vote-dots>` entries.
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    const overlay = document.querySelector('[data-testid="participant-other-votes-overlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelectorAll('[data-canvas-vote-dots]').length).toBe(0);
  });
});

// -------------------------------------------------------------------
// Pan + zoom + tap-to-select wiring — added by
// `participant_ui.part_graph_view.part_pan_zoom_tap`.
// Refinement: tasks/refinements/participant-ui/part_pan_zoom_tap.md
//
// 13 new cases pin: (1) the 7 explicit Cytoscape mount-config flags
// (pan/zoom on, box-select off, single-select, ungrabbable, MIN_ZOOM /
// MAX_ZOOM bounds — Decisions §1 + §2 + §3); (2) the `handleTap`
// three-branch discriminator + store-write semantics (Decisions §5 +
// §6); (3) the DOM mirror's additive `data-selected` attribute on both
// node + edge row kinds (Decision §7); (4) the `STYLESHEET`'s two new
// `:selected` selectors (Decision §4); (5) the `<OtherVotesOverlay>`
// `pointer-events: none` cross-layer posture (Decision §10) so a
// future overlay regression that drops the class is caught here.
// -------------------------------------------------------------------

describe('GraphView — part_pan_zoom_tap (pan + zoom + tap-to-select)', () => {
  it('(pz-a) cy.userPanningEnabled() returns true after mount', () => {
    const result = renderView();
    expect(result.getCy().userPanningEnabled()).toBe(true);
  });

  it('(pz-b) cy.userZoomingEnabled() returns true after mount', () => {
    const result = renderView();
    expect(result.getCy().userZoomingEnabled()).toBe(true);
  });

  it('(pz-c) cy.minZoom() / cy.maxZoom() return the exported MIN_ZOOM / MAX_ZOOM constants', () => {
    const result = renderView();
    const cy = result.getCy();
    expect(cy.minZoom()).toBe(MIN_ZOOM);
    expect(cy.maxZoom()).toBe(MAX_ZOOM);
    // Source-of-truth pin: the constants exported from GraphView.tsx
    // are the empirical participant-tablet calibration from
    // `part_pan_zoom_tap` Decision §2 (mirrors moderator's
    // mod_pan_zoom).
    expect(MIN_ZOOM).toBe(0.1);
    expect(MAX_ZOOM).toBe(2.5);
  });

  it('(pz-d) cy.boxSelectionEnabled() returns false after mount', () => {
    const result = renderView();
    expect(result.getCy().boxSelectionEnabled()).toBe(false);
  });

  it('(pz-e) cy.autoungrabify() returns true after mount', () => {
    const result = renderView();
    expect(result.getCy().autoungrabify()).toBe(true);
  });

  it('(pz-f) handleTap on a node writes { kind: "node", id } to useSelectionStore AND adds the node to cy:selected', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    const cy = result.getCy();
    const node = cy.getElementById(NODE_A);
    expect(node.length).toBe(1);
    act(() => {
      handleTap({
        target: node,
        cy,
      } as unknown as Parameters<typeof handleTap>[0]);
    });
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'node', id: NODE_A });
    // Cytoscape's internal selection set picks up the explicit
    // `.select()` call inside `handleTap`.
    expect(cy.$(':selected').contains(node)).toBe(true);
  });

  it('(pz-g) handleTap on an edge writes { kind: "edge", id } to useSelectionStore AND adds the edge to cy:selected', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(edgeCreatedEvent({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }));
    const cy = result.getCy();
    const edge = cy.getElementById(EDGE_A);
    expect(edge.length).toBe(1);
    act(() => {
      handleTap({
        target: edge,
        cy,
      } as unknown as Parameters<typeof handleTap>[0]);
    });
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'edge', id: EDGE_A });
    expect(cy.$(':selected').contains(edge)).toBe(true);
  });

  it('(pz-h) handleTap on the cy core (empty canvas) clears the store AND unselects every cy element', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    const cy = result.getCy();
    const node = cy.getElementById(NODE_A);
    // Set a prior selection so the empty-canvas branch has something
    // to clear.
    act(() => {
      handleTap({
        target: node,
        cy,
      } as unknown as Parameters<typeof handleTap>[0]);
    });
    expect(useSelectionStore.getState().selected).not.toBeNull();
    expect(cy.$(':selected').length).toBeGreaterThan(0);
    // Empty-canvas tap.
    act(() => {
      handleTap({
        target: cy,
        cy,
      } as unknown as Parameters<typeof handleTap>[0]);
    });
    expect(useSelectionStore.getState().selected).toBeNull();
    expect(cy.$(':selected').length).toBe(0);
  });

  it('(pz-i) tapping a different element after a prior tap unselects the prior element (single-selection)', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    const cy = result.getCy();
    const nodeA = cy.getElementById(NODE_A);
    const nodeB = cy.getElementById(NODE_B);
    // Tap NODE_A first.
    act(() => {
      handleTap({
        target: nodeA,
        cy,
      } as unknown as Parameters<typeof handleTap>[0]);
    });
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'node', id: NODE_A });
    // Then tap NODE_B — single-selection: NODE_A must drop out of
    // the selection set, NODE_B must be the sole `:selected`.
    act(() => {
      handleTap({
        target: nodeB,
        cy,
      } as unknown as Parameters<typeof handleTap>[0]);
    });
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'node', id: NODE_B });
    expect(cy.$(':selected').contains(nodeA)).toBe(false);
    expect(cy.$(':selected').contains(nodeB)).toBe(true);
    expect(cy.$(':selected').length).toBe(1);
  });

  it('(pz-j) the DOM mirror <li> rows carry data-selected="true" on the matching row and "false" on the rest', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(edgeCreatedEvent({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }));
    // Before any tap — every row reads "false".
    const initialNodeARow = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    expect(initialNodeARow?.getAttribute('data-selected')).toBe('false');
    const initialEdgeRow = document.querySelector(
      `[data-testid="participant-edge-status"][data-edge-id="${EDGE_A}"]`,
    );
    expect(initialEdgeRow?.getAttribute('data-selected')).toBe('false');
    // Tap NODE_A.
    const cy = result.getCy();
    act(() => {
      handleTap({
        target: cy.getElementById(NODE_A),
        cy,
      } as unknown as Parameters<typeof handleTap>[0]);
    });
    const nodeARow = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    const nodeBRow = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_B}"]`,
    );
    const edgeRow = document.querySelector(
      `[data-testid="participant-edge-status"][data-edge-id="${EDGE_A}"]`,
    );
    expect(nodeARow?.getAttribute('data-selected')).toBe('true');
    expect(nodeBRow?.getAttribute('data-selected')).toBe('false');
    expect(edgeRow?.getAttribute('data-selected')).toBe('false');
    // Tap the edge — NODE_A row flips back to "false", edge row to
    // "true" (single-selection semantic surfaces through the mirror).
    act(() => {
      handleTap({
        target: cy.getElementById(EDGE_A),
        cy,
      } as unknown as Parameters<typeof handleTap>[0]);
    });
    const nodeARowAfter = document.querySelector(
      `[data-testid="participant-node-status"][data-node-id="${NODE_A}"]`,
    );
    const edgeRowAfter = document.querySelector(
      `[data-testid="participant-edge-status"][data-edge-id="${EDGE_A}"]`,
    );
    expect(nodeARowAfter?.getAttribute('data-selected')).toBe('false');
    expect(edgeRowAfter?.getAttribute('data-selected')).toBe('true');
  });

  it('(pz-k) STYLESHEET contains a node:selected selector AND an edge:selected selector', () => {
    const selectors = (STYLESHEET as Array<{ selector: string }>).map((entry) => entry.selector);
    expect(selectors).toContain('node:selected');
    expect(selectors).toContain('edge:selected');
  });

  it('(pz-l) the selected-state stylesheet entries claim only the documented primitives (z-index + background-blacken / line-color / target-arrow-color / width)', () => {
    const nodeSelected = (
      STYLESHEET as Array<{ selector: string; style: Record<string, unknown> }>
    ).find((entry) => entry.selector === 'node:selected');
    const edgeSelected = (
      STYLESHEET as Array<{ selector: string; style: Record<string, unknown> }>
    ).find((entry) => entry.selector === 'edge:selected');
    expect(nodeSelected).toBeDefined();
    expect(edgeSelected).toBeDefined();
    // Node side: previously-unclaimed primitives only — z-index +
    // background-blacken. NOT any of the rollup / axiom / annotation /
    // diagnostic / own-vote claims (border-*, background-color,
    // opacity, outline-*, overlay-*, text-outline-*).
    const nodeKeys = Object.keys(nodeSelected?.style ?? {}).sort();
    expect(nodeKeys).toEqual(['background-blacken', 'z-index']);
    // Edge side: recoverable overrides (line-color +
    // target-arrow-color + width) + z-index. The line/arrow color is
    // a recoverable override because the per-status branch's value
    // restores when the element unselects.
    const edgeKeys = Object.keys(edgeSelected?.style ?? {}).sort();
    expect(edgeKeys).toEqual(['line-color', 'target-arrow-color', 'width', 'z-index']);
  });

  it('(pz-n) cy.emit("tap") on a node propagates to the registered handler and writes the selection (validates the __aConversaCyInstance seam path used by the Playwright spec)', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    const cy = result.getCy();
    const node = cy.getElementById(NODE_A);
    expect(node.length).toBe(1);
    // Validates the e2e wiring: `element.emit('tap')` runs Cytoscape's
    // emit pipeline through to the `cy.on('tap', handleTap)`
    // registration installed by the mount effect — same path the
    // Playwright spec's `page.evaluate(...)` walks via the
    // `window.__aConversaCyInstance` test seam.
    act(() => {
      node.emit('tap');
    });
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'node', id: NODE_A });
  });

  it('(pz-m) <OtherVotesOverlay> root carries pointer-events: none so taps reach the Cytoscape canvas', () => {
    // Decision §10 — cross-layer verification. The overlay sits ABOVE
    // the Cytoscape canvas mount; if the `pointer-events-none`
    // Tailwind class drops (or a higher-specificity rule shadows it),
    // taps that originate in the overlay's screen-space rectangle
    // would be captured by the overlay instead of propagating to the
    // canvas — silently breaking tap-to-select on entities under the
    // overlay's dot row.
    renderView();
    const overlay = document.querySelector('[data-testid="participant-other-votes-overlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('class') ?? '').toContain('pointer-events-none');
  });
});
