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
// Refinement: tasks/refinements/participant-ui/part_annotation_render.md
//              (Constraints — signature widens AGAIN to take
//              `nodeAnnotationIndex` + `edgeAnnotationIndex`; existing
//              cases pass empty indexes via `emptyAnnotationIndex()`;
//              6 new cases added covering the per-target
//              `hasAnnotation` + `annotationCount` stamping on BOTH
//              nodes AND edges per Decision §1's structural symmetry.)
// Refinement: tasks/refinements/participant-ui/part_diagnostic_highlights.md
//              (Constraints — signature widens AGAIN to take a sixth
//              `diagnosticHighlightIndex: DiagnosticHighlightIndex`
//              argument; existing cases pass the shared
//              `EMPTY_DIAGNOSTIC_HIGHLIGHTS` reference; 6 new cases
//              added covering the per-target
//              `diagnosticHighlight` stamping on BOTH nodes AND edges
//              per Decision §1's structural symmetry.)
// Refinement: tasks/refinements/participant-ui/part_own_vote_indicators.md
//              (Constraints — signature widens AGAIN to take a seventh
//              `ownVoteIndex: OwnVoteIndex` argument; existing cases
//              pass the shared `EMPTY_OWN_VOTES` reference; 5 new
//              cases added covering the per-target `ownVote` stamping
//              on BOTH nodes AND edges per Decision §1's structural
//              symmetry — agree / dispute / 'none' baseline, edge-
//              targeted vote, survival through a classify-node commit,
//              and orthogonal composition with the per-facet rollup
//              status.)
// Refinement: tasks/refinements/participant-ui/part_other_vote_indicators.md
//              (Constraints — signature widens AGAIN to take an eighth
//              `othersVoteIndex: OthersVoteIndex` argument; existing
//              cases pass the shared `EMPTY_OTHERS_VOTES` reference; 5
//              new cases added covering the per-target `otherVotes`
//              list stamping on BOTH nodes AND edges per Decision §1's
//              structural symmetry — empty-list default,
//              per-other-voter list on a node, per-other-voter list on
//              an edge, survival through a classify-node commit, and
//              orthogonal composition with the per-self `ownVote`
//              field.)
// ADRs:        0022 (no throwaway verifications — the projection's
//              behaviour is fully pinned at this pure layer; the
//              `<GraphView>` mount tests then assert the Cytoscape
//              side without re-asserting algorithmic behaviour).
//
// All event factories mirror the moderator's `GraphCanvasPane.test.tsx`
// shape so a reader cross-referencing the two surfaces sees the same
// envelope construction idiom.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnnotationKind, EdgeRole, Event, StatementKind } from '@a-conversa/shared-types';

import { projectGraph } from './projectGraph';
import { groupAnnotationsByEntityId, projectAnnotations, type Annotation } from './annotations';
import type { AxiomMark } from './axiomMarks';
import {
  EMPTY_DIAGNOSTIC_HIGHLIGHTS,
  type DiagnosticHighlight,
  type DiagnosticHighlightIndex,
  type DiagnosticHighlightKind,
  type DiagnosticHighlightSeverity,
  type FacetName,
  type FacetStatus,
  type FacetStatusIndex,
} from '@a-conversa/shell';
import { EMPTY_OWN_VOTES, type OwnVote, type OwnVoteIndex } from './ownVotes';
import {
  EMPTY_OTHER_VOTES_LIST,
  EMPTY_OTHERS_VOTES,
  type OtherVote,
  type OthersVoteIndex,
} from './otherVotes';

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
 * Empty annotation index — the baseline argument for tests that don't
 * care about annotation stamping. Built fresh per call so the Map is
 * never shared across tests.
 */
function emptyAnnotationIndex(): ReadonlyMap<string, readonly Annotation[]> {
  return new Map<string, readonly Annotation[]>();
}

/**
 * Build an annotation index from a literal `{ id: count }` record. The
 * projector consumes `annotationCountFor(grouped, id)` so the per-id
 * length matters; the synthetic `Annotation` body details are
 * irrelevant to the stamping (only `targetNodeId` / `targetEdgeId`
 * routing matters at the bucketer layer, which has already run before
 * this index reaches the projector).
 */
function annotationIndexFromCounts(
  counts: Record<string, number>,
): ReadonlyMap<string, readonly Annotation[]> {
  const out = new Map<string, readonly Annotation[]>();
  for (const [id, count] of Object.entries(counts)) {
    const list: Annotation[] = [];
    for (let i = 0; i < count; i += 1) {
      list.push({
        id: `anno-${id}-${i}`,
        kind: 'note',
        content: 'body',
        // The bucketer's already routed the annotation to either index;
        // the projector only reads count/presence here. The XOR fields
        // are arbitrary synthetics.
        targetNodeId: id,
        targetEdgeId: null,
        createdBy: '00000000-0000-4000-8000-0000000000ff',
        createdAt: '2026-05-17T00:00:00.000Z',
      });
    }
    out.set(id, list);
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
      target: 'proposal',
      proposal_id: opts.proposalEnvelopeId,
      committed_by: ACTOR,
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
    expect(
      projectGraph(
        [],
        emptyIndex(),
        emptyAxiomIndex(),
        emptyAnnotationIndex(),
        emptyAnnotationIndex(),
        EMPTY_DIAGNOSTIC_HIGHLIGHTS,
        EMPTY_OWN_VOTES,
        EMPTY_OTHERS_VOTES,
      ),
    ).toEqual({ nodes: [], edges: [] });
  });

  it('(b) emits one node descriptor per node-created event with kind: null and rollup "none" when index is empty', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'UBI lifts welfare floor' }),
    ];
    const { nodes, edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
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
    const { edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
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
    const { nodes, edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
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
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
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
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.kind).toBe('normative');
  });

  it('(g) ignores a commit whose proposal id has not been seen', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeCommit({ sequence: 2, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
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
      const { nodes } = projectGraph(
        events,
        emptyIndex(),
        emptyAxiomIndex(),
        emptyAnnotationIndex(),
        emptyAnnotationIndex(),
        EMPTY_DIAGNOSTIC_HIGHLIGHTS,
        EMPTY_OWN_VOTES,
        EMPTY_OTHERS_VOTES,
      );
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
      const { edges } = projectGraph(
        events,
        emptyIndex(),
        emptyAxiomIndex(),
        emptyAnnotationIndex(),
        emptyAnnotationIndex(),
        EMPTY_DIAGNOSTIC_HIGHLIGHTS,
        EMPTY_OWN_VOTES,
        EMPTY_OTHERS_VOTES,
      );
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
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
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
    const { nodes } = projectGraph(
      events,
      index,
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes[0]?.data.facetStatuses).toEqual({ classification: 'proposed' });
  });

  it('(l) threads facetStatuses.substance through onto the emitted node', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const index = indexFromLiterals({
      nodes: { [NODE_A]: { substance: 'agreed' } },
    });
    const { nodes } = projectGraph(
      events,
      index,
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes[0]?.data.facetStatuses).toEqual({ substance: 'agreed' });
  });

  it('(m) threads facetStatuses.wording through onto the emitted node', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const index = indexFromLiterals({
      nodes: { [NODE_A]: { wording: 'disputed' } },
    });
    const { nodes } = projectGraph(
      events,
      index,
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
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
    const { edges } = projectGraph(
      events,
      index,
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(edges[0]?.data.facetStatuses).toEqual({ substance: 'proposed' });
    expect(edges[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(o) rollupStatus reads "proposed" when any facet is proposed', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const index = indexFromLiterals({
      nodes: { [NODE_A]: { classification: 'proposed', substance: 'agreed' } },
    });
    const { nodes } = projectGraph(
      events,
      index,
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(p) rollupStatus reads "agreed" when all facets are agreed', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const index = indexFromLiterals({
      nodes: { [NODE_A]: { classification: 'agreed', substance: 'agreed' } },
    });
    const { nodes } = projectGraph(
      events,
      index,
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes[0]?.data.rollupStatus).toBe('agreed');
  });

  it('(q) rollupStatus reads "none" (sentinel string) when the per-entity record is empty / absent', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    // The index has no entry at all for NODE_A.
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes[0]?.data.rollupStatus).toBe('none');
    // Also when the entry is present but the record is empty.
    const indexEmptyRecord = indexFromLiterals({ nodes: { [NODE_A]: {} } });
    const { nodes: nodes2 } = projectGraph(
      events,
      indexEmptyRecord,
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes2[0]?.data.rollupStatus).toBe('none');
  });

  it('(r) multi-facet node (classification proposed, substance agreed) rolls up to "proposed" per ROLLUP_PRIORITY order', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const index = indexFromLiterals({
      nodes: { [NODE_A]: { classification: 'proposed', substance: 'agreed' } },
    });
    const { nodes } = projectGraph(
      events,
      index,
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
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
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.data.isAxiom).toBe(false);
    expect(nodes[1]?.data.isAxiom).toBe(false);
  });

  it('(t) stamps isAxiom: true on a node the axiom index targets', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const axiomIndex = axiomIndexFromIds([NODE_A]);
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      axiomIndex,
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.isAxiom).toBe(true);
  });

  it('(u) stamps isAxiom: false on the other nodes when only one is targeted', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
    ];
    const axiomIndex = axiomIndexFromIds([NODE_A]);
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      axiomIndex,
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
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
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      axiomIndex,
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
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
    const { edges } = projectGraph(
      events,
      emptyIndex(),
      axiomIndex,
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(edges).toHaveLength(1);
    expect((edges[0]?.data as unknown as Record<string, unknown>).isAxiom).toBeUndefined();
  });
});

describe('projectGraph — annotation stamping (part_annotation_render)', () => {
  it('(aa) stamps hasAnnotation: false + annotationCount: 0 on every node by default (empty annotation indexes)', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
    ];
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.data.hasAnnotation).toBe(false);
    expect(nodes[0]?.data.annotationCount).toBe(0);
    expect(nodes[1]?.data.hasAnnotation).toBe(false);
    expect(nodes[1]?.data.annotationCount).toBe(0);
  });

  it('(bb) stamps hasAnnotation: true + annotationCount: 1 on a node the annotation index targets with one entry', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const nodeAnnotationIndex = annotationIndexFromCounts({ [NODE_A]: 1 });
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      nodeAnnotationIndex,
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.hasAnnotation).toBe(true);
    expect(nodes[0]?.data.annotationCount).toBe(1);
  });

  it('(cc) stamps annotationCount: 3 on a node with three annotations targeting it', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const nodeAnnotationIndex = annotationIndexFromCounts({ [NODE_A]: 3 });
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      nodeAnnotationIndex,
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes[0]?.data.hasAnnotation).toBe(true);
    expect(nodes[0]?.data.annotationCount).toBe(3);
  });

  it('(dd) stamps hasAnnotation + annotationCount on edges symmetrically with nodes', () => {
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
    const edgeAnnotationIndex = annotationIndexFromCounts({ [EDGE_A]: 2 });
    const { edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      edgeAnnotationIndex,
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data.hasAnnotation).toBe(true);
    expect(edges[0]?.data.annotationCount).toBe(2);
  });

  it('(ee) hasAnnotation + annotationCount survive a classify-node commit (spread in the commit branch preserves the fields)', () => {
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
    const nodeAnnotationIndex = annotationIndexFromCounts({ [NODE_A]: 2 });
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      nodeAnnotationIndex,
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(1);
    // Both the classification AND the annotation pair survive.
    expect(nodes[0]?.data.kind).toBe('fact');
    expect(nodes[0]?.data.hasAnnotation).toBe(true);
    expect(nodes[0]?.data.annotationCount).toBe(2);
  });

  it('(ff) sibling nodes / edges not targeted by any annotation get hasAnnotation: false + annotationCount: 0', () => {
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
    // Index targets NODE_A only; NODE_B + EDGE_A are untargeted.
    const nodeAnnotationIndex = annotationIndexFromCounts({ [NODE_A]: 1 });
    const { nodes, edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      nodeAnnotationIndex,
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    const byId = new Map(nodes.map((n) => [n.data.id, n.data]));
    expect(byId.get(NODE_A)?.hasAnnotation).toBe(true);
    expect(byId.get(NODE_A)?.annotationCount).toBe(1);
    expect(byId.get(NODE_B)?.hasAnnotation).toBe(false);
    expect(byId.get(NODE_B)?.annotationCount).toBe(0);
    expect(edges[0]?.data.hasAnnotation).toBe(false);
    expect(edges[0]?.data.annotationCount).toBe(0);
  });
});

// -------------------------------------------------------------------
// Diagnostic-highlight stamping — added by
// `participant_ui.part_graph_view.part_diagnostic_highlights`.
// Refinement: tasks/refinements/participant-ui/part_diagnostic_highlights.md
//
// Six new cases pinning the per-target `diagnosticHighlight` stamping
// on BOTH nodes AND edges (Decision §1 symmetry), with the
// rolled-up severity + deduped kinds list flowing from the
// `DiagnosticHighlightIndex` argument onto each emitted element's
// `data.diagnosticHighlight` slot.
// -------------------------------------------------------------------

/**
 * Build a `DiagnosticHighlightIndex` from literal records. The projector
 * only consults `.nodes.get(id)` / `.edges.get(id)`, so each entry's
 * `severity` + `kinds` shape is what flows through.
 */
function diagnosticIndexFromLiterals(opts: {
  nodes?: Record<
    string,
    { severity: DiagnosticHighlightSeverity; kinds: readonly DiagnosticHighlightKind[] }
  >;
  edges?: Record<
    string,
    { severity: DiagnosticHighlightSeverity; kinds: readonly DiagnosticHighlightKind[] }
  >;
}): DiagnosticHighlightIndex {
  const nodes = new Map<string, DiagnosticHighlight>();
  for (const [id, record] of Object.entries(opts.nodes ?? {})) {
    nodes.set(id, record);
  }
  const edges = new Map<string, DiagnosticHighlight>();
  for (const [id, record] of Object.entries(opts.edges ?? {})) {
    edges.set(id, record);
  }
  return { nodes, edges };
}

describe('projectGraph — diagnostic-highlight stamping (part_diagnostic_highlights)', () => {
  it('(gg) stamps diagnosticHighlight: null on every node + edge by default (empty diagnostic index)', () => {
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
    const { nodes, edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.data.diagnosticHighlight).toBeNull();
    expect(nodes[1]?.data.diagnosticHighlight).toBeNull();
    expect(edges[0]?.data.diagnosticHighlight).toBeNull();
  });

  it('(hh) stamps the right DiagnosticHighlight on a node when the index targets it', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const index = diagnosticIndexFromLiterals({
      nodes: { [NODE_A]: { severity: 'blocking', kinds: ['cycle'] } },
    });
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      index,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.diagnosticHighlight).toEqual({
      severity: 'blocking',
      kinds: ['cycle'],
    });
  });

  it('(ii) stamps the right DiagnosticHighlight on an edge when the index targets it', () => {
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
    const index = diagnosticIndexFromLiterals({
      edges: { [EDGE_A]: { severity: 'blocking', kinds: ['contradiction'] } },
    });
    const { edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      index,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data.diagnosticHighlight).toEqual({
      severity: 'blocking',
      kinds: ['contradiction'],
    });
  });

  it('(jj) per-severity rollup is preserved through the projection (blocking flows through)', () => {
    // The projector reads the already-rolled-up severity from the
    // index; the rollup logic lives in `projectDiagnosticHighlights`
    // (covered by `diagnosticHighlights.test.ts`). This case pins that
    // the stamped value matches the index entry — no silent demotion.
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const index = diagnosticIndexFromLiterals({
      nodes: {
        [NODE_A]: { severity: 'blocking', kinds: ['cycle', 'coherency-hint'] },
      },
    });
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      index,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes[0]?.data.diagnosticHighlight?.severity).toBe('blocking');
  });

  it('(kk) per-kind list is preserved through the projection (encounter order kept)', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const index = diagnosticIndexFromLiterals({
      nodes: {
        [NODE_A]: { severity: 'blocking', kinds: ['cycle', 'multi-warrant'] },
      },
    });
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      index,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes[0]?.data.diagnosticHighlight?.kinds).toEqual(['cycle', 'multi-warrant']);
  });

  it('(ll) diagnosticHighlight survives a classify-node commit (the spread in the commit branch preserves it)', () => {
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
    const index = diagnosticIndexFromLiterals({
      nodes: { [NODE_A]: { severity: 'advisory', kinds: ['dangling-claim'] } },
    });
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      index,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(1);
    // Both the classification AND the diagnostic-highlight pair survive.
    expect(nodes[0]?.data.kind).toBe('fact');
    expect(nodes[0]?.data.diagnosticHighlight).toEqual({
      severity: 'advisory',
      kinds: ['dangling-claim'],
    });
  });
});

// -------------------------------------------------------------------
// Own-vote stamping — added by
// `participant_ui.part_graph_view.part_own_vote_indicators`.
// Refinement: tasks/refinements/participant-ui/part_own_vote_indicators.md
//
// Five new cases pinning the per-target `ownVote` stamping on BOTH
// nodes AND edges (Decision §1 symmetry), the dispute / agree / 'none'
// values flowing from the `OwnVoteIndex` argument onto each emitted
// element's `data.ownVote` slot, and orthogonal composition with the
// per-facet rollup status (Decision §1).
// -------------------------------------------------------------------

/**
 * Build an `OwnVoteIndex` from literal records. The projector only
 * consults `.nodes.get(id)` / `.edges.get(id)`, so each entry's
 * `OwnVote` sentinel flows through verbatim.
 */
function ownVoteIndexFromLiterals(opts: {
  nodes?: Record<string, OwnVote>;
  edges?: Record<string, OwnVote>;
}): OwnVoteIndex {
  const nodes = new Map<string, OwnVote>();
  for (const [id, value] of Object.entries(opts.nodes ?? {})) {
    nodes.set(id, value);
  }
  const edges = new Map<string, OwnVote>();
  for (const [id, value] of Object.entries(opts.edges ?? {})) {
    edges.set(id, value);
  }
  return { nodes, edges };
}

describe('projectGraph — own-vote stamping (part_own_vote_indicators)', () => {
  it('(mm) stamps ownVote: "none" on every node + edge by default (empty own-vote index)', () => {
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
    const { nodes, edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.data.ownVote).toBe('none');
    expect(nodes[1]?.data.ownVote).toBe('none');
    expect(edges[0]?.data.ownVote).toBe('none');
  });

  it('(nn) stamps the right ownVote on a node when the index targets it', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
    ];
    const ownVotes = ownVoteIndexFromLiterals({
      nodes: { [NODE_A]: 'agree', [NODE_B]: 'dispute' },
    });
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      ownVotes,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(2);
    const byId = new Map(nodes.map((n) => [n.data.id, n.data.ownVote]));
    expect(byId.get(NODE_A)).toBe('agree');
    expect(byId.get(NODE_B)).toBe('dispute');
  });

  it('(oo) stamps the right ownVote on an edge when the index targets it', () => {
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
    const ownVotes = ownVoteIndexFromLiterals({
      edges: { [EDGE_A]: 'dispute' },
    });
    const { edges, nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      ownVotes,
      EMPTY_OTHERS_VOTES,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data.ownVote).toBe('dispute');
    // Sibling nodes untouched by the edge-targeted vote stay at the
    // 'none' baseline.
    expect(nodes[0]?.data.ownVote).toBe('none');
    expect(nodes[1]?.data.ownVote).toBe('none');
  });

  it('(pp) ownVote survives a classify-node commit (the spread in the commit branch preserves it)', () => {
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
    const ownVotes = ownVoteIndexFromLiterals({
      nodes: { [NODE_A]: 'agree' },
    });
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      ownVotes,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(1);
    // Both the classification AND the own-vote survive the spread.
    expect(nodes[0]?.data.kind).toBe('fact');
    expect(nodes[0]?.data.ownVote).toBe('agree');
  });

  it('(qq) ownVote: "dispute" composes orthogonally with rollupStatus: "agreed" (per-participant ≠ per-facet rollup)', () => {
    // Sanity check that the per-(local-participant, target) field
    // doesn't interfere with the per-facet aggregate-rollup status: a
    // participant can individually dispute on a facet that the
    // aggregate has rolled up to 'agreed' (other participants tipped
    // the aggregate while this participant remains the holdout).
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const facetIndex = indexFromLiterals({
      nodes: { [NODE_A]: { classification: 'agreed' } },
    });
    const ownVotes = ownVoteIndexFromLiterals({ nodes: { [NODE_A]: 'dispute' } });
    const { nodes } = projectGraph(
      events,
      facetIndex,
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      ownVotes,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.rollupStatus).toBe('agreed');
    expect(nodes[0]?.data.ownVote).toBe('dispute');
  });
});

// -------------------------------------------------------------------
// Other-vote stamping — added by
// `participant_ui.part_graph_view.part_other_vote_indicators`.
// Refinement: tasks/refinements/participant-ui/part_other_vote_indicators.md
//
// Five new cases pinning the per-target `otherVotes: readonly OtherVote[]`
// field (Decision §1 — symmetric across node + edge target kinds) and
// the shared `EMPTY_OTHER_VOTES_LIST` reference for the per-entity
// no-other-votes default.
// -------------------------------------------------------------------

/**
 * Build an `OthersVoteIndex` from literal records. The projector only
 * consults `.nodes.get(id)` / `.edges.get(id)`, so each entry's
 * `OtherVote[]` list flows through verbatim. Built fresh per call so
 * the Maps are never shared across tests.
 */
function othersVoteIndexFromLiterals(opts: {
  nodes?: Record<string, readonly OtherVote[]>;
  edges?: Record<string, readonly OtherVote[]>;
}): OthersVoteIndex {
  const nodes = new Map<string, readonly OtherVote[]>();
  for (const [id, value] of Object.entries(opts.nodes ?? {})) {
    nodes.set(id, value);
  }
  const edges = new Map<string, readonly OtherVote[]>();
  for (const [id, value] of Object.entries(opts.edges ?? {})) {
    edges.set(id, value);
  }
  return { nodes, edges };
}

describe('projectGraph — other-vote stamping (part_other_vote_indicators)', () => {
  const VOTER_X = '00000000-0000-4000-8000-0000000000bb';
  const VOTER_Y = '00000000-0000-4000-8000-0000000000cc';

  it('(tt) stamps the shared EMPTY_OTHER_VOTES_LIST reference on every node + edge by default (empty other-votes index)', () => {
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
    const { nodes, edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(2);
    // The shared frozen reference (NOT a fresh `[]`) — memoization
    // stability across re-projection passes per the `EMPTY_*` posture.
    expect(nodes[0]?.data.otherVotes).toBe(EMPTY_OTHER_VOTES_LIST);
    expect(nodes[1]?.data.otherVotes).toBe(EMPTY_OTHER_VOTES_LIST);
    expect(edges[0]?.data.otherVotes).toBe(EMPTY_OTHER_VOTES_LIST);
  });

  it('(uu) stamps the right otherVotes list on a node when the index targets it', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
    ];
    const othersVotes = othersVoteIndexFromLiterals({
      nodes: {
        [NODE_A]: [
          { participantId: VOTER_X, choice: 'agree' },
          { participantId: VOTER_Y, choice: 'dispute' },
        ],
      },
    });
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      othersVotes,
    );
    expect(nodes).toHaveLength(2);
    const byId = new Map(nodes.map((n) => [n.data.id, n.data.otherVotes]));
    expect(byId.get(NODE_A)).toEqual([
      { participantId: VOTER_X, choice: 'agree' },
      { participantId: VOTER_Y, choice: 'dispute' },
    ]);
    // The untargeted node falls back to the shared empty-list ref.
    expect(byId.get(NODE_B)).toBe(EMPTY_OTHER_VOTES_LIST);
  });

  it('(vv) stamps the right otherVotes list on an edge when the index targets it', () => {
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
    const othersVotes = othersVoteIndexFromLiterals({
      edges: {
        [EDGE_A]: [{ participantId: VOTER_X, choice: 'dispute' }],
      },
    });
    const { edges, nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      othersVotes,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data.otherVotes).toEqual([{ participantId: VOTER_X, choice: 'dispute' }]);
    // Sibling nodes untouched by the edge-targeted index stay at the
    // empty-list baseline.
    expect(nodes[0]?.data.otherVotes).toBe(EMPTY_OTHER_VOTES_LIST);
    expect(nodes[1]?.data.otherVotes).toBe(EMPTY_OTHER_VOTES_LIST);
  });

  it('(ww) otherVotes survives a classify-node commit (the spread in the commit branch preserves it)', () => {
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
    const othersVotes = othersVoteIndexFromLiterals({
      nodes: {
        [NODE_A]: [{ participantId: VOTER_X, choice: 'agree' }],
      },
    });
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      othersVotes,
    );
    expect(nodes).toHaveLength(1);
    // Both the classification AND the other-votes survive the spread
    // in the commit branch.
    expect(nodes[0]?.data.kind).toBe('fact');
    expect(nodes[0]?.data.otherVotes).toEqual([{ participantId: VOTER_X, choice: 'agree' }]);
  });

  it('(xx) otherVotes composes orthogonally with the per-self ownVote (current participant agrees; an other participant disputes)', () => {
    // Sanity check that the per-(other-voter, target) list and the
    // per-(local-participant, target) sentinel coexist on the same
    // node `data` object without interfering. The participant
    // (`ownVote: 'agree'`) and one other voter (`otherVotes:
    // [{ ..., 'dispute' }]`) are independent fields.
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const ownVotes = ownVoteIndexFromLiterals({ nodes: { [NODE_A]: 'agree' } });
    const othersVotes = othersVoteIndexFromLiterals({
      nodes: {
        [NODE_A]: [{ participantId: VOTER_X, choice: 'dispute' }],
      },
    });
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      ownVotes,
      othersVotes,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.ownVote).toBe('agree');
    expect(nodes[0]?.data.otherVotes).toEqual([{ participantId: VOTER_X, choice: 'dispute' }]);
  });
});

// Per-node sizing stamping (part_layout_measured_dimensions). The
// projector calls `computeNodeDimensions(wording)` per `node-created`
// event and spreads `width` / `height` / `textMaxWidth` onto the
// emitted descriptor. Edges carry no per-edge sizing (Cytoscape edges
// are line segments). The cases below pin the cross-projection
// invariants — they do not re-assert the dimension function's clamp
// behaviour (that's `nodeDimensions.test.ts`'s job).
import {
  MAX_NODE_HEIGHT as DIMS_MAX_NODE_HEIGHT,
  MAX_NODE_WIDTH as DIMS_MAX_NODE_WIDTH,
  MIN_NODE_HEIGHT as DIMS_MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH as DIMS_MIN_NODE_WIDTH,
} from './nodeDimensions';
import { installCytoscapeTestEnv } from './cytoscapeTestEnv';

describe('projectGraph — per-node sizing stamping (part_layout_measured_dimensions)', () => {
  // The Cytoscape test env shim widens `measureText` to be content-
  // sensitive (~7 px per character); the projector reads it indirectly
  // through `computeNodeDimensions`. Install it for this suite so the
  // dimensions reflect the wording's actual length.
  let envHandle: ReturnType<typeof installCytoscapeTestEnv> | null = null;
  beforeAll(() => {
    envHandle = installCytoscapeTestEnv();
  });
  afterAll(() => {
    envHandle?.restore();
    envHandle = null;
  });

  it('(layout-a) short wording emits min-width-band data.width and min-height data.height', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'Yes' })];
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.width).toBeLessThan(DIMS_MAX_NODE_WIDTH);
    expect(nodes[0]?.data.width).toBeGreaterThanOrEqual(DIMS_MIN_NODE_WIDTH);
    expect(nodes[0]?.data.height).toBe(DIMS_MIN_NODE_HEIGHT);
  });

  it('(layout-b) long wording emits max-width data.width and grown data.height', () => {
    const long =
      'the participant should see this wording wrap across several lines as the rendered card grows to fit its content without clipping or overflowing the rounded rectangle box that cytoscape draws on the canvas';
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: long })];
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.width).toBe(DIMS_MAX_NODE_WIDTH);
    expect(nodes[0]?.data.height).toBeGreaterThan(DIMS_MIN_NODE_HEIGHT);
    expect(nodes[0]?.data.height).toBeLessThanOrEqual(DIMS_MAX_NODE_HEIGHT);
  });

  it('(layout-c) textMaxWidth always equals width - 24 (2 * default padding)', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'Yes' }),
      makeNodeCreated({
        sequence: 2,
        nodeId: NODE_B,
        wording: 'A statement of moderate width',
      }),
    ];
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    for (const node of nodes) {
      expect(node.data.textMaxWidth).toBe(node.data.width - 24);
    }
  });
});

describe('projectGraph — isFlashing stamping (part_proposal_notification)', () => {
  it('(flash-a) defaults every emitted node + edge to isFlashing: false when no flashIndex is supplied', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
    ];
    const { nodes, edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    for (const node of nodes) expect(node.data.isFlashing).toBe(false);
    for (const edge of edges) expect(edge.data.isFlashing).toBe(false);
  });

  it('(flash-b) stamps isFlashing: true on the node whose id is in flashIndex', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
    ];
    const flashIndex = new Map<string, true>([[NODE_A, true]]);
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
      flashIndex,
    );
    const a = nodes.find((n) => n.data.id === NODE_A);
    const b = nodes.find((n) => n.data.id === NODE_B);
    expect(a?.data.isFlashing).toBe(true);
    expect(b?.data.isFlashing).toBe(false);
  });

  it('(flash-c) stamps isFlashing: true on the edge whose id is in flashIndex', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
    ];
    const flashIndex = new Map<string, true>([[EDGE_A, true]]);
    const { nodes, edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
      flashIndex,
    );
    for (const node of nodes) expect(node.data.isFlashing).toBe(false);
    expect(edges[0]?.data.isFlashing).toBe(true);
  });

  it('(flash-d) survives a classify-node commit (kind flips but isFlashing carries through)', () => {
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
    const flashIndex = new Map<string, true>([[NODE_A, true]]);
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
      flashIndex,
    );
    expect(nodes[0]?.data.kind).toBe('fact');
    expect(nodes[0]?.data.isFlashing).toBe(true);
  });
});

// -------------------------------------------------------------------
// Annotation-endpoint edge rendering — added by
// `participant_ui.part_graph_view.part_render_annotation_endpoint_edges`.
// Refinement: tasks/refinements/participant-ui/part_render_annotation_endpoint_edges.md
//
// Cases A–H pin the conditional materialization rule (Decision §1),
// the three round-trip endpoint shapes, the malformed-log skip
// (Decision §2), the sentinel-default posture for statement-only
// fields on annotation nodes (Decision §3), the `nodeKind` /
// `annotationKind` discriminator surfaces, and the deterministic emit
// order (annotation graph-nodes appear at the end of `nodes` in
// `annotation-created` arrival order filtered by referenced-set
// membership).
// -------------------------------------------------------------------

const ANNOTATION_X = '00000000-0000-4000-8000-000000000a01';
const ANNOTATION_Y = '00000000-0000-4000-8000-000000000a02';
const ANNOTATION_Z = '00000000-0000-4000-8000-000000000a03';

function makeAnnotationCreated(opts: {
  sequence: number;
  annotationId: string;
  kind: AnnotationKind;
  content?: string;
  targetNodeId?: string | null;
  targetEdgeId?: string | null;
}): Event {
  // The wire schema's XOR `.refine()` requires exactly one of
  // `target_node_id` / `target_edge_id` to be non-null. Default the
  // unspecified arm to `null` so callers only pin the side they care
  // about — for the annotation-endpoint cases the target is usually
  // irrelevant (the edge does the binding).
  const targetNodeId = opts.targetNodeId ?? null;
  const targetEdgeId =
    opts.targetEdgeId ?? (targetNodeId === null ? '00000000-0000-4000-8000-000000000abc' : null);
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
      target_node_id: targetNodeId,
      target_edge_id: targetEdgeId,
      created_by: ACTOR,
      created_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function makeEdgeCreatedWithAnnotationEndpoint(opts: {
  sequence: number;
  edgeId: string;
  source: { kind: 'node' | 'annotation'; id: string };
  target: { kind: 'node' | 'annotation'; id: string };
  role?: EdgeRole;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x600 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'edge-created',
    actor: ACTOR,
    payload: {
      edge_id: opts.edgeId,
      role: opts.role ?? 'contradicts',
      ...(opts.source.kind === 'node'
        ? { source_node_id: opts.source.id }
        : { source_annotation_id: opts.source.id }),
      ...(opts.target.kind === 'node'
        ? { target_node_id: opts.target.id }
        : { target_annotation_id: opts.target.id }),
      created_by: ACTOR,
      created_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

describe('projectGraph — annotation-endpoint rendering (part_render_annotation_endpoint_edges)', () => {
  it('(ann-A) round-trips node→annotation endpoints — emits the statement node, the annotation graph-node, and one edge', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNOTATION_X,
        kind: 'note',
        content: 'commentary on A',
      }),
      makeEdgeCreatedWithAnnotationEndpoint({
        sequence: 3,
        edgeId: EDGE_A,
        source: { kind: 'node', id: NODE_A },
        target: { kind: 'annotation', id: ANNOTATION_X },
      }),
    ];
    const { nodes, edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(2);
    const byId = new Map(nodes.map((n) => [n.data.id, n.data]));
    expect(byId.get(NODE_A)?.nodeKind).toBe('statement');
    expect(byId.get(ANNOTATION_X)?.nodeKind).toBe('annotation');
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data.source).toBe(NODE_A);
    expect(edges[0]?.data.target).toBe(ANNOTATION_X);
  });

  it('(ann-B) round-trips annotation→node endpoints — symmetric with case A', () => {
    const events: Event[] = [
      makeAnnotationCreated({
        sequence: 1,
        annotationId: ANNOTATION_X,
        kind: 'reframe',
      }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_A, wording: 'A' }),
      makeEdgeCreatedWithAnnotationEndpoint({
        sequence: 3,
        edgeId: EDGE_A,
        source: { kind: 'annotation', id: ANNOTATION_X },
        target: { kind: 'node', id: NODE_A },
      }),
    ];
    const { nodes, edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data.source).toBe(ANNOTATION_X);
    expect(edges[0]?.data.target).toBe(NODE_A);
  });

  it('(ann-C) round-trips annotation→annotation endpoints — emits both annotations as graph-nodes plus the edge', () => {
    const events: Event[] = [
      makeAnnotationCreated({
        sequence: 1,
        annotationId: ANNOTATION_X,
        kind: 'note',
      }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNOTATION_Y,
        kind: 'stance',
      }),
      makeEdgeCreatedWithAnnotationEndpoint({
        sequence: 3,
        edgeId: EDGE_A,
        source: { kind: 'annotation', id: ANNOTATION_X },
        target: { kind: 'annotation', id: ANNOTATION_Y },
      }),
    ];
    const { nodes, edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.data.nodeKind === 'annotation')).toBe(true);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data.source).toBe(ANNOTATION_X);
    expect(edges[0]?.data.target).toBe(ANNOTATION_Y);
  });

  it('(ann-D) overlay-only annotations (not referenced as edge endpoints) do NOT materialize as graph-nodes', () => {
    // An `annotation-created` with no `edge-created` referencing it stays
    // an overlay on its target node/edge (existing
    // `part_annotation_render` contract). Per Decision §1 only referenced
    // annotations materialize.
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNOTATION_X,
        kind: 'note',
        targetNodeId: NODE_A,
      }),
    ];
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.id).toBe(NODE_A);
    expect(nodes[0]?.data.nodeKind).toBe('statement');
  });

  it('(ann-E) an edge referencing an unknown annotation id (no preceding annotation-created) is skipped — no edge emitted, no throw', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeEdgeCreatedWithAnnotationEndpoint({
        sequence: 2,
        edgeId: EDGE_A,
        source: { kind: 'node', id: NODE_A },
        target: { kind: 'annotation', id: ANNOTATION_X },
      }),
    ];
    const { nodes, edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.id).toBe(NODE_A);
    expect(edges).toHaveLength(0);
  });

  it('(ann-F) annotation graph-nodes carry sentinel defaults for the statement-only fields', () => {
    const events: Event[] = [
      makeAnnotationCreated({
        sequence: 1,
        annotationId: ANNOTATION_X,
        kind: 'note',
      }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_A, wording: 'A' }),
      makeEdgeCreatedWithAnnotationEndpoint({
        sequence: 3,
        edgeId: EDGE_A,
        source: { kind: 'node', id: NODE_A },
        target: { kind: 'annotation', id: ANNOTATION_X },
      }),
    ];
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    const annotation = nodes.find((n) => n.data.id === ANNOTATION_X);
    expect(annotation?.data.kind).toBeNull();
    expect(annotation?.data.facetStatuses).toEqual({});
    expect(annotation?.data.rollupStatus).toBe('none');
    expect(annotation?.data.isAxiom).toBe(false);
    expect(annotation?.data.ownVote).toBe('none');
    expect(annotation?.data.otherVotes).toBe(EMPTY_OTHER_VOTES_LIST);
    expect(annotation?.data.diagnosticHighlight).toBeNull();
  });

  it('(ann-G) annotation graph-nodes carry nodeKind: "annotation", annotationKind matching the wire kind, wording from the content, and the annotation id as data.id', () => {
    const events: Event[] = [
      makeAnnotationCreated({
        sequence: 1,
        annotationId: ANNOTATION_X,
        kind: 'reframe',
        content: 'reframe text',
      }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_A, wording: 'A' }),
      makeEdgeCreatedWithAnnotationEndpoint({
        sequence: 3,
        edgeId: EDGE_A,
        source: { kind: 'node', id: NODE_A },
        target: { kind: 'annotation', id: ANNOTATION_X },
      }),
    ];
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    const annotation = nodes.find((n) => n.data.id === ANNOTATION_X);
    expect(annotation).toBeDefined();
    expect(annotation?.data.nodeKind).toBe('annotation');
    expect(annotation?.data.annotationKind).toBe('reframe');
    expect(annotation?.data.wording).toBe('reframe text');
  });

  it('(ann-H) annotation graph-nodes emit at the end of the nodes array in annotation-created arrival order filtered by referenced-set membership', () => {
    // Z is created first but only Y and X get referenced as endpoints
    // (in that order via two edges). The statement node N appears in
    // `nodes` first; then the annotation graph-nodes appear in their
    // `annotation-created` arrival order — Y then X — filtered by the
    // referenced set (Z is excluded). The unreferenced annotation Z
    // stays an overlay, not a graph-node.
    const EDGE_B = '00000000-0000-4000-8000-00000000000f';
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAnnotationCreated({ sequence: 2, annotationId: ANNOTATION_Y, kind: 'note' }),
      makeAnnotationCreated({ sequence: 3, annotationId: ANNOTATION_X, kind: 'stance' }),
      makeAnnotationCreated({
        sequence: 4,
        annotationId: ANNOTATION_Z,
        kind: 'reframe',
        targetNodeId: NODE_A,
      }),
      makeEdgeCreatedWithAnnotationEndpoint({
        sequence: 5,
        edgeId: EDGE_A,
        source: { kind: 'node', id: NODE_A },
        target: { kind: 'annotation', id: ANNOTATION_Y },
      }),
      makeEdgeCreatedWithAnnotationEndpoint({
        sequence: 6,
        edgeId: EDGE_B,
        source: { kind: 'node', id: NODE_A },
        target: { kind: 'annotation', id: ANNOTATION_X },
      }),
    ];
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes.map((n) => n.data.id)).toEqual([NODE_A, ANNOTATION_Y, ANNOTATION_X]);
  });
});

// -------------------------------------------------------------------
// Annotation-of-annotation overlay propagation — added by
// `participant_ui.part_graph_view.part_annotation_of_annotation_overlay_chain`.
// Refinement: tasks/refinements/participant-ui/part_annotation_of_annotation_overlay_chain.md
//
// Cases ann-oa-1..3 pin the polymorphic-entity-id propagation through
// the shell-level `groupAnnotationsByEntityId` bucketer: when an
// `annotation-created` event carries another annotation's id in its
// `target_node_id` slot, the bucketer keys the source annotation under
// the target annotation's id, and `projectGraph`'s annotation graph-node
// materialization pass at L693-720 surfaces `hasAnnotation: true` +
// `annotationCount: N` on the target's emitted node via the existing
// `nodeHasAnnotation` / `annotationCountFor` lookup.
// -------------------------------------------------------------------

describe('projectGraph — annotation-of-annotation overlay propagation (part_annotation_of_annotation_overlay_chain)', () => {
  it("(ann-oa-1) an annotation A2 whose target_node_id carries A1's id surfaces hasAnnotation: true + annotationCount: 1 on A1's materialized graph-node", () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNOTATION_X,
        kind: 'note',
        targetNodeId: NODE_A,
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: ANNOTATION_Y,
        kind: 'reframe',
        targetNodeId: ANNOTATION_X,
      }),
      makeEdgeCreatedWithAnnotationEndpoint({
        sequence: 4,
        edgeId: EDGE_A,
        source: { kind: 'node', id: NODE_A },
        target: { kind: 'annotation', id: ANNOTATION_X },
      }),
    ];
    const nodeAnnotationIndex = groupAnnotationsByEntityId(projectAnnotations(events));
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      nodeAnnotationIndex,
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    const annotationNode = nodes.find((n) => n.data.id === ANNOTATION_X);
    expect(annotationNode).toBeDefined();
    expect(annotationNode?.data.hasAnnotation).toBe(true);
    expect(annotationNode?.data.annotationCount).toBe(1);
    // The statement node N1 also keeps its existing overlay (A1 targets N1).
    const statementNode = nodes.find((n) => n.data.id === NODE_A);
    expect(statementNode?.data.hasAnnotation).toBe(true);
    expect(statementNode?.data.annotationCount).toBe(1);
  });

  it('(ann-oa-2) multiple annotations targeting the same materialized annotation graph-node aggregate the count', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNOTATION_X,
        kind: 'note',
        targetNodeId: NODE_A,
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: ANNOTATION_Y,
        kind: 'reframe',
        targetNodeId: ANNOTATION_X,
      }),
      makeAnnotationCreated({
        sequence: 4,
        annotationId: ANNOTATION_Z,
        kind: 'stance',
        targetNodeId: ANNOTATION_X,
      }),
      makeEdgeCreatedWithAnnotationEndpoint({
        sequence: 5,
        edgeId: EDGE_A,
        source: { kind: 'node', id: NODE_A },
        target: { kind: 'annotation', id: ANNOTATION_X },
      }),
    ];
    const nodeAnnotationIndex = groupAnnotationsByEntityId(projectAnnotations(events));
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      nodeAnnotationIndex,
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    const annotationNode = nodes.find((n) => n.data.id === ANNOTATION_X);
    expect(annotationNode?.data.hasAnnotation).toBe(true);
    expect(annotationNode?.data.annotationCount).toBe(2);
  });

  it('(ann-oa-3) annotation-on-annotation where the target annotation is NOT materialized surfaces nowhere — N1 keeps its existing overlay, A1 and A2 are NOT emitted as graph-nodes', () => {
    // No `edge-created` references A1 — per the predecessor's conditional-
    // materialization rule (Decision §1 of
    // `part_render_annotation_endpoint_edges`) A1 stays an overlay on N1
    // and is NOT emitted as a graph-node. A2 targets A1 (which is itself
    // not materialized) — the orphan A2 surfaces nowhere visually.
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNOTATION_X,
        kind: 'note',
        targetNodeId: NODE_A,
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: ANNOTATION_Y,
        kind: 'reframe',
        targetNodeId: ANNOTATION_X,
      }),
    ];
    const nodeAnnotationIndex = groupAnnotationsByEntityId(projectAnnotations(events));
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      nodeAnnotationIndex,
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.id).toBe(NODE_A);
    expect(nodes[0]?.data.hasAnnotation).toBe(true);
    expect(nodes[0]?.data.annotationCount).toBe(1);
    // A1 and A2 are NOT emitted as graph-nodes.
    expect(nodes.find((n) => n.data.id === ANNOTATION_X)).toBeUndefined();
    expect(nodes.find((n) => n.data.id === ANNOTATION_Y)).toBeUndefined();
  });
});

// `part_withdraw_proposal_gesture` §A3 — projector honours `entity-removed`
// (a withdraw). A node / edge named by a later `entity-removed` is dropped
// from the projected graph; entities never retracted are unaffected. The
// original `*-created` event stays in the immutable log (ADR 0021); the
// retraction can only be honoured here, at projection time.
describe('projectGraph — entity-removed (withdraw) cleanup', () => {
  function makeEntityRemoved(opts: {
    sequence: number;
    entityKind: 'node' | 'edge' | 'annotation';
    entityId: string;
  }): Event {
    return {
      id: `00000000-0000-4000-8000-${(0x700 + opts.sequence).toString(16).padStart(12, '0')}`,
      sessionId: SESSION_ID,
      sequence: opts.sequence,
      kind: 'entity-removed',
      actor: ACTOR,
      payload: {
        entity_kind: opts.entityKind,
        entity_id: opts.entityId,
        removed_by: ACTOR,
        removed_at: '2026-05-17T00:00:00.000Z',
      },
      createdAt: '2026-05-17T00:00:00.000Z',
    };
  }

  it('drops a node retracted by a later entity-removed(node); a sibling node survives', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'kept' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'withdrawn' }),
      makeEntityRemoved({ sequence: 3, entityKind: 'node', entityId: NODE_B }),
    ];
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes.map((n) => n.data.id)).toEqual([NODE_A]);
  });

  it('drops an edge retracted by a later entity-removed(edge); its endpoint nodes survive', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
      makeEntityRemoved({ sequence: 4, entityKind: 'edge', entityId: EDGE_A }),
    ];
    const { nodes, edges } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(edges).toEqual([]);
    // The edge is dropped but its endpoint nodes are never over-retracted
    // (match keys solely on the edge id, never on endpoint ids).
    expect(nodes.map((n) => n.data.id).sort()).toEqual([NODE_A, NODE_B].sort());
  });

  it('leaves a node untouched when an unrelated entity-removed names a different id', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'kept' }),
      makeEntityRemoved({ sequence: 2, entityKind: 'node', entityId: NODE_B }),
    ];
    const { nodes } = projectGraph(
      events,
      emptyIndex(),
      emptyAxiomIndex(),
      emptyAnnotationIndex(),
      emptyAnnotationIndex(),
      EMPTY_DIAGNOSTIC_HIGHLIGHTS,
      EMPTY_OWN_VOTES,
      EMPTY_OTHERS_VOTES,
    );
    expect(nodes.map((n) => n.data.id)).toEqual([NODE_A]);
  });
});
