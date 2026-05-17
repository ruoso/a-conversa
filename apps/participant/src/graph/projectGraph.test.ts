// Vitest cases for the participant's pure `projectGraph` projection.
//
// Refinement: tasks/refinements/participant-ui/part_graph_render.md
//              (Test layers per ADR 0022 — original ten cases per the
//              refinement's "Tests pin" sketch).
// Refinement: tasks/refinements/participant-ui/part_per_facet_state_styling.md
//              (Constraints — signature widens to take a
//              `FacetStatusIndex`; eight new cases added covering
//              the per-facet stamping + rollup behaviour.)
// Refinement: tasks/refinements/participant-ui/part_axiom_mark_decoration.md
//              (Constraints — signature widens AGAIN to take an
//              `axiomMarkIndex`; existing cases pass the empty index
//              via the `emptyAxiomIndex()` factory; 5 new cases added
//              covering the `isAxiom` stamping behaviour.)
// ADRs:        0022 (no throwaway verifications — the projection's
//              behaviour is fully pinned at this pure layer; the
//              `<GraphView>` mount tests then assert the Cytoscape
//              side without re-asserting algorithmic behaviour).
//
// All event factories mirror the moderator's `GraphCanvasPane.test.tsx`
// shape so a reader cross-referencing the two surfaces sees the same
// envelope construction idiom.

import { describe, expect, it } from 'vitest';
import type { EdgeRole, Event, StatementKind } from '@a-conversa/shared-types';

import { projectGraph } from './projectGraph';
import type { AxiomMark } from './axiomMarks';
import type { FacetName, FacetStatus, FacetStatusIndex } from './facetStatus';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const EDGE_A = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

/**
 * Empty `FacetStatusIndex` — the baseline argument for tests that don't
 * care about the per-facet stamping. Built fresh per test invocation
 * (the Maps are mutable internally — though this projector never
 * writes to them — and downstream tests must not share Map references).
 */
function emptyIndex(): FacetStatusIndex {
  return { nodes: new Map(), edges: new Map() };
}

/**
 * Empty axiom-mark index — the baseline argument for tests that don't
 * care about axiom stamping. Built fresh per call so the Map is never
 * shared across tests.
 */
function emptyAxiomIndex(): ReadonlyMap<string, readonly AxiomMark[]> {
  return new Map<string, readonly AxiomMark[]>();
}

/**
 * Build an axiom-mark index from a literal record. The participant's
 * `projectGraph` only consults the `nodeHasAxiomMark` boolean — but the
 * factory carries one synthetic `AxiomMark` per listed node so the
 * Map's `length > 0` invariant holds.
 */
function axiomIndexFromIds(nodeIds: readonly string[]): ReadonlyMap<string, readonly AxiomMark[]> {
  const out = new Map<string, readonly AxiomMark[]>();
  for (const nodeId of nodeIds) {
    out.set(nodeId, [
      {
        nodeId,
        participantId: '00000000-0000-4000-8000-0000000000ff',
        committedAt: '2026-05-17T00:00:00.000Z',
      },
    ]);
  }
  return out;
}

/**
 * Build a `FacetStatusIndex` from convenient literal records. Each
 * entity record is a partial facet record (e.g.
 * `{ classification: 'proposed' }`); the helper wraps it in a Map.
 */
function indexFromLiterals(opts: {
  nodes?: Record<string, Partial<Record<FacetName, FacetStatus>>>;
  edges?: Record<string, Partial<Record<FacetName, FacetStatus>>>;
}): FacetStatusIndex {
  const nodes = new Map<string, Partial<Record<FacetName, FacetStatus>>>();
  for (const [id, record] of Object.entries(opts.nodes ?? {})) {
    nodes.set(id, record);
  }
  const edges = new Map<string, Partial<Record<FacetName, FacetStatus>>>();
  for (const [id, record] of Object.entries(opts.edges ?? {})) {
    edges.set(id, record);
  }
  return { nodes, edges };
}

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
      created_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function makeEdgeCreated(opts: {
  sequence: number;
  edgeId: string;
  source: string;
  target: string;
  role?: EdgeRole;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x300 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
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

function makeClassifyProposal(opts: {
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
      committed_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function makeParticipantJoined(opts: { sequence: number; userId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x500 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'participant-joined',
    actor: opts.userId,
    payload: {
      user_id: opts.userId,
      role: 'debater-A',
      screen_name: 'noisy',
      joined_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

describe('projectGraph — pure projection from events to Cytoscape elements', () => {
  it('(a) returns empty arrays for an empty event log', () => {
    expect(projectGraph([], emptyIndex(), emptyAxiomIndex())).toEqual({ nodes: [], edges: [] });
  });

  it('(b) emits one node descriptor per node-created event with kind: null and rollup "none" when index is empty', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'UBI lifts welfare floor' }),
    ];
    const { nodes, edges } = projectGraph(events, emptyIndex(), emptyAxiomIndex());
    expect(edges).toEqual([]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      group: 'nodes',
      data: {
        id: NODE_A,
        wording: 'UBI lifts welfare floor',
        kind: null,
        rollupStatus: 'none',
      },
    });
    expect(nodes[0]?.data.facetStatuses).toEqual({});
  });

  it('(c) emits one edge descriptor per edge-created event with source / target / role / rollup "none"', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({
        sequence: 3,
        edgeId: EDGE_A,
        source: NODE_A,
        target: NODE_B,
        role: 'rebuts',
      }),
    ];
    const { edges } = projectGraph(events, emptyIndex(), emptyAxiomIndex());
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      group: 'edges',
      data: {
        id: EDGE_A,
        source: NODE_A,
        target: NODE_B,
        role: 'rebuts',
        rollupStatus: 'none',
      },
    });
    expect(edges[0]?.data.facetStatuses).toEqual({});
  });

  it('(d) projects a mixed event log into both nodes and edges in their respective arrival orders', () => {
    const EDGE_B = '00000000-0000-4000-8000-00000000000f';
    const events: Event[] = [
      makeEdgeCreated({ sequence: 1, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_A, wording: 'A' }),
      makeEdgeCreated({
        sequence: 3,
        edgeId: EDGE_B,
        source: NODE_B,
        target: NODE_A,
        role: 'qualifies',
      }),
      makeNodeCreated({ sequence: 4, nodeId: NODE_B, wording: 'B' }),
    ];
    const { nodes, edges } = projectGraph(events, emptyIndex(), emptyAxiomIndex());
    expect(nodes.map((n) => n.data.id)).toEqual([NODE_A, NODE_B]);
    expect(edges.map((e) => e.data.id)).toEqual([EDGE_A, EDGE_B]);
  });

  it('(e) leaves kind: null when a classify-node proposal exists but no commit landed', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    ];
    const { nodes } = projectGraph(events, emptyIndex(), emptyAxiomIndex());
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.kind).toBeNull();
  });

  it('(f) flips kind to the committed classification after a classify-node proposal + commit pair', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'normative',
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events, emptyIndex(), emptyAxiomIndex());
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.kind).toBe('normative');
  });

  it('(g) ignores a commit whose proposal id has not been seen', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeCommit({ sequence: 2, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events, emptyIndex(), emptyAxiomIndex());
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.kind).toBeNull();
  });

  it('(h) round-trips every StatementKind through a proposal + commit pair', () => {
    const kinds: StatementKind[] = ['fact', 'predictive', 'value', 'normative', 'definitional'];
    for (const kind of kinds) {
      const proposalId = `00000000-0000-4000-8000-0000000000${kind.length.toString(16).padStart(2, '0')}1`;
      const events: Event[] = [
        makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: `wording for ${kind}` }),
        makeClassifyProposal({
          sequence: 2,
          envelopeId: proposalId,
          nodeId: NODE_A,
          classification: kind,
        }),
        makeCommit({ sequence: 3, proposalEnvelopeId: proposalId }),
      ];
      const { nodes } = projectGraph(events, emptyIndex(), emptyAxiomIndex());
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.data.kind).toBe(kind);
    }
  });

  it('(i) round-trips every EdgeRole through edge-created descriptors', () => {
    const roles: EdgeRole[] = [
      'supports',
      'rebuts',
      'qualifies',
      'bridges-from',
      'bridges-to',
      'defines',
      'contradicts',
    ];
    roles.forEach((role, index) => {
      const edgeId = `00000000-0000-4000-8000-0000000000${(index + 1).toString(16).padStart(2, '0')}0`;
      const events: Event[] = [
        makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
        makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
        makeEdgeCreated({
          sequence: 3,
          edgeId,
          source: NODE_A,
          target: NODE_B,
          role,
        }),
      ];
      const { edges } = projectGraph(events, emptyIndex(), emptyAxiomIndex());
      expect(edges).toHaveLength(1);
      expect(edges[0]?.data.role).toBe(role);
    });
  });

  it('(j) is event-ordering invariant — unrelated events between a classify-node proposal and its commit do not break the kind flip', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'value',
      }),
      // Unrelated event interleaved between the proposal and the
      // commit — the projection must not lose the cached proposal.
      makeParticipantJoined({ sequence: 3, userId: ACTOR }),
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events, emptyIndex(), emptyAxiomIndex());
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.kind).toBe('value');
  });
});

describe('projectGraph — per-facet status stamping (part_per_facet_state_styling)', () => {
  it('(k) threads facetStatuses.classification through onto the emitted node when the index carries the entry', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const index = indexFromLiterals({
      nodes: { [NODE_A]: { classification: 'proposed' } },
    });
    const { nodes } = projectGraph(events, index, emptyAxiomIndex());
    expect(nodes[0]?.data.facetStatuses).toEqual({ classification: 'proposed' });
  });

  it('(l) threads facetStatuses.substance through onto the emitted node', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const index = indexFromLiterals({
      nodes: { [NODE_A]: { substance: 'agreed' } },
    });
    const { nodes } = projectGraph(events, index, emptyAxiomIndex());
    expect(nodes[0]?.data.facetStatuses).toEqual({ substance: 'agreed' });
  });

  it('(m) threads facetStatuses.wording through onto the emitted node', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const index = indexFromLiterals({
      nodes: { [NODE_A]: { wording: 'disputed' } },
    });
    const { nodes } = projectGraph(events, index, emptyAxiomIndex());
    expect(nodes[0]?.data.facetStatuses).toEqual({ wording: 'disputed' });
  });

  it('(n) threads facetStatuses.substance through onto the emitted edge', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
    ];
    const index = indexFromLiterals({
      edges: { [EDGE_A]: { substance: 'proposed' } },
    });
    const { edges } = projectGraph(events, index, emptyAxiomIndex());
    expect(edges[0]?.data.facetStatuses).toEqual({ substance: 'proposed' });
    expect(edges[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(o) rollupStatus reads "proposed" when any facet is proposed', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const index = indexFromLiterals({
      nodes: { [NODE_A]: { classification: 'proposed', substance: 'agreed' } },
    });
    const { nodes } = projectGraph(events, index, emptyAxiomIndex());
    expect(nodes[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(p) rollupStatus reads "agreed" when all facets are agreed', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const index = indexFromLiterals({
      nodes: { [NODE_A]: { classification: 'agreed', substance: 'agreed' } },
    });
    const { nodes } = projectGraph(events, index, emptyAxiomIndex());
    expect(nodes[0]?.data.rollupStatus).toBe('agreed');
  });

  it('(q) rollupStatus reads "none" (sentinel string) when the per-entity record is empty / absent', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    // The index has no entry at all for NODE_A.
    const { nodes } = projectGraph(events, emptyIndex(), emptyAxiomIndex());
    expect(nodes[0]?.data.rollupStatus).toBe('none');
    // Also when the entry is present but the record is empty.
    const indexEmptyRecord = indexFromLiterals({ nodes: { [NODE_A]: {} } });
    const { nodes: nodes2 } = projectGraph(events, indexEmptyRecord, emptyAxiomIndex());
    expect(nodes2[0]?.data.rollupStatus).toBe('none');
  });

  it('(r) multi-facet node (classification proposed, substance agreed) rolls up to "proposed" per ROLLUP_PRIORITY order', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const index = indexFromLiterals({
      nodes: { [NODE_A]: { classification: 'proposed', substance: 'agreed' } },
    });
    const { nodes } = projectGraph(events, index, emptyAxiomIndex());
    expect(nodes[0]?.data.rollupStatus).toBe('proposed');
    expect(nodes[0]?.data.facetStatuses).toEqual({
      classification: 'proposed',
      substance: 'agreed',
    });
  });
});

describe('projectGraph — axiom-mark stamping (part_axiom_mark_decoration)', () => {
  it('(s) stamps isAxiom: false on every node by default (empty axiom index)', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
    ];
    const { nodes } = projectGraph(events, emptyIndex(), emptyAxiomIndex());
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.data.isAxiom).toBe(false);
    expect(nodes[1]?.data.isAxiom).toBe(false);
  });

  it('(t) stamps isAxiom: true on a node the axiom index targets', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const axiomIndex = axiomIndexFromIds([NODE_A]);
    const { nodes } = projectGraph(events, emptyIndex(), axiomIndex);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.isAxiom).toBe(true);
  });

  it('(u) stamps isAxiom: false on the other nodes when only one is targeted', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
    ];
    const axiomIndex = axiomIndexFromIds([NODE_A]);
    const { nodes } = projectGraph(events, emptyIndex(), axiomIndex);
    expect(nodes).toHaveLength(2);
    const byId = new Map(nodes.map((n) => [n.data.id, n.data.isAxiom]));
    expect(byId.get(NODE_A)).toBe(true);
    expect(byId.get(NODE_B)).toBe(false);
  });

  it('(v) isAxiom survives a classify-node commit (the spread in the commit branch preserves the boolean)', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const axiomIndex = axiomIndexFromIds([NODE_A]);
    const { nodes } = projectGraph(events, emptyIndex(), axiomIndex);
    expect(nodes).toHaveLength(1);
    // Both the classification AND the axiom-mark survive.
    expect(nodes[0]?.data.kind).toBe('fact');
    expect(nodes[0]?.data.isAxiom).toBe(true);
  });

  it('(w) edges carry no isAxiom field — ParticipantEdgeData does not include the property', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({
        sequence: 3,
        edgeId: EDGE_A,
        source: NODE_A,
        target: NODE_B,
      }),
    ];
    // Even when the axiom index has entries for nodes, edges never
    // carry the boolean — wire schema is node-only per
    // `axiomMarkProposalSchema`.
    const axiomIndex = axiomIndexFromIds([NODE_A, NODE_B]);
    const { edges } = projectGraph(events, emptyIndex(), axiomIndex);
    expect(edges).toHaveLength(1);
    expect((edges[0]?.data as unknown as Record<string, unknown>).isAxiom).toBeUndefined();
  });
});
