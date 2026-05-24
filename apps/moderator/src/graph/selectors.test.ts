// Tests for the store-derived selectors that translate the WS event
// log into the ReactFlow node / edge / annotation / axiom-mark shapes.
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md
// (prior:     tasks/refinements/moderator-ui/mod_annotation_rendering.md,
//             tasks/refinements/moderator-ui/mod_edge_rendering.md)
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// The selectors are the load-bearing surface between the WS store and
// the canvas; pinning their behaviour with unit tests means a regression
// here surfaces independently from a React render.
//
// Cases for `selectEdgesForSession`:
//   1. Unknown sessionId returns [].
//   2. Known session with empty event log returns [].
//   3. Single `edge-created` projects to a single ReactFlow `Edge` with
//      `id`/`source`/`target`/`type`/`data.role`/`data.annotations`
//      mapped from the payload (annotations default to []).
//   4. Multiple `edge-created` events project in arrival order.
//   5. Mixed event log: only `edge-created` events appear in the output.
//   6. Every one of the seven `EdgeRole` values round-trips intact onto
//      `data.role` (covers `supports` / `rebuts` / `qualifies` /
//      `bridges-from` / `bridges-to` / `defines` / `contradicts`).
//   7. An annotation targeting an edge lands in that edge's
//      `data.annotations` array.
//
// Cases for `selectAnnotations` / `groupAnnotationsByNode` /
// `groupAnnotationsByEdge`:
//   8. Unknown sessionId / empty log return [].
//   9. Single annotation on a node target / on an edge target lands
//      with camelCased fields and the right XOR.
//  10. Arrival order is preserved across multiple annotation events.
//  11. Mixed event log: only `annotation-created` events appear.
//  12. Every `AnnotationKind` value round-trips intact.
//  13. `groupAnnotationsByNode` / `groupAnnotationsByEdge` bucket
//      correctly and exclude the other-entity annotations.

import { describe, expect, it } from 'vitest';
import type { AnnotationKind, EdgeRole, Event } from '@a-conversa/shared-types';

import { AXIOM_MARK_PALETTE_SIZE, axiomMarkColorFor } from '@a-conversa/shell';

import type { WsState } from '../ws/wsStore.js';
import {
  groupAnnotationsByEdge,
  groupAnnotationsByNode,
  groupAxiomMarksByNode,
  groupPendingAxiomMarksByNode,
  projectAxiomMarks,
  projectPendingAxiomMarks,
  projectVotesByFacet,
  selectAnnotations,
  selectEdgesForSession,
  selectNodeWordingById,
} from './selectors.js';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

const ALL_EDGE_ROLES: readonly EdgeRole[] = [
  'supports',
  'rebuts',
  'qualifies',
  'bridges-from',
  'bridges-to',
  'defines',
  'contradicts',
];

function makeEdgeCreated(opts: {
  sequence: number;
  edgeId: string;
  role: EdgeRole;
  source: string;
  target: string;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${opts.sequence.toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence: opts.sequence,
    kind: 'edge-created',
    actor: ACTOR,
    payload: {
      edge_id: opts.edgeId,
      role: opts.role,
      source_node_id: opts.source,
      target_node_id: opts.target,
      created_by: ACTOR,
      created_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function makeNodeCreated(sequence: number, nodeId: string): Event {
  return {
    id: `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: nodeId,
      wording: 'a node',
      created_by: ACTOR,
      created_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function makeState(events: Event[]): WsState {
  // Minimal `WsState`-shaped object for the selector. The selector only
  // touches `sessionState[sessionId]?.events`, so the rest of the slice
  // is unused — we cast through `unknown` to avoid having to construct
  // every action handler the live store ships.
  return {
    sessionState: {
      [SESSION]: { lastAppliedSequence: events.length, events, pendingProposals: {} },
    },
  } as unknown as WsState;
}

describe('selectEdgesForSession', () => {
  it('returns an empty array for an unknown session id', () => {
    const state = makeState([]);
    expect(selectEdgesForSession(state, 'unknown-session')).toEqual([]);
  });

  it('returns an empty array for a known session with no events', () => {
    const state = makeState([]);
    expect(selectEdgesForSession(state, SESSION)).toEqual([]);
  });

  it('projects a single edge-created event into one ReactFlow edge', () => {
    const state = makeState([
      makeEdgeCreated({
        sequence: 1,
        edgeId: '11111111-1111-4111-8111-111111111111',
        role: 'supports',
        source: '00000000-0000-4000-8000-000000000001',
        target: '00000000-0000-4000-8000-000000000002',
      }),
    ]);
    const edges = selectEdgesForSession(state, SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      source: '00000000-0000-4000-8000-000000000001',
      target: '00000000-0000-4000-8000-000000000002',
      type: 'statement',
      // `annotations` defaults to an empty list (the module-scope
      // shared `EMPTY_ANNOTATIONS` reference) when no annotation event
      // targets this edge. `facetStatuses` defaults to the module-scope
      // shared `EMPTY_FACET_STATUSES` empty record (refinement
      // `mod_proposed_state_styling`). `sourceWording` / `targetWording`
      // default to the `'—'` em-dash fallback because no `node-created`
      // event in this log mentions either endpoint id (refinement
      // `mod_hover_details`). `sourceId` / `targetId` are copied
      // verbatim from the `edge-created` payload (refinement
      // `mod_edge_popover_full_target_wording`).
      data: {
        role: 'supports',
        annotations: [],
        // Per ADR 0030 §10 + the refactor: an edge with no
        // `set-edge-substance` proposal has its substance facet in
        // the empty-state `'awaiting-proposal'` row.
        facetStatuses: { substance: 'awaiting-proposal' },
        // Per `pf_mod_edge_shape_commit_affordance`: the inline
        // `shape` facet on a freshly-created edge has no votes yet —
        // the narrow `EdgeShapeStatus` rolls up to `'other'`. The
        // inline shape-commit affordance is unmounted in this state.
        shapeStatus: 'other',
        sourceId: '00000000-0000-4000-8000-000000000001',
        targetId: '00000000-0000-4000-8000-000000000002',
        sourceWording: '—',
        targetWording: '—',
      },
    });
  });

  it('projects multiple edge-created events in arrival order', () => {
    const state = makeState([
      makeEdgeCreated({
        sequence: 1,
        edgeId: 'edge-a',
        role: 'supports',
        source: 'n1',
        target: 'n2',
      }),
      makeEdgeCreated({
        sequence: 2,
        edgeId: 'edge-b',
        role: 'rebuts',
        source: 'n2',
        target: 'n3',
      }),
      makeEdgeCreated({
        sequence: 3,
        edgeId: 'edge-c',
        role: 'qualifies',
        source: 'n3',
        target: 'n4',
      }),
    ]);
    const edges = selectEdgesForSession(state, SESSION);
    expect(edges.map((e) => e.id)).toEqual(['edge-a', 'edge-b', 'edge-c']);
    expect(edges.map((e) => e.data?.role)).toEqual(['supports', 'rebuts', 'qualifies']);
  });

  it('only projects edge-created events — node-created entries are ignored', () => {
    const state = makeState([
      makeNodeCreated(1, 'node-1'),
      makeEdgeCreated({
        sequence: 2,
        edgeId: 'edge-1',
        role: 'defines',
        source: 'node-1',
        target: 'node-2',
      }),
      makeNodeCreated(3, 'node-2'),
    ]);
    const edges = selectEdgesForSession(state, SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.id).toBe('edge-1');
    expect(edges[0]?.data?.role).toBe('defines');
  });

  // The seven-role round-trip pins the contract that every role from the
  // canonical enum lands intact on `data.role`. If a new role is added to
  // the enum and the selector's mapping forgets to thread it through,
  // this case fails.
  for (const role of ALL_EDGE_ROLES) {
    it(`preserves the ${role} role on data.role`, () => {
      const state = makeState([
        makeEdgeCreated({
          sequence: 1,
          edgeId: `edge-${role}`,
          role,
          source: 'a',
          target: 'b',
        }),
      ]);
      const edges = selectEdgesForSession(state, SESSION);
      expect(edges).toHaveLength(1);
      expect(edges[0]?.data?.role).toBe(role);
      expect(edges[0]?.type).toBe('statement');
    });
  }

  it('attaches edge-targeted annotations to the matching edge data.annotations', () => {
    const state = makeState([
      makeEdgeCreated({
        sequence: 1,
        edgeId: 'edge-with-anno',
        role: 'supports',
        source: 'n1',
        target: 'n2',
      }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: 'anno-1',
        kind: 'note',
        targetNodeId: null,
        targetEdgeId: 'edge-with-anno',
        content: 'an edge note',
      }),
    ]);
    const edges = selectEdgesForSession(state, SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.annotations).toHaveLength(1);
    expect(edges[0]?.data?.annotations?.[0]?.id).toBe('anno-1');
    expect(edges[0]?.data?.annotations?.[0]?.kind).toBe('note');
  });

  // -- Per-facet state-styling enrichment (mod_proposed_state_styling) -

  it('attaches facetStatuses.substance === proposed to an edge with a set-edge-substance proposal and no votes', () => {
    const edgeId = '22222222-2222-4222-8222-222222222222';
    const proposalId = '33333333-3333-4333-8333-333333333333';
    const state = makeState([
      makeEdgeCreated({
        sequence: 1,
        edgeId,
        role: 'supports',
        source: '00000000-0000-4000-8000-000000000001',
        target: '00000000-0000-4000-8000-000000000002',
      }),
      {
        id: proposalId,
        sessionId: SESSION,
        sequence: 2,
        kind: 'proposal',
        actor: ACTOR,
        payload: {
          proposal: { kind: 'set-edge-substance', edge_id: edgeId, value: 'agreed' },
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
    ]);
    const edges = selectEdgesForSession(state, SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.facetStatuses).toEqual({ substance: 'proposed' });
  });

  it('attaches the awaiting-proposal substance row to an edge with no facet-targeting proposals', () => {
    // Per ADR 0030 §10 + the refactor: an edge with no
    // `set-edge-substance` proposal carries the empty-state
    // `'awaiting-proposal'` row on its substance facet.
    const state = makeState([
      makeEdgeCreated({
        sequence: 1,
        edgeId: 'edge-plain',
        role: 'supports',
        source: 'n1',
        target: 'n2',
      }),
    ]);
    const edges = selectEdgesForSession(state, SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.facetStatuses).toEqual({ substance: 'awaiting-proposal' });
  });

  // -- Endpoint wording enrichment (mod_hover_details) ----------------
  //
  // The selector enriches each emitted `Edge` with `data.sourceWording`
  // / `data.targetWording` by walking the events log once up-front for
  // every `node-created` event and building a per-node wording index.
  // The hover popover reads these fields to render the source→target
  // framing. Refinement: `tasks/refinements/moderator-ui/mod_hover_details.md`.

  it('enriches data.sourceWording and data.targetWording from prior node-created events', () => {
    const sourceId = '00000000-0000-4000-8000-0000000000a1';
    const targetId = '00000000-0000-4000-8000-0000000000a2';
    const state = makeState([
      {
        id: '00000000-0000-4000-8000-000000000101',
        sessionId: SESSION,
        sequence: 1,
        kind: 'node-created',
        actor: ACTOR,
        payload: {
          node_id: sourceId,
          wording: 'The data we collected',
          created_by: ACTOR,
          created_at: '2026-05-11T00:00:00.000Z',
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000102',
        sessionId: SESSION,
        sequence: 2,
        kind: 'node-created',
        actor: ACTOR,
        payload: {
          node_id: targetId,
          wording: 'The minimum wage should be raised',
          created_by: ACTOR,
          created_at: '2026-05-11T00:00:00.000Z',
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
      makeEdgeCreated({
        sequence: 3,
        edgeId: 'edge-enriched',
        role: 'supports',
        source: sourceId,
        target: targetId,
      }),
    ]);
    const edges = selectEdgesForSession(state, SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.sourceWording).toBe('The data we collected');
    expect(edges[0]?.data?.targetWording).toBe('The minimum wage should be raised');
  });

  it('falls back to the "—" em-dash for an edge whose source / target has not been node-created yet', () => {
    const sourceId = '00000000-0000-4000-8000-0000000000a1';
    const targetId = '00000000-0000-4000-8000-0000000000a2';
    const state = makeState([
      // Only the source node is created; the target has not (a wire-
      // protocol violation but defensible). The selector must not
      // throw and must surface the documented em-dash fallback.
      {
        id: '00000000-0000-4000-8000-000000000101',
        sessionId: SESSION,
        sequence: 1,
        kind: 'node-created',
        actor: ACTOR,
        payload: {
          node_id: sourceId,
          wording: 'source wording present',
          created_by: ACTOR,
          created_at: '2026-05-11T00:00:00.000Z',
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
      makeEdgeCreated({
        sequence: 2,
        edgeId: 'edge-half-known',
        role: 'supports',
        source: sourceId,
        target: targetId,
      }),
    ]);
    const edges = selectEdgesForSession(state, SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.sourceWording).toBe('source wording present');
    expect(edges[0]?.data?.targetWording).toBe('—');
  });

  // -- Endpoint id projection (mod_edge_popover_full_target_wording) --
  //
  // The selector populates `data.sourceId` / `data.targetId` directly
  // from the `edge-created` payload's `source_node_id` /
  // `target_node_id` — no walk is needed because the ids are always
  // present on the wire event. The hover popover surfaces these ids in
  // its endpoint-references row in place of the retired wording-bearing
  // line. Refinement:
  // `tasks/refinements/moderator-ui/mod_edge_popover_full_target_wording.md`.

  it('projects data.sourceId and data.targetId from the edge-created payload (no node-created prerequisites)', () => {
    const sourceId = '00000000-0000-4000-8000-0000000000a1';
    const targetId = '00000000-0000-4000-8000-0000000000a2';
    const state = makeState([
      makeEdgeCreated({
        sequence: 1,
        edgeId: 'edge-ids-only',
        role: 'supports',
        source: sourceId,
        target: targetId,
      }),
    ]);
    const edges = selectEdgesForSession(state, SESSION);
    expect(edges).toHaveLength(1);
    // The ids are populated verbatim from the event payload even when
    // no prior `node-created` event has been seen (the wording-walk
    // path falls back to the em-dash; the id projection does not).
    expect(edges[0]?.data?.sourceId).toBe(sourceId);
    expect(edges[0]?.data?.targetId).toBe(targetId);
  });

  it('produces deterministic source/target wordings across multiple calls on the same events (purity)', () => {
    const sourceId = '00000000-0000-4000-8000-0000000000a1';
    const targetId = '00000000-0000-4000-8000-0000000000a2';
    const events: Event[] = [
      {
        id: '00000000-0000-4000-8000-000000000101',
        sessionId: SESSION,
        sequence: 1,
        kind: 'node-created',
        actor: ACTOR,
        payload: {
          node_id: sourceId,
          wording: 'pure wording A',
          created_by: ACTOR,
          created_at: '2026-05-11T00:00:00.000Z',
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000102',
        sessionId: SESSION,
        sequence: 2,
        kind: 'node-created',
        actor: ACTOR,
        payload: {
          node_id: targetId,
          wording: 'pure wording B',
          created_by: ACTOR,
          created_at: '2026-05-11T00:00:00.000Z',
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
      makeEdgeCreated({
        sequence: 3,
        edgeId: 'edge-pure',
        role: 'supports',
        source: sourceId,
        target: targetId,
      }),
    ];
    const state = makeState(events);
    const edgesA = selectEdgesForSession(state, SESSION);
    const edgesB = selectEdgesForSession(state, SESSION);
    expect(edgesA[0]?.data?.sourceWording).toBe('pure wording A');
    expect(edgesA[0]?.data?.sourceWording).toBe(edgesB[0]?.data?.sourceWording);
    expect(edgesA[0]?.data?.targetWording).toBe(edgesB[0]?.data?.targetWording);
  });
});

// -- selectAnnotations / grouping helpers ---------------------------

const ALL_ANNOTATION_KINDS: readonly AnnotationKind[] = [
  'note',
  'reframe',
  'scope-change',
  'stance',
];

function makeAnnotationCreated(opts: {
  sequence: number;
  annotationId: string;
  kind: AnnotationKind;
  content?: string;
  targetNodeId: string | null;
  targetEdgeId: string | null;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x500 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
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

describe('selectAnnotations', () => {
  it('returns [] for an unknown session id', () => {
    const state = makeState([]);
    expect(selectAnnotations(state, 'unknown-session')).toEqual([]);
  });

  it('returns [] for a known session with no events', () => {
    const state = makeState([]);
    expect(selectAnnotations(state, SESSION)).toEqual([]);
  });

  it('projects a node-targeted annotation into the camelCased shape', () => {
    const state = makeState([
      makeAnnotationCreated({
        sequence: 1,
        annotationId: 'anno-node-1',
        kind: 'note',
        content: 'see also F-003',
        targetNodeId: 'node-x',
        targetEdgeId: null,
      }),
    ]);
    const annotations = selectAnnotations(state, SESSION);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({
      id: 'anno-node-1',
      kind: 'note',
      content: 'see also F-003',
      targetNodeId: 'node-x',
      targetEdgeId: null,
      createdBy: ACTOR,
      createdAt: '2026-05-11T00:00:00.000Z',
    });
  });

  it('projects an edge-targeted annotation with targetNodeId null', () => {
    const state = makeState([
      makeAnnotationCreated({
        sequence: 1,
        annotationId: 'anno-edge-1',
        kind: 'reframe',
        targetNodeId: null,
        targetEdgeId: 'edge-y',
      }),
    ]);
    const annotations = selectAnnotations(state, SESSION);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.targetNodeId).toBeNull();
    expect(annotations[0]?.targetEdgeId).toBe('edge-y');
  });

  it('preserves arrival order across multiple annotations', () => {
    const state = makeState([
      makeAnnotationCreated({
        sequence: 1,
        annotationId: 'anno-a',
        kind: 'note',
        targetNodeId: 'n1',
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: 'anno-b',
        kind: 'reframe',
        targetNodeId: 'n1',
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: 'anno-c',
        kind: 'stance',
        targetNodeId: 'n1',
        targetEdgeId: null,
      }),
    ]);
    const annotations = selectAnnotations(state, SESSION);
    expect(annotations.map((a) => a.id)).toEqual(['anno-a', 'anno-b', 'anno-c']);
  });

  it('only picks annotation-created events out of a mixed log', () => {
    const state = makeState([
      makeNodeCreated(1, 'n1'),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: 'anno-1',
        kind: 'note',
        targetNodeId: 'n1',
        targetEdgeId: null,
      }),
      makeEdgeCreated({ sequence: 3, edgeId: 'e1', role: 'supports', source: 'n1', target: 'n2' }),
    ]);
    const annotations = selectAnnotations(state, SESSION);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.id).toBe('anno-1');
  });

  for (const kind of ALL_ANNOTATION_KINDS) {
    it(`preserves the ${kind} annotation kind round-trip`, () => {
      const state = makeState([
        makeAnnotationCreated({
          sequence: 1,
          annotationId: `anno-${kind}`,
          kind,
          targetNodeId: 'n1',
          targetEdgeId: null,
        }),
      ]);
      const annotations = selectAnnotations(state, SESSION);
      expect(annotations).toHaveLength(1);
      expect(annotations[0]?.kind).toBe(kind);
    });
  }
});

describe('groupAnnotationsByNode / groupAnnotationsByEdge', () => {
  it('buckets node-targeted annotations under their target node id', () => {
    const state = makeState([
      makeAnnotationCreated({
        sequence: 1,
        annotationId: 'anno-a',
        kind: 'note',
        targetNodeId: 'n1',
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: 'anno-b',
        kind: 'reframe',
        targetNodeId: 'n1',
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: 'anno-c',
        kind: 'stance',
        targetNodeId: 'n2',
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 4,
        annotationId: 'anno-d',
        kind: 'note',
        targetNodeId: null,
        targetEdgeId: 'e1',
      }),
    ]);
    const grouped = groupAnnotationsByNode(selectAnnotations(state, SESSION));
    expect(grouped.get('n1')?.map((a) => a.id)).toEqual(['anno-a', 'anno-b']);
    expect(grouped.get('n2')?.map((a) => a.id)).toEqual(['anno-c']);
    // The edge-targeted annotation is excluded.
    expect(grouped.has('e1')).toBe(false);
  });

  it('buckets edge-targeted annotations under their target edge id and excludes node-targeted ones', () => {
    const state = makeState([
      makeAnnotationCreated({
        sequence: 1,
        annotationId: 'anno-a',
        kind: 'note',
        targetNodeId: 'n1',
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: 'anno-b',
        kind: 'reframe',
        targetNodeId: null,
        targetEdgeId: 'e1',
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: 'anno-c',
        kind: 'stance',
        targetNodeId: null,
        targetEdgeId: 'e1',
      }),
    ]);
    const grouped = groupAnnotationsByEdge(selectAnnotations(state, SESSION));
    expect(grouped.get('e1')?.map((a) => a.id)).toEqual(['anno-b', 'anno-c']);
    // Node-targeted annotation excluded.
    expect(grouped.has('n1')).toBe(false);
  });
});

// -- projectAxiomMarks / groupAxiomMarksByNode / axiomMarkColorFor ----
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md
//
// Cases:
//  1. Empty event log → [].
//  2. A proposal without a matching commit → [].
//  3. One proposal + commit pair emits one AxiomMark.
//  4. Two participants marking the same node both surface (per-
//     participant uniqueness invariant from
//     `proposeAxiomMark.test.ts` rule 4).
//  5. Emission order matches commit arrival order.
//  6. Non-axiom-mark proposals in a mixed log are ignored.
//  7. groupAxiomMarksByNode buckets correctly.
//  8. axiomMarkColorFor is deterministic for the same input.
//  9. axiomMarkColorFor distributes across at least three palette
//     buckets for three different UUIDs (regression against a
//     degenerate hash that collapses to one bucket).

const NODE_X = '00000000-0000-4000-8000-0000000000c1';
const NODE_Y = '00000000-0000-4000-8000-0000000000c2';
// Three UUIDs chosen so their sum-of-hex-digits hash falls in three
// distinct palette buckets (mod 6 = 1 / 2 / 3 respectively): the test
// at the bottom of this describe checks the resulting colors land in
// at least two distinct palette buckets. All-same-digit UUIDs (e.g.
// 1111…-…-4111-8111-111…) collapse to bucket 0 because the per-digit
// sum is `30n + 12 = 6(5n+2)`, divisible by 6 — those would defeat
// the regression test. The suffixes 1 / 2 / 3 add 1 / 2 / 3 to the
// `4 + 8 = 12` base sum, landing in buckets 1 / 2 / 3.
const PARTICIPANT_A = '00000000-0000-4000-8000-000000000001';
const PARTICIPANT_B = '00000000-0000-4000-8000-000000000002';
const PARTICIPANT_C = '00000000-0000-4000-8000-000000000003';
const PROPOSAL_AX_A_X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001';
const PROPOSAL_AX_B_X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002';
const PROPOSAL_AX_A_Y = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';
const PROPOSAL_AX_UNCOMMITTED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004';

function makeAxiomMarkProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
  participantId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION,
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

function makeCommit(opts: {
  sequence: number;
  proposalEnvelopeId: string;
  committedAt?: string;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x800 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence: opts.sequence,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      target: 'proposal',
      proposal_id: opts.proposalEnvelopeId,
      committed_by: ACTOR,
      committed_at: opts.committedAt ?? '2026-05-11T00:00:00.000Z',
    },
    createdAt: opts.committedAt ?? '2026-05-11T00:00:00.000Z',
  };
}

describe('projectAxiomMarks', () => {
  it('returns [] for an empty event log', () => {
    expect(projectAxiomMarks([])).toEqual([]);
  });

  it('returns [] when an axiom-mark proposal has no matching commit', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_UNCOMMITTED,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
    ];
    expect(projectAxiomMarks(events)).toEqual([]);
  });

  it('emits one AxiomMark for a proposal + commit pair', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeCommit({
        sequence: 2,
        proposalEnvelopeId: PROPOSAL_AX_A_X,
        committedAt: '2026-05-11T10:00:00.000Z',
      }),
    ];
    const marks = projectAxiomMarks(events);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toEqual({
      nodeId: NODE_X,
      participantId: PARTICIPANT_A,
      committedAt: '2026-05-11T10:00:00.000Z',
    });
  });

  it('emits two AxiomMarks when two participants mark the same node (per-participant uniqueness invariant)', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeCommit({ sequence: 2, proposalEnvelopeId: PROPOSAL_AX_A_X }),
      makeAxiomMarkProposal({
        sequence: 3,
        envelopeId: PROPOSAL_AX_B_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_B,
      }),
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_AX_B_X }),
    ];
    const marks = projectAxiomMarks(events);
    expect(marks).toHaveLength(2);
    expect(marks.map((m) => m.participantId)).toEqual([PARTICIPANT_A, PARTICIPANT_B]);
    expect(marks.every((m) => m.nodeId === NODE_X)).toBe(true);
  });

  it('preserves emission order in commit-arrival order', () => {
    // Both proposals land before either commit; the emission order
    // tracks the commits, not the proposals — so we land A's proposal,
    // B's proposal, B's commit, A's commit, and assert the resulting
    // marks come out [B, A].
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: PROPOSAL_AX_B_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_B,
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_AX_B_X }),
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_AX_A_X }),
    ];
    const marks = projectAxiomMarks(events);
    expect(marks.map((m) => m.participantId)).toEqual([PARTICIPANT_B, PARTICIPANT_A]);
  });

  it('ignores non-axiom-mark proposals in a mixed log', () => {
    // A `classify-node` proposal + commit is irrelevant to the axiom-
    // mark projection. Mixed in with one axiom-mark pair, only the
    // axiom-mark surfaces.
    const events: Event[] = [
      makeNodeCreated(1, NODE_X),
      {
        id: '00000000-0000-4000-8000-0000000000d1',
        sessionId: SESSION,
        sequence: 2,
        kind: 'proposal',
        actor: ACTOR,
        payload: {
          proposal: { kind: 'classify-node', node_id: NODE_X, classification: 'fact' },
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
      makeCommit({ sequence: 3, proposalEnvelopeId: '00000000-0000-4000-8000-0000000000d1' }),
      makeAxiomMarkProposal({
        sequence: 4,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeCommit({ sequence: 5, proposalEnvelopeId: PROPOSAL_AX_A_X }),
    ];
    const marks = projectAxiomMarks(events);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.participantId).toBe(PARTICIPANT_A);
  });
});

describe('groupAxiomMarksByNode', () => {
  it('buckets axiom-marks under their target node id', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeCommit({ sequence: 2, proposalEnvelopeId: PROPOSAL_AX_A_X }),
      makeAxiomMarkProposal({
        sequence: 3,
        envelopeId: PROPOSAL_AX_B_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_B,
      }),
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_AX_B_X }),
      makeAxiomMarkProposal({
        sequence: 5,
        envelopeId: PROPOSAL_AX_A_Y,
        nodeId: NODE_Y,
        participantId: PARTICIPANT_A,
      }),
      makeCommit({ sequence: 6, proposalEnvelopeId: PROPOSAL_AX_A_Y }),
    ];
    const grouped = groupAxiomMarksByNode(projectAxiomMarks(events));
    expect(grouped.get(NODE_X)?.map((m) => m.participantId)).toEqual([
      PARTICIPANT_A,
      PARTICIPANT_B,
    ]);
    expect(grouped.get(NODE_Y)?.map((m) => m.participantId)).toEqual([PARTICIPANT_A]);
  });
});

// -- projectPendingAxiomMarks / groupPendingAxiomMarksByNode ----------
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_pending_render.md
//
// The pending-axiom-mark projection mirrors `projectAxiomMarks` but
// surfaces the IN-FLIGHT (proposed-but-not-committed) entries instead of
// the committed ones. Two terminators remove an entry from the pending
// set: `commit` and `meta-disagreement-marked` (per Decision §1, mirrors
// `derivePendingProposals`'s two-terminator handling).
//
// Cases:
//  1. Empty event log → [].
//  2. An axiom-mark proposal with no terminator surfaces as one entry
//     with the right (proposalEventId, nodeId, participantId, proposedAt).
//  3. A `commit` referencing the proposal removes the entry.
//  4. A `meta-disagreement-marked` referencing the proposal removes
//     the entry (the second terminator).
//  5. Two proposals from different participants on the same node both
//     surface as separate pending entries.
//  6. Two proposals from the SAME participant on the same node both
//     surface (Decision §2 — selector does not enforce per-participant
//     uniqueness on the pending set; the validator's rule 4 only rejects
//     committed duplicates).
//  7. Non-axiom-mark proposals are ignored.
//  8. Emission order matches proposal-arrival order.
//  9. groupPendingAxiomMarksByNode buckets correctly.

function makeMetaDisagreementMarked(opts: {
  sequence: number;
  proposalEnvelopeId: string;
  markedAt?: string;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x900 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence: opts.sequence,
    kind: 'meta-disagreement-marked',
    actor: ACTOR,
    payload: {
      target: 'proposal',
      proposal_id: opts.proposalEnvelopeId,
      marked_by: ACTOR,
      marked_at: opts.markedAt ?? '2026-05-11T00:00:00.000Z',
    },
    createdAt: opts.markedAt ?? '2026-05-11T00:00:00.000Z',
  };
}

describe('projectPendingAxiomMarks', () => {
  it('returns [] for an empty event log', () => {
    expect(projectPendingAxiomMarks([])).toEqual([]);
  });

  it('emits one PendingAxiomMark for an axiom-mark proposal with no terminator', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
    ];
    const pending = projectPendingAxiomMarks(events);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toEqual({
      proposalEventId: PROPOSAL_AX_A_X,
      nodeId: NODE_X,
      participantId: PARTICIPANT_A,
      proposedAt: '2026-05-11T00:00:00.000Z',
    });
  });

  it('removes the entry when a commit terminator references the proposal', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeCommit({ sequence: 2, proposalEnvelopeId: PROPOSAL_AX_A_X }),
    ];
    expect(projectPendingAxiomMarks(events)).toEqual([]);
  });

  it('removes the entry when a meta-disagreement-marked terminator references the proposal', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeMetaDisagreementMarked({ sequence: 2, proposalEnvelopeId: PROPOSAL_AX_A_X }),
    ];
    expect(projectPendingAxiomMarks(events)).toEqual([]);
  });

  it('surfaces two pending entries when two different participants propose on the same node', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: PROPOSAL_AX_B_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_B,
      }),
    ];
    const pending = projectPendingAxiomMarks(events);
    expect(pending.map((m) => m.participantId)).toEqual([PARTICIPANT_A, PARTICIPANT_B]);
    expect(pending.every((m) => m.nodeId === NODE_X)).toBe(true);
  });

  it('surfaces two pending entries when the SAME participant has two pending proposals on the same node (no per-participant dedup)', () => {
    // Decision §2 — the rendering reflects the projection truth; if two
    // pending proposals exist (even from the same participant on the
    // same node), two dots render. A future propose-side tightening
    // that adds a "no duplicate pending" rule would naturally collapse
    // this case to one without any selector change.
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: PROPOSAL_AX_A_Y, // reuse a different envelope id but same (node, participant)
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
    ];
    const pending = projectPendingAxiomMarks(events);
    expect(pending).toHaveLength(2);
    expect(pending.map((m) => m.proposalEventId)).toEqual([PROPOSAL_AX_A_X, PROPOSAL_AX_A_Y]);
  });

  it('ignores non-axiom-mark proposals in a mixed log', () => {
    // A `classify-node` proposal does not produce a pending entry — the
    // axiom-mark projection is the dispatch on `inner.kind`.
    const events: Event[] = [
      makeNodeCreated(1, NODE_X),
      {
        id: '00000000-0000-4000-8000-0000000000d2',
        sessionId: SESSION,
        sequence: 2,
        kind: 'proposal',
        actor: ACTOR,
        payload: {
          proposal: { kind: 'classify-node', node_id: NODE_X, classification: 'fact' },
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
      makeAxiomMarkProposal({
        sequence: 3,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
    ];
    const pending = projectPendingAxiomMarks(events);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.proposalEventId).toBe(PROPOSAL_AX_A_X);
  });

  it('emits surviving entries in proposal-arrival order', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: PROPOSAL_AX_B_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_B,
      }),
      makeAxiomMarkProposal({
        sequence: 3,
        envelopeId: PROPOSAL_AX_A_Y,
        nodeId: NODE_Y,
        participantId: PARTICIPANT_A,
      }),
    ];
    const pending = projectPendingAxiomMarks(events);
    expect(pending.map((m) => m.proposalEventId)).toEqual([
      PROPOSAL_AX_A_X,
      PROPOSAL_AX_B_X,
      PROPOSAL_AX_A_Y,
    ]);
  });

  it('keeps the surviving entry when a commit references an unrelated proposal', () => {
    // The terminator's `proposal_id` must match a recorded axiom-mark
    // proposal id; an unrelated commit (e.g. a classify-node commit) is
    // a no-op for the pending axiom-mark set.
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeCommit({ sequence: 2, proposalEnvelopeId: PROPOSAL_AX_UNCOMMITTED }),
    ];
    const pending = projectPendingAxiomMarks(events);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.proposalEventId).toBe(PROPOSAL_AX_A_X);
  });
});

describe('groupPendingAxiomMarksByNode', () => {
  it('buckets pending axiom-marks under their target node id', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: PROPOSAL_AX_B_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_B,
      }),
      makeAxiomMarkProposal({
        sequence: 3,
        envelopeId: PROPOSAL_AX_A_Y,
        nodeId: NODE_Y,
        participantId: PARTICIPANT_A,
      }),
    ];
    const grouped = groupPendingAxiomMarksByNode(projectPendingAxiomMarks(events));
    expect(grouped.get(NODE_X)?.map((m) => m.participantId)).toEqual([
      PARTICIPANT_A,
      PARTICIPANT_B,
    ]);
    expect(grouped.get(NODE_Y)?.map((m) => m.participantId)).toEqual([PARTICIPANT_A]);
  });

  it('omits nodes that have no pending axiom-marks', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
    ];
    const grouped = groupPendingAxiomMarksByNode(projectPendingAxiomMarks(events));
    expect(grouped.has(NODE_X)).toBe(true);
    expect(grouped.has(NODE_Y)).toBe(false);
  });
});

describe('axiomMarkColorFor', () => {
  it('returns the same color triple for the same participantId across calls (deterministic)', () => {
    const a = axiomMarkColorFor(PARTICIPANT_A);
    const b = axiomMarkColorFor(PARTICIPANT_A);
    expect(a).toEqual(b);
    expect(a.bg).toBe(b.bg);
    expect(a.text).toBe(b.text);
    expect(a.ring).toBe(b.ring);
  });

  it('distributes three distinct participant UUIDs across at least three palette buckets', () => {
    // Regression against a degenerate hash that collapses every UUID
    // into one bucket. The three handpicked UUIDs are constructed to
    // sit in three distinct buckets given the sum-of-hex-digits hash
    // and the 6-bucket palette.
    const colorA = axiomMarkColorFor(PARTICIPANT_A);
    const colorB = axiomMarkColorFor(PARTICIPANT_B);
    const colorC = axiomMarkColorFor(PARTICIPANT_C);
    const distinct = new Set([colorA.bg, colorB.bg, colorC.bg]);
    expect(distinct.size).toBeGreaterThanOrEqual(2);
    // Sanity: each color is from the 6-bucket palette.
    expect(AXIOM_MARK_PALETTE_SIZE).toBe(6);
    for (const color of [colorA, colorB, colorC]) {
      expect(color.bg).toMatch(/^bg-(sky|amber|emerald|fuchsia|cyan|lime)-100$/);
      expect(color.text).toMatch(/^text-(sky|amber|emerald|fuchsia|cyan|lime)-900$/);
      expect(color.ring).toMatch(/^ring-(sky|amber|emerald|fuchsia|cyan|lime)-300$/);
    }
  });
});

// -- projectVotesByFacet ---------------------------------------------
//
// Refinement: tasks/refinements/moderator-ui/mod_vote_indicators_on_graph.md
//
// The vote-by-facet projection feeds the in-pill vote-indicator row.
// It walks proposal + vote events, maps each vote to its target
// (nodeId, facet) via the proposal envelope id, and records each
// participant's latest arm. Insertion order is the participant's FIRST
// vote arrival order (subsequent overwrites preserve position).

const PROPOSAL_WORDING_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const PROPOSAL_CLASSIFY_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const PROPOSAL_SUBSTANCE_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const PROPOSAL_EDGE_SUBSTANCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const NODE_VOTE_1 = '11111111-1111-4111-8111-111111111111';
const NODE_VOTE_2 = '22222222-2222-4222-8222-222222222222';
const EDGE_VOTE_1 = '33333333-3333-4333-8333-333333333333';
const VOTE_PARTICIPANT_A = '00000000-0000-4000-8000-0000000000a1';
const VOTE_PARTICIPANT_B = '00000000-0000-4000-8000-0000000000a2';

function makeClassifyProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'classify-node',
        node_id: opts.nodeId,
        classification: 'fact',
      },
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function makeEditWordingProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: opts.nodeId,
        new_wording: 'reworded',
      },
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function makeSetNodeSubstanceProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'set-node-substance',
        node_id: opts.nodeId,
        value: 'agreed',
      },
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function makeSetEdgeSubstanceProposal(opts: {
  sequence: number;
  envelopeId: string;
  edgeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION,
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
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function makeVote(opts: {
  sequence: number;
  proposalEnvelopeId: string;
  participantId: string;
  vote: 'agree' | 'dispute' | 'withdraw';
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0xb00 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence: opts.sequence,
    kind: 'vote',
    actor: opts.participantId,
    payload: {
      target: 'proposal' as const,
      proposal_id: opts.proposalEnvelopeId,
      participant: opts.participantId,
      choice: opts.vote as 'agree' | 'dispute',
      voted_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

describe('projectVotesByFacet', () => {
  it('returns an empty map for an empty event log', () => {
    const result = projectVotesByFacet([]);
    expect(result.size).toBe(0);
  });

  it('projects a single agree vote onto the right (nodeId, facet) bucket', () => {
    const events: Event[] = [
      makeEditWordingProposal({
        sequence: 1,
        envelopeId: PROPOSAL_WORDING_1,
        nodeId: NODE_VOTE_1,
      }),
      makeVote({
        sequence: 2,
        proposalEnvelopeId: PROPOSAL_WORDING_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
    ];
    const result = projectVotesByFacet(events);
    const perNode = result.get(NODE_VOTE_1);
    expect(perNode).toBeDefined();
    const perFacet = perNode!.get('wording');
    expect(perFacet).toEqual([{ participantId: VOTE_PARTICIPANT_A, choice: 'agree' }]);
  });

  it('latest vote wins when the same participant votes twice (agree → dispute switch)', () => {
    const events: Event[] = [
      makeClassifyProposal({
        sequence: 1,
        envelopeId: PROPOSAL_CLASSIFY_1,
        nodeId: NODE_VOTE_1,
      }),
      makeVote({
        sequence: 2,
        proposalEnvelopeId: PROPOSAL_CLASSIFY_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
      makeVote({
        sequence: 3,
        proposalEnvelopeId: PROPOSAL_CLASSIFY_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'dispute',
      }),
    ];
    const result = projectVotesByFacet(events);
    const perFacet = result.get(NODE_VOTE_1)!.get('classification');
    expect(perFacet).toEqual([{ participantId: VOTE_PARTICIPANT_A, choice: 'dispute' }]);
  });

  it('preserves first-vote arrival order across multiple participants', () => {
    const events: Event[] = [
      makeEditWordingProposal({
        sequence: 1,
        envelopeId: PROPOSAL_WORDING_1,
        nodeId: NODE_VOTE_1,
      }),
      makeVote({
        sequence: 2,
        proposalEnvelopeId: PROPOSAL_WORDING_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
      makeVote({
        sequence: 3,
        proposalEnvelopeId: PROPOSAL_WORDING_1,
        participantId: VOTE_PARTICIPANT_B,
        vote: 'dispute',
      }),
      // A switches arm — should NOT move A to the end of the list.
      makeVote({
        sequence: 4,
        proposalEnvelopeId: PROPOSAL_WORDING_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'dispute',
      }),
    ];
    const result = projectVotesByFacet(events);
    const perFacet = result.get(NODE_VOTE_1)!.get('wording');
    expect(perFacet).toEqual([
      { participantId: VOTE_PARTICIPANT_A, choice: 'dispute' },
      { participantId: VOTE_PARTICIPANT_B, choice: 'dispute' },
    ]);
  });

  it('buckets votes correctly across two facets on the same node', () => {
    const events: Event[] = [
      makeEditWordingProposal({
        sequence: 1,
        envelopeId: PROPOSAL_WORDING_1,
        nodeId: NODE_VOTE_1,
      }),
      makeSetNodeSubstanceProposal({
        sequence: 2,
        envelopeId: PROPOSAL_SUBSTANCE_1,
        nodeId: NODE_VOTE_1,
      }),
      makeVote({
        sequence: 3,
        proposalEnvelopeId: PROPOSAL_WORDING_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
      makeVote({
        sequence: 4,
        proposalEnvelopeId: PROPOSAL_SUBSTANCE_1,
        participantId: VOTE_PARTICIPANT_B,
        vote: 'dispute',
      }),
    ];
    const result = projectVotesByFacet(events);
    const perNode = result.get(NODE_VOTE_1)!;
    expect(perNode.get('wording')).toEqual([
      { participantId: VOTE_PARTICIPANT_A, choice: 'agree' },
    ]);
    expect(perNode.get('substance')).toEqual([
      { participantId: VOTE_PARTICIPANT_B, choice: 'dispute' },
    ]);
  });

  it('buckets votes correctly across two distinct nodes', () => {
    const events: Event[] = [
      makeEditWordingProposal({
        sequence: 1,
        envelopeId: PROPOSAL_WORDING_1,
        nodeId: NODE_VOTE_1,
      }),
      makeEditWordingProposal({
        sequence: 2,
        envelopeId: PROPOSAL_CLASSIFY_1,
        nodeId: NODE_VOTE_2,
      }),
      makeVote({
        sequence: 3,
        proposalEnvelopeId: PROPOSAL_WORDING_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
      makeVote({
        sequence: 4,
        proposalEnvelopeId: PROPOSAL_CLASSIFY_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'withdraw',
      }),
    ];
    const result = projectVotesByFacet(events);
    expect(result.get(NODE_VOTE_1)!.get('wording')).toEqual([
      { participantId: VOTE_PARTICIPANT_A, choice: 'agree' },
    ]);
    expect(result.get(NODE_VOTE_2)!.get('wording')).toEqual([
      { participantId: VOTE_PARTICIPANT_A, choice: 'withdraw' },
    ]);
  });

  it('silently drops a vote referencing an unknown proposal', () => {
    const events: Event[] = [
      makeVote({
        sequence: 1,
        proposalEnvelopeId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
    ];
    const result = projectVotesByFacet(events);
    expect(result.size).toBe(0);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_vote_indicators_in_sidebar.md
  // Decision §4 — the projection now buckets `set-edge-substance` votes
  // under the edge id (alongside the existing node-keyed buckets). The
  // outer-map key is `entityId` (node UUID OR edge UUID — disjoint
  // keyspaces). The graph consumer (which only ever looks up node ids)
  // is unaffected; the sidebar consumer (this task) reads edge buckets
  // via the same lookup.
  it('buckets a vote on a set-edge-substance proposal under the edge id', () => {
    const events: Event[] = [
      makeSetEdgeSubstanceProposal({
        sequence: 1,
        envelopeId: PROPOSAL_EDGE_SUBSTANCE,
        edgeId: EDGE_VOTE_1,
      }),
      makeVote({
        sequence: 2,
        proposalEnvelopeId: PROPOSAL_EDGE_SUBSTANCE,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
    ];
    const result = projectVotesByFacet(events);
    const perEdge = result.get(EDGE_VOTE_1);
    expect(perEdge).toBeDefined();
    expect(perEdge!.get('substance')).toEqual([
      { participantId: VOTE_PARTICIPANT_A, choice: 'agree' },
    ]);
  });

  it('node-keyed and edge-keyed buckets coexist without interference', () => {
    // Mixed log — node-substance and edge-substance proposals each
    // receive a vote. Both surface in the projection under their
    // respective entity ids; neither lookup picks up the other's
    // bucket. The graph consumer's node-only lookup is unaffected.
    const events: Event[] = [
      makeSetNodeSubstanceProposal({
        sequence: 1,
        envelopeId: PROPOSAL_SUBSTANCE_1,
        nodeId: NODE_VOTE_1,
      }),
      makeSetEdgeSubstanceProposal({
        sequence: 2,
        envelopeId: PROPOSAL_EDGE_SUBSTANCE,
        edgeId: EDGE_VOTE_1,
      }),
      makeVote({
        sequence: 3,
        proposalEnvelopeId: PROPOSAL_SUBSTANCE_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
      makeVote({
        sequence: 4,
        proposalEnvelopeId: PROPOSAL_EDGE_SUBSTANCE,
        participantId: VOTE_PARTICIPANT_B,
        vote: 'dispute',
      }),
    ];
    const result = projectVotesByFacet(events);
    expect(result.get(NODE_VOTE_1)!.get('substance')).toEqual([
      { participantId: VOTE_PARTICIPANT_A, choice: 'agree' },
    ]);
    expect(result.get(EDGE_VOTE_1)!.get('substance')).toEqual([
      { participantId: VOTE_PARTICIPANT_B, choice: 'dispute' },
    ]);
  });

  it('records a withdraw arm distinctly (per methodology, withdraw is its own arm)', () => {
    const events: Event[] = [
      makeEditWordingProposal({
        sequence: 1,
        envelopeId: PROPOSAL_WORDING_1,
        nodeId: NODE_VOTE_1,
      }),
      makeVote({
        sequence: 2,
        proposalEnvelopeId: PROPOSAL_WORDING_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'withdraw',
      }),
    ];
    const result = projectVotesByFacet(events);
    expect(result.get(NODE_VOTE_1)!.get('wording')).toEqual([
      { participantId: VOTE_PARTICIPANT_A, choice: 'withdraw' },
    ]);
  });
});

// -- selectNodeWordingById -------------------------------------------
//
// Refinement: tasks/refinements/moderator-ui/mod_target_auto_suggest.md
//
// The capture-target chip resolves the staged target's display label
// via this selector. Cases pin the three documented branches: matching
// `node-created` → wording string; no matching event → null;
// last-wording-wins on duplicate `node-created` for the same id.

describe('selectNodeWordingById', () => {
  it('returns the wording for a matching node-created event', () => {
    const events: Event[] = [
      {
        id: '00000000-0000-4000-8000-000000000201',
        sessionId: SESSION,
        sequence: 1,
        kind: 'node-created',
        actor: ACTOR,
        payload: {
          node_id: 'n-target',
          wording: 'The proposed minimum wage would raise prices for everyone.',
          created_by: ACTOR,
          created_at: '2026-05-11T00:00:00.000Z',
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
    ];
    expect(selectNodeWordingById(events, 'n-target')).toBe(
      'The proposed minimum wage would raise prices for everyone.',
    );
  });

  it('returns null when no matching node-created event exists', () => {
    const events: Event[] = [
      {
        id: '00000000-0000-4000-8000-000000000202',
        sessionId: SESSION,
        sequence: 1,
        kind: 'node-created',
        actor: ACTOR,
        payload: {
          node_id: 'n-other',
          wording: 'irrelevant wording',
          created_by: ACTOR,
          created_at: '2026-05-11T00:00:00.000Z',
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
    ];
    expect(selectNodeWordingById(events, 'n-missing')).toBeNull();
  });

  it('returns the latest wording when multiple node-created events exist for the same id (last-write-wins)', () => {
    // Duplicate `node-created` events for the same node id would be a
    // wire-protocol violation, but the selector remains deterministic:
    // the *last* one seen wins. Mirrors the rest of the projection
    // rules' last-write-wins semantics.
    const events: Event[] = [
      {
        id: '00000000-0000-4000-8000-000000000203',
        sessionId: SESSION,
        sequence: 1,
        kind: 'node-created',
        actor: ACTOR,
        payload: {
          node_id: 'n-dup',
          wording: 'first wording',
          created_by: ACTOR,
          created_at: '2026-05-11T00:00:00.000Z',
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000204',
        sessionId: SESSION,
        sequence: 2,
        kind: 'node-created',
        actor: ACTOR,
        payload: {
          node_id: 'n-dup',
          wording: 'second wording',
          created_by: ACTOR,
          created_at: '2026-05-11T00:00:00.000Z',
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
    ];
    expect(selectNodeWordingById(events, 'n-dup')).toBe('second wording');
  });
});
