// Tests for the store-derived selectors that translate the WS event
// log into the ReactFlow node / edge / annotation shapes.
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_rendering.md
// (prior:     tasks/refinements/moderator-ui/mod_edge_rendering.md)
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

import type { WsState } from '../ws/wsStore.js';
import {
  groupAnnotationsByEdge,
  groupAnnotationsByNode,
  selectAnnotations,
  selectEdgesForSession,
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
      // `mod_proposed_state_styling`).
      data: { role: 'supports', annotations: [], facetStatuses: {} },
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

  it('leaves facetStatuses empty on an edge with no facet-targeting proposals', () => {
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
    expect(edges[0]?.data?.facetStatuses).toEqual({});
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
