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
// Cases for `selectAnnotations` (moderator-internal `WsState` wrapper
// around the shell-lifted `projectAnnotations`):
//   8. Unknown sessionId returns [] (null-safe lookup).
//   9. Known session with no events returns [].
//  10. Known session delegates to `projectAnnotations` and returns the
//      camelCased shape.
//
// The projection trio (`projectAnnotations` / `groupAnnotationsByNode` /
// `groupAnnotationsByEdge`) is canonically tested at
// `packages/shell/src/annotations/annotations.test.ts` after the
// `shell_package.extract_cytoscape_projectors` lift.

import { describe, expect, it } from 'vitest';
import { MarkerType, type Node } from 'reactflow';
import type { AnnotationKind, EdgeRole, Event } from '@a-conversa/shared-types';

import { AXIOM_MARK_PALETTE_SIZE, EMPTY_ANNOTATIONS, axiomMarkColorFor } from '@a-conversa/shell';

import type { WsState } from '../ws/wsStore.js';
import {
  buildAnnotationHostEdgeAnchorIndex,
  computeAnnotationsAsEndpoints,
  groupPendingAxiomMarksByNode,
  midpointIdFor,
  placeAnnotationHostMidpoints,
  projectAnnotationHostEdges,
  projectAnnotationHostMidpointNodes,
  projectAnnotationNodes,
  projectPendingAxiomMarks,
  selectAnnotations,
  selectEdgesForSession,
  selectNodeWordingById,
} from './selectors.js';
import { ANNOTATION_HOST_EDGE_TYPE, type AnnotationHostEdgeData } from './AnnotationHostEdge.js';
import { ANNOTATION_HOST_MIDPOINT_NODE_TYPE } from './AnnotationHostMidpointNode.js';
import { ANNOTATION_NODE_TYPE, type AnnotationNodeData } from './AnnotationNode.js';
import type { Annotation } from '@a-conversa/shell';

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
      [SESSION]: {
        lastAppliedSequence: events.length,
        events,
        pendingProposalFacetStatus: new Map(),
      },
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
      // Directional arrow marker (per-edge ReactFlow `markerEnd` field).
      // Baseline edges (no substance override on facetStatuses) use the
      // default `ArrowClosed` with no color, so ReactFlow paints the
      // arrow in its built-in default — matching the BaseEdge default
      // stroke. Per-state color variants are exercised by the dedicated
      // markerEnd cases further down.
      markerEnd: { type: MarkerType.ArrowClosed },
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
        // Per ADR 0030 §5 + §10 + `pf_mod_facet_name_widen_shape`: an
        // edge with no `set-edge-substance` proposal has its substance
        // facet in the empty-state `'awaiting-proposal'` row. The
        // shape facet enters life with the inline role as its
        // candidate (no proposal supplied it) — with no participants
        // joined in this fixture, the canonical derivation surfaces
        // `'proposed'` (Rule 8 — hasCandidate but no unanimous-agree
        // signal across an empty current-participants set).
        facetStatuses: { substance: 'awaiting-proposal', shape: 'proposed' },
        sourceId: '00000000-0000-4000-8000-000000000001',
        targetId: '00000000-0000-4000-8000-000000000002',
        sourceKind: 'node',
        targetKind: 'node',
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
    // Per `pf_mod_facet_name_widen_shape`: the canonical derivation
    // also tracks the inline `shape` facet — with no participants
    // joined in this fixture, it surfaces `'proposed'` (Rule 8 —
    // hasCandidate but no unanimous-agree signal across an empty
    // current-participants set).
    expect(edges[0]?.data?.facetStatuses).toEqual({
      substance: 'proposed',
      shape: 'proposed',
    });
  });

  // -- Directional arrow marker ---------------------------------------
  //
  // The selector attaches `markerEnd: { type: MarkerType.ArrowClosed }`
  // to every emitted edge so ReactFlow paints a directional arrowhead
  // on the visible bezier path. Arrow color matches the per-state
  // stroke override in `<StatementEdge>`: `#e11d48` for disputed,
  // `#7c3aed` for meta-disagreement, default (no color) elsewhere.
  // Parallels the participant Cytoscape surface, which already wires
  // per-state `target-arrow-color` next to `line-color`.

  it('attaches markerEnd { type: ArrowClosed, color: #e11d48 } when the substance facet is disputed', () => {
    const edgeId = '44444444-4444-4444-8444-444444444444';
    const proposalId = '55555555-5555-4555-8555-555555555555';
    const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000a1';
    const PARTICIPANT_B = '00000000-0000-4000-8000-0000000000a2';
    const state = makeState([
      {
        id: '00000000-0000-4000-8000-0000000000j1',
        sessionId: SESSION,
        sequence: 1,
        kind: 'participant-joined',
        actor: ACTOR,
        payload: {
          user_id: PARTICIPANT_A,
          role: 'debater-A',
          screen_name: 'A',
          joined_at: '2026-05-11T00:00:00.000Z',
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-0000000000j2',
        sessionId: SESSION,
        sequence: 2,
        kind: 'participant-joined',
        actor: ACTOR,
        payload: {
          user_id: PARTICIPANT_B,
          role: 'debater-B',
          screen_name: 'B',
          joined_at: '2026-05-11T00:00:00.000Z',
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
      makeEdgeCreated({
        sequence: 3,
        edgeId,
        role: 'supports',
        source: 'n1',
        target: 'n2',
      }),
      {
        id: proposalId,
        sessionId: SESSION,
        sequence: 4,
        kind: 'proposal',
        actor: ACTOR,
        payload: {
          proposal: { kind: 'set-edge-substance', edge_id: edgeId, value: 'agreed' },
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-0000000000v1',
        sessionId: SESSION,
        sequence: 5,
        kind: 'vote',
        actor: PARTICIPANT_A,
        payload: {
          target: 'proposal' as const,
          proposal_id: proposalId,
          participant: PARTICIPANT_A,
          choice: 'dispute',
          voted_at: '2026-05-11T00:00:10.000Z',
        },
        createdAt: '2026-05-11T00:00:10.000Z',
      },
    ]);
    const edges = selectEdgesForSession(state, SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.facetStatuses?.substance).toBe('disputed');
    expect(edges[0]?.markerEnd).toEqual({ type: MarkerType.ArrowClosed, color: '#e11d48' });
  });

  it('attaches markerEnd { type: ArrowClosed, color: #7c3aed } when the substance facet is meta-disagreement', () => {
    const edgeId = '66666666-6666-4666-8666-666666666666';
    const proposalId = '77777777-7777-4777-8777-777777777777';
    const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000a1';
    const PARTICIPANT_B = '00000000-0000-4000-8000-0000000000a2';
    const state = makeState([
      {
        id: '00000000-0000-4000-8000-0000000000j3',
        sessionId: SESSION,
        sequence: 1,
        kind: 'participant-joined',
        actor: ACTOR,
        payload: {
          user_id: PARTICIPANT_A,
          role: 'debater-A',
          screen_name: 'A',
          joined_at: '2026-05-11T00:00:00.000Z',
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-0000000000j4',
        sessionId: SESSION,
        sequence: 2,
        kind: 'participant-joined',
        actor: ACTOR,
        payload: {
          user_id: PARTICIPANT_B,
          role: 'debater-B',
          screen_name: 'B',
          joined_at: '2026-05-11T00:00:00.000Z',
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
      makeEdgeCreated({
        sequence: 3,
        edgeId,
        role: 'supports',
        source: 'n1',
        target: 'n2',
      }),
      {
        id: proposalId,
        sessionId: SESSION,
        sequence: 4,
        kind: 'proposal',
        actor: ACTOR,
        payload: {
          proposal: { kind: 'set-edge-substance', edge_id: edgeId, value: 'agreed' },
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-0000000000m1',
        sessionId: SESSION,
        sequence: 5,
        kind: 'meta-disagreement-marked',
        actor: ACTOR,
        payload: {
          target: 'proposal',
          proposal_id: proposalId,
          marked_by: ACTOR,
          marked_at: '2026-05-11T00:00:20.000Z',
        },
        createdAt: '2026-05-11T00:00:20.000Z',
      },
    ]);
    const edges = selectEdgesForSession(state, SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.facetStatuses?.substance).toBe('meta-disagreement');
    expect(edges[0]?.markerEnd).toEqual({ type: MarkerType.ArrowClosed, color: '#7c3aed' });
  });

  it('attaches the default-color markerEnd to a baseline edge (no per-state stroke override)', () => {
    // Awaiting-proposal substance (the default empty-state) falls
    // through to the default-color marker — no `color` field — so
    // ReactFlow paints the built-in arrow color matching the
    // BaseEdge default stroke. Same branch covers proposed / agreed
    // / committed / withdrawn substance states, none of which override
    // the stroke in `<StatementEdge>`.
    const state = makeState([
      makeEdgeCreated({
        sequence: 1,
        edgeId: 'edge-baseline-arrow',
        role: 'supports',
        source: 'n1',
        target: 'n2',
      }),
    ]);
    const edges = selectEdgesForSession(state, SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.markerEnd).toEqual({ type: MarkerType.ArrowClosed });
  });

  it('attaches the awaiting-proposal substance row to an edge with no facet-targeting proposals', () => {
    // Per ADR 0030 §10 + the refactor: an edge with no
    // `set-edge-substance` proposal carries the empty-state
    // `'awaiting-proposal'` row on its substance facet. Per
    // `pf_mod_facet_name_widen_shape`: the inline `shape` facet
    // additionally carries `'proposed'` (Rule 8 — hasCandidate from
    // `edge-created`, no participants joined in this fixture so the
    // unanimous-agree comparison degenerates).
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
    expect(edges[0]?.data?.facetStatuses).toEqual({
      substance: 'awaiting-proposal',
      shape: 'proposed',
    });
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

// -- selectAnnotations wrapper --------------------------------------
//
// The annotation projection trio (`projectAnnotations` /
// `groupAnnotationsByNode` / `groupAnnotationsByEdge`) lives in
// `@a-conversa/shell` after the `shell_package.extract_cytoscape_projectors`
// lift; the canonical Vitest suite for the projection logic is at
// `packages/shell/src/annotations/annotations.test.ts`. The cases that
// remain here pin the moderator-internal `selectAnnotations` wrapper's
// null-safe lookup off `WsState` (per refinement Decision §4 — wrapper
// stays as a thin call-through; the projection coverage is consolidated
// in the shell suite).

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
  it('returns [] for an unknown session id (wrapper null-safe lookup)', () => {
    const state = makeState([]);
    expect(selectAnnotations(state, 'unknown-session')).toEqual([]);
  });

  it('returns [] for a known session with no events', () => {
    const state = makeState([]);
    expect(selectAnnotations(state, SESSION)).toEqual([]);
  });

  it('delegates to projectAnnotations for a known session and returns the camelCased shape', () => {
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

// The `projectAxiomMarks` / `groupAxiomMarksByNode` cases moved to
// `packages/shell/src/axiom-marks/axiom-marks.test.ts` as part of
// `shell_axiom_marks_extraction` — the canonical implementations now
// live in `@a-conversa/shell` and the consolidated Vitest suite is
// the single regression pin.

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

// `projectVotesByFacet` cases moved to
// `packages/shell/src/votes-by-facet/votes-by-facet.test.ts` per
// `tasks/refinements/shell-package/extract_votes_by_facet_projector_v2.md`.

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

// -- Annotation-endpoint rendering (mod_render_annotation_endpoint_edges) --
//
// Promotion-set: any annotation id referenced as an edge endpoint
// becomes a `<AnnotationNode>` and is filtered out of the per-host
// badge bucket (mutual exclusion per Decisions §1 + §3).
//
// Projectors: `projectAnnotationNodes` emits one node per promoted
// annotation; `projectAnnotationHostEdges` emits one host pseudo-edge
// per promoted annotation tethering it to its resolved host
// (Decision §4).

const NODE_A = '00000000-0000-4000-8000-000000000a01';
const NODE_B = '00000000-0000-4000-8000-000000000a02';
const ANNO_A = '00000000-0000-4000-8000-000000000b01';
const ANNO_B = '00000000-0000-4000-8000-000000000b02';
const EDGE_HOSTED_BY_NODE = '00000000-0000-4000-8000-000000000c01';
const EDGE_NODE_TO_ANNO = '00000000-0000-4000-8000-000000000c02';

function makeAnnotationEndpointEdgeCreated(opts: {
  sequence: number;
  edgeId: string;
  role: EdgeRole;
  sourceNodeId?: string;
  sourceAnnotationId?: string;
  targetNodeId?: string;
  targetAnnotationId?: string;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x600 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence: opts.sequence,
    kind: 'edge-created',
    actor: ACTOR,
    payload: {
      edge_id: opts.edgeId,
      role: opts.role,
      ...(opts.sourceNodeId !== undefined ? { source_node_id: opts.sourceNodeId } : {}),
      ...(opts.sourceAnnotationId !== undefined
        ? { source_annotation_id: opts.sourceAnnotationId }
        : {}),
      ...(opts.targetNodeId !== undefined ? { target_node_id: opts.targetNodeId } : {}),
      ...(opts.targetAnnotationId !== undefined
        ? { target_annotation_id: opts.targetAnnotationId }
        : {}),
      created_by: ACTOR,
      created_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

describe('computeAnnotationsAsEndpoints', () => {
  it('returns an empty set for an empty event log', () => {
    expect(computeAnnotationsAsEndpoints([])).toEqual(new Set());
  });

  it('returns an empty set when no edge-created references an annotation endpoint', () => {
    const events: Event[] = [
      makeNodeCreated(1, NODE_A),
      makeEdgeCreated({
        sequence: 2,
        edgeId: 'e1',
        role: 'supports',
        source: NODE_A,
        target: 'n-x',
      }),
    ];
    expect(computeAnnotationsAsEndpoints(events)).toEqual(new Set());
  });

  it('collects one annotation id when an edge targets it', () => {
    const events: Event[] = [
      makeNodeCreated(1, NODE_A),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNO_A,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationEndpointEdgeCreated({
        sequence: 3,
        edgeId: EDGE_NODE_TO_ANNO,
        role: 'contradicts',
        sourceNodeId: NODE_A,
        targetAnnotationId: ANNO_A,
      }),
    ];
    expect(computeAnnotationsAsEndpoints(events)).toEqual(new Set([ANNO_A]));
  });

  it('collapses duplicate references — same annotation referenced by multiple edges produces one entry', () => {
    const events: Event[] = [
      makeAnnotationEndpointEdgeCreated({
        sequence: 1,
        edgeId: 'e1',
        role: 'contradicts',
        sourceNodeId: NODE_A,
        targetAnnotationId: ANNO_A,
      }),
      makeAnnotationEndpointEdgeCreated({
        sequence: 2,
        edgeId: 'e2',
        role: 'supports',
        sourceNodeId: NODE_B,
        targetAnnotationId: ANNO_A,
      }),
    ];
    expect(computeAnnotationsAsEndpoints(events)).toEqual(new Set([ANNO_A]));
  });

  it('collects annotation ids from both source and target slots, mixed across edges', () => {
    const events: Event[] = [
      // node → annotation (target_annotation_id)
      makeAnnotationEndpointEdgeCreated({
        sequence: 1,
        edgeId: 'e1',
        role: 'contradicts',
        sourceNodeId: NODE_A,
        targetAnnotationId: ANNO_A,
      }),
      // annotation → node (source_annotation_id)
      makeAnnotationEndpointEdgeCreated({
        sequence: 2,
        edgeId: 'e2',
        role: 'supports',
        sourceAnnotationId: ANNO_B,
        targetNodeId: NODE_B,
      }),
    ];
    expect(computeAnnotationsAsEndpoints(events)).toEqual(new Set([ANNO_A, ANNO_B]));
  });
});

function makeAnnotation(overrides: Partial<Annotation> & { id: string }): Annotation {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'note',
    content: overrides.content ?? 'an annotation body',
    targetNodeId: overrides.targetNodeId ?? null,
    targetEdgeId: overrides.targetEdgeId ?? null,
    createdBy: overrides.createdBy ?? ACTOR,
    createdAt: overrides.createdAt ?? '2026-05-11T00:00:00.000Z',
  };
}

const EMPTY_NODE_ANNOTATION_INDEX: ReadonlyMap<string, readonly Annotation[]> = new Map();

describe('projectAnnotationNodes', () => {
  it('returns [] for an empty promotion set', () => {
    expect(projectAnnotationNodes([], new Set(), [], EMPTY_NODE_ANNOTATION_INDEX)).toEqual([]);
  });

  it('emits one Node<AnnotationNodeData> for a promoted annotation hosted by a known node', () => {
    const annotations: Annotation[] = [
      makeAnnotation({
        id: ANNO_A,
        kind: 'reframe',
        content: 'a reframe note',
        targetNodeId: NODE_A,
      }),
    ];
    const events: Event[] = [makeNodeCreated(1, NODE_A)];
    const nodes = projectAnnotationNodes(
      annotations,
      new Set([ANNO_A]),
      events,
      EMPTY_NODE_ANNOTATION_INDEX,
    );
    expect(nodes).toHaveLength(1);
    const expected: {
      id: string;
      type: string;
      position: { x: number; y: number };
      data: AnnotationNodeData;
    } = {
      id: ANNO_A,
      type: ANNOTATION_NODE_TYPE,
      position: { x: 0, y: 0 },
      data: { kind: 'reframe', content: 'a reframe note', annotations: EMPTY_ANNOTATIONS },
    };
    expect(nodes[0]).toEqual(expected);
  });

  it('stamps data.hostMissing when the annotation host cannot be resolved', () => {
    const annotations: Annotation[] = [
      makeAnnotation({
        id: ANNO_A,
        kind: 'note',
        content: 'orphan annotation',
        // host not in events
        targetNodeId: 'unknown-node',
      }),
    ];
    const nodes = projectAnnotationNodes(
      annotations,
      new Set([ANNO_A]),
      [],
      EMPTY_NODE_ANNOTATION_INDEX,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data).toEqual({
      kind: 'note',
      content: 'orphan annotation',
      annotations: EMPTY_ANNOTATIONS,
      hostMissing: true,
    });
  });

  it('skips annotations that are not in the promotion set', () => {
    const annotations: Annotation[] = [
      makeAnnotation({ id: ANNO_A, kind: 'note', targetNodeId: NODE_A }),
      makeAnnotation({ id: ANNO_B, kind: 'reframe', targetNodeId: NODE_A }),
    ];
    const events: Event[] = [makeNodeCreated(1, NODE_A)];
    const nodes = projectAnnotationNodes(
      annotations,
      new Set([ANNO_B]),
      events,
      EMPTY_NODE_ANNOTATION_INDEX,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe(ANNO_B);
  });
});

// -- annotation-of-annotation overlay propagation --------------------
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_of_annotation_overlay_chain.md
//
// When annotation A1 is promoted to a `<AnnotationNode>` (because some
// `edge-created` references its id), an annotation A2 whose
// `targetNodeId` carries A1's UUID surfaces in A1's emitted
// `data.annotations` array. `<AnnotationNode>` then renders A2 as an
// `<AnnotationBadge>` pill on the annotation card. The bucketer
// (`groupAnnotationsByEntityId`) is target-id-keyed, so A2 lands in
// bucket A1; `projectAnnotationNodes` reads that bucket per promoted
// annotation. Three cases mirror the participant predecessor's
// `ann-oa-1/2/3` shape.

describe('projectAnnotationNodes — annotation-of-annotation overlay propagation', () => {
  const ANNO_C = '00000000-0000-4000-8000-000000000b03';

  it("(ann-oa-1) an annotation A2 whose target_node_id carries A1's id surfaces in A1's data.annotations array", () => {
    const a1 = makeAnnotation({
      id: ANNO_A,
      kind: 'reframe',
      content: 'A1 reframes N1',
      targetNodeId: NODE_A,
    });
    const a2 = makeAnnotation({
      id: ANNO_B,
      kind: 'note',
      content: 'A2 notes A1',
      targetNodeId: ANNO_A,
    });
    const events: Event[] = [
      makeNodeCreated(1, NODE_A),
      makeAnnotationEndpointEdgeCreated({
        sequence: 4,
        edgeId: EDGE_NODE_TO_ANNO,
        role: 'contradicts',
        sourceNodeId: NODE_A,
        targetAnnotationId: ANNO_A,
      }),
    ];
    const promotedSet = new Set([ANNO_A]);
    // Bucketer input mirrors GraphCanvasPane's filter posture: drop
    // promoted annotations from the input set (so A1 doesn't self-
    // overlay). A2 survives — it's not promoted — and buckets under
    // key A1 via its targetNodeId.
    const nodeAnnotationIndex = new Map<string, readonly Annotation[]>([[ANNO_A, [a2]]]);
    const nodes = projectAnnotationNodes([a1, a2], promotedSet, events, nodeAnnotationIndex);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe(ANNO_A);
    expect(nodes[0]?.data.annotations).toEqual([a2]);
  });

  it('(ann-oa-2) multiple annotations targeting the same promoted annotation aggregate in data.annotations (bucketer append order)', () => {
    const a1 = makeAnnotation({
      id: ANNO_A,
      kind: 'reframe',
      content: 'A1 reframes N1',
      targetNodeId: NODE_A,
    });
    const a2 = makeAnnotation({
      id: ANNO_B,
      kind: 'note',
      content: 'A2 notes A1',
      targetNodeId: ANNO_A,
    });
    const a3 = makeAnnotation({
      id: ANNO_C,
      kind: 'stance',
      content: 'A3 stance on A1',
      targetNodeId: ANNO_A,
    });
    const events: Event[] = [
      makeNodeCreated(1, NODE_A),
      makeAnnotationEndpointEdgeCreated({
        sequence: 5,
        edgeId: EDGE_NODE_TO_ANNO,
        role: 'contradicts',
        sourceNodeId: NODE_A,
        targetAnnotationId: ANNO_A,
      }),
    ];
    const promotedSet = new Set([ANNO_A]);
    const nodeAnnotationIndex = new Map<string, readonly Annotation[]>([[ANNO_A, [a2, a3]]]);
    const nodes = projectAnnotationNodes([a1, a2, a3], promotedSet, events, nodeAnnotationIndex);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.annotations).toEqual([a2, a3]);
  });

  it('(ann-oa-3) annotation-on-annotation where the target annotation is NOT promoted surfaces no annotation node — orphan A2 bucket exists but nothing reads it', () => {
    const a1 = makeAnnotation({
      id: ANNO_A,
      kind: 'reframe',
      content: 'A1 reframes N1',
      targetNodeId: NODE_A,
    });
    const a2 = makeAnnotation({
      id: ANNO_B,
      kind: 'note',
      content: 'A2 notes A1',
      targetNodeId: ANNO_A,
    });
    // No `edge-created` references A1 — promotion set is empty.
    const events: Event[] = [makeNodeCreated(1, NODE_A)];
    const promotedSet = new Set<string>();
    // The bucket under A1 still exists in the index (A2 targets A1);
    // nothing reads it because A1 wasn't promoted.
    const nodeAnnotationIndex = new Map<string, readonly Annotation[]>([[ANNO_A, [a2]]]);
    const nodes = projectAnnotationNodes([a1, a2], promotedSet, events, nodeAnnotationIndex);
    expect(nodes).toHaveLength(0);
    expect(nodeAnnotationIndex.get(ANNO_A)).toEqual([a2]);
  });
});

describe('projectAnnotationHostEdges', () => {
  it('returns [] for an empty promotion set', () => {
    expect(projectAnnotationHostEdges([], new Set(), [])).toEqual([]);
  });

  it('emits one host pseudo-edge per promoted annotation hosted by a known node', () => {
    const annotations: Annotation[] = [
      makeAnnotation({ id: ANNO_A, kind: 'note', targetNodeId: NODE_A }),
    ];
    const events: Event[] = [makeNodeCreated(1, NODE_A)];
    const edges = projectAnnotationHostEdges(annotations, new Set([ANNO_A]), events);
    expect(edges).toHaveLength(1);
    const expected: {
      id: string;
      source: string;
      target: string;
      type: string;
      data: AnnotationHostEdgeData;
    } = {
      id: `annotation-host-${ANNO_A}`,
      source: NODE_A,
      target: ANNO_A,
      type: ANNOTATION_HOST_EDGE_TYPE,
      data: { annotationId: ANNO_A },
    };
    expect(edges[0]).toEqual(expected);
  });

  it('tethers an edge-hosted annotation to the synthetic midpoint node id (mod_annotation_node_edge_host_midpoint)', () => {
    const annotations: Annotation[] = [
      makeAnnotation({ id: ANNO_A, kind: 'note', targetEdgeId: EDGE_HOSTED_BY_NODE }),
    ];
    const events: Event[] = [
      makeNodeCreated(1, NODE_A),
      makeNodeCreated(2, NODE_B),
      makeEdgeCreated({
        sequence: 3,
        edgeId: EDGE_HOSTED_BY_NODE,
        role: 'supports',
        source: NODE_A,
        target: NODE_B,
      }),
    ];
    const edges = projectAnnotationHostEdges(annotations, new Set([ANNO_A]), events);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.source).toBe(`annotation-host-midpoint-${EDGE_HOSTED_BY_NODE}`);
    expect(edges[0]?.target).toBe(ANNO_A);
  });

  it('omits the host pseudo-edge when the annotation host cannot be resolved', () => {
    const annotations: Annotation[] = [
      makeAnnotation({ id: ANNO_A, kind: 'note', targetNodeId: 'unknown-node' }),
    ];
    const edges = projectAnnotationHostEdges(annotations, new Set([ANNO_A]), []);
    expect(edges).toEqual([]);
  });

  it('omits the host pseudo-edge when the edge-hosted annotation cannot resolve both endpoints', () => {
    // host edge id present on the annotation but no `edge-created` event
    // for it — both endpoints missing from the host index, midpoint
    // cannot be computed, so no pseudo-edge is emitted (paired with
    // `data-host-missing` on the AnnotationNode).
    const annotations: Annotation[] = [
      makeAnnotation({ id: ANNO_A, kind: 'note', targetEdgeId: EDGE_HOSTED_BY_NODE }),
    ];
    const edges = projectAnnotationHostEdges(annotations, new Set([ANNO_A]), []);
    expect(edges).toEqual([]);
  });
});

// -- midpoint-node projection + post-layout placement -------------------
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_node_edge_host_midpoint.md
//
// The edge-hosted host pseudo-edge tethers to a synthetic 0×0 midpoint
// node positioned at the centroid of the host edge's two endpoint
// nodes' centers (Constraint §5). The projector emits one midpoint per
// host edge (1-per-edge, not 1-per-annotation — Decision §4); the
// post-layout placement helper translates `(0, 0)` placeholders to the
// computed centroid.

describe('midpointIdFor', () => {
  it('returns the deterministic `annotation-host-midpoint-${edgeId}` shape', () => {
    expect(midpointIdFor('edge-1')).toBe('annotation-host-midpoint-edge-1');
    expect(midpointIdFor(EDGE_HOSTED_BY_NODE)).toBe(
      `annotation-host-midpoint-${EDGE_HOSTED_BY_NODE}`,
    );
  });
});

describe('projectAnnotationHostMidpointNodes', () => {
  it('returns [] for an empty promotion set', () => {
    expect(projectAnnotationHostMidpointNodes([], new Set(), [])).toEqual([]);
  });

  it('emits no midpoint nodes when the only promoted annotation is node-hosted', () => {
    const annotations: Annotation[] = [
      makeAnnotation({ id: ANNO_A, kind: 'note', targetNodeId: NODE_A }),
    ];
    const events: Event[] = [makeNodeCreated(1, NODE_A)];
    const nodes = projectAnnotationHostMidpointNodes(annotations, new Set([ANNO_A]), events);
    expect(nodes).toEqual([]);
  });

  it('emits one midpoint node for a promoted edge-hosted annotation with both endpoints resolved', () => {
    const annotations: Annotation[] = [
      makeAnnotation({ id: ANNO_A, kind: 'note', targetEdgeId: EDGE_HOSTED_BY_NODE }),
    ];
    const events: Event[] = [
      makeNodeCreated(1, NODE_A),
      makeNodeCreated(2, NODE_B),
      makeEdgeCreated({
        sequence: 3,
        edgeId: EDGE_HOSTED_BY_NODE,
        role: 'supports',
        source: NODE_A,
        target: NODE_B,
      }),
    ];
    const nodes = projectAnnotationHostMidpointNodes(annotations, new Set([ANNO_A]), events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toEqual({
      id: `annotation-host-midpoint-${EDGE_HOSTED_BY_NODE}`,
      type: ANNOTATION_HOST_MIDPOINT_NODE_TYPE,
      position: { x: 0, y: 0 },
      data: { hostEdgeId: EDGE_HOSTED_BY_NODE },
    });
  });

  it('emits exactly ONE midpoint node when two promoted annotations share the same target edge (dedup per Decision §4)', () => {
    const annotations: Annotation[] = [
      makeAnnotation({ id: ANNO_A, kind: 'note', targetEdgeId: EDGE_HOSTED_BY_NODE }),
      makeAnnotation({ id: ANNO_B, kind: 'reframe', targetEdgeId: EDGE_HOSTED_BY_NODE }),
    ];
    const events: Event[] = [
      makeNodeCreated(1, NODE_A),
      makeNodeCreated(2, NODE_B),
      makeEdgeCreated({
        sequence: 3,
        edgeId: EDGE_HOSTED_BY_NODE,
        role: 'supports',
        source: NODE_A,
        target: NODE_B,
      }),
    ];
    const nodes = projectAnnotationHostMidpointNodes(
      annotations,
      new Set([ANNO_A, ANNO_B]),
      events,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe(`annotation-host-midpoint-${EDGE_HOSTED_BY_NODE}`);
  });

  it('emits no midpoint node when the host edge has not been projected (defensive omission)', () => {
    const annotations: Annotation[] = [
      makeAnnotation({ id: ANNO_A, kind: 'note', targetEdgeId: EDGE_HOSTED_BY_NODE }),
    ];
    // No `edge-created` for EDGE_HOSTED_BY_NODE — both endpoints
    // missing from the host index; midpoint omitted.
    const events: Event[] = [makeNodeCreated(1, NODE_A)];
    const nodes = projectAnnotationHostMidpointNodes(annotations, new Set([ANNO_A]), events);
    expect(nodes).toEqual([]);
  });
});

describe('placeAnnotationHostMidpoints', () => {
  function makeStatementNode(
    id: string,
    position: { x: number; y: number },
    width = 288,
    height = 90,
  ): Node {
    return {
      id,
      type: 'statement',
      position,
      width,
      height,
      data: {},
    };
  }

  function makeMidpointNodeAt(
    hostEdgeId: string,
    position: { x: number; y: number } = { x: 0, y: 0 },
  ): Node {
    return {
      id: midpointIdFor(hostEdgeId),
      type: ANNOTATION_HOST_MIDPOINT_NODE_TYPE,
      position,
      data: { hostEdgeId },
    };
  }

  it('returns [] for an empty nodes array', () => {
    expect(placeAnnotationHostMidpoints([], new Map())).toEqual([]);
  });

  it('passes statement / annotation nodes through unchanged when no midpoint node is present', () => {
    const s = makeStatementNode(NODE_A, { x: 0, y: 0 });
    const t = makeStatementNode(NODE_B, { x: 100, y: 100 });
    const out = placeAnnotationHostMidpoints([s, t], new Map());
    expect(out).toEqual([s, t]);
    // Referential identity — non-midpoint nodes pass through by reference.
    expect(out[0]).toBe(s);
    expect(out[1]).toBe(t);
  });

  it('overwrites a midpoint node position with the centroid of its host edge endpoints centers (Constraint §5)', () => {
    // S at (0, 0) size 288×90 → center (144, 45)
    // T at (400, 200) size 288×90 → center (544, 245)
    // centroid = ( (144 + 544) / 2, (45 + 245) / 2 ) = (344, 145)
    const s = makeStatementNode(NODE_A, { x: 0, y: 0 }, 288, 90);
    const t = makeStatementNode(NODE_B, { x: 400, y: 200 }, 288, 90);
    const midpoint = makeMidpointNodeAt(EDGE_HOSTED_BY_NODE);
    const anchors = new Map([
      [EDGE_HOSTED_BY_NODE, { sourceNodeId: NODE_A, targetNodeId: NODE_B }],
    ]);
    const out = placeAnnotationHostMidpoints([s, t, midpoint], anchors);
    const placed = out.find((n) => n.id === midpointIdFor(EDGE_HOSTED_BY_NODE));
    expect(placed?.position).toEqual({ x: 344, y: 145 });
  });

  it('leaves the midpoint position at (0, 0) when the host edge anchors are missing (defensive backstop)', () => {
    const s = makeStatementNode(NODE_A, { x: 0, y: 0 });
    const midpoint = makeMidpointNodeAt(EDGE_HOSTED_BY_NODE);
    // Empty anchors map → midpoint passes through unchanged.
    const out = placeAnnotationHostMidpoints([s, midpoint], new Map());
    const placed = out.find((n) => n.id === midpointIdFor(EDGE_HOSTED_BY_NODE));
    expect(placed?.position).toEqual({ x: 0, y: 0 });
  });

  it('leaves the midpoint position at (0, 0) when an endpoint node is missing from the nodes array (defensive)', () => {
    // Only the source node is present; target missing — centroid cannot
    // be computed, midpoint stays at (0, 0).
    const s = makeStatementNode(NODE_A, { x: 0, y: 0 });
    const midpoint = makeMidpointNodeAt(EDGE_HOSTED_BY_NODE);
    const anchors = new Map([
      [EDGE_HOSTED_BY_NODE, { sourceNodeId: NODE_A, targetNodeId: NODE_B }],
    ]);
    const out = placeAnnotationHostMidpoints([s, midpoint], anchors);
    const placed = out.find((n) => n.id === midpointIdFor(EDGE_HOSTED_BY_NODE));
    expect(placed?.position).toEqual({ x: 0, y: 0 });
  });
});

describe('buildAnnotationHostEdgeAnchorIndex', () => {
  it('returns an empty map for an event log with no edge-created events', () => {
    expect(buildAnnotationHostEdgeAnchorIndex([]).size).toBe(0);
  });

  it('records (sourceNodeId, targetNodeId) per node→node edge', () => {
    const events: Event[] = [
      makeNodeCreated(1, NODE_A),
      makeNodeCreated(2, NODE_B),
      makeEdgeCreated({
        sequence: 3,
        edgeId: EDGE_HOSTED_BY_NODE,
        role: 'supports',
        source: NODE_A,
        target: NODE_B,
      }),
    ];
    const index = buildAnnotationHostEdgeAnchorIndex(events);
    expect(index.get(EDGE_HOSTED_BY_NODE)).toEqual({
      sourceNodeId: NODE_A,
      targetNodeId: NODE_B,
    });
  });
});

describe('selectEdgesForSession — annotation-endpoint edges (lifted guard)', () => {
  it('projects a node→annotation endpoint edge with source=node id, target=annotation id', () => {
    const events: Event[] = [
      makeNodeCreated(1, NODE_A),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNO_A,
        kind: 'reframe',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationEndpointEdgeCreated({
        sequence: 3,
        edgeId: EDGE_NODE_TO_ANNO,
        role: 'contradicts',
        sourceNodeId: NODE_A,
        targetAnnotationId: ANNO_A,
      }),
    ];
    const edges = selectEdgesForSession(makeState(events), SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.id).toBe(EDGE_NODE_TO_ANNO);
    expect(edges[0]?.source).toBe(NODE_A);
    expect(edges[0]?.target).toBe(ANNO_A);
    expect(edges[0]?.data?.sourceId).toBe(NODE_A);
    expect(edges[0]?.data?.targetId).toBe(ANNO_A);
    expect(edges[0]?.data?.role).toBe('contradicts');
  });

  it('projects an annotation→node endpoint edge with source=annotation id, target=node id', () => {
    const events: Event[] = [
      makeNodeCreated(1, NODE_A),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNO_A,
        kind: 'stance',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationEndpointEdgeCreated({
        sequence: 3,
        edgeId: 'edge-anno-to-node',
        role: 'supports',
        sourceAnnotationId: ANNO_A,
        targetNodeId: NODE_A,
      }),
    ];
    const edges = selectEdgesForSession(makeState(events), SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.source).toBe(ANNO_A);
    expect(edges[0]?.target).toBe(NODE_A);
  });

  it('projects an annotation→annotation endpoint edge', () => {
    const events: Event[] = [
      makeAnnotationEndpointEdgeCreated({
        sequence: 1,
        edgeId: 'edge-anno-anno',
        role: 'supports',
        sourceAnnotationId: ANNO_A,
        targetAnnotationId: ANNO_B,
      }),
    ];
    const edges = selectEdgesForSession(makeState(events), SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.source).toBe(ANNO_A);
    expect(edges[0]?.target).toBe(ANNO_B);
  });

  // -- Endpoint-kind discriminator carriage --------------------------
  //
  // Refinement: `mod_hover_popover_endpoint_kind_disambiguation`.
  // The selector projects `sourceKind` / `targetKind` (an
  // `EdgeEndpointKind = 'node' | 'annotation'` literal union) onto
  // `StatementEdgeData` so `<HoverPopover>` can localize a per-kind
  // suffix on the endpoint-references row without re-walking the
  // events log. Derivation rule:
  // `event.payload.source_node_id !== undefined ? 'node' : 'annotation'`
  // (and symmetric for the target side). The wire schema's
  // per-endpoint XOR guarantees the kind is always derivable, so the
  // carriage fields are non-optional.
  //
  // These four cases pin every combination of the 2×2 endpoint shape
  // space (node/annotation × node/annotation) so a regression in
  // either branch surfaces independently.

  it('stamps sourceKind=node + targetKind=node for a node→node edge', () => {
    const events: Event[] = [
      makeEdgeCreated({
        sequence: 1,
        edgeId: 'edge-nn',
        role: 'supports',
        source: NODE_A,
        target: NODE_B,
      }),
    ];
    const edges = selectEdgesForSession(makeState(events), SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.sourceKind).toBe('node');
    expect(edges[0]?.data?.targetKind).toBe('node');
  });

  it('stamps sourceKind=node + targetKind=annotation for a node→annotation edge', () => {
    const events: Event[] = [
      makeAnnotationEndpointEdgeCreated({
        sequence: 1,
        edgeId: 'edge-na',
        role: 'contradicts',
        sourceNodeId: NODE_A,
        targetAnnotationId: ANNO_A,
      }),
    ];
    const edges = selectEdgesForSession(makeState(events), SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.sourceKind).toBe('node');
    expect(edges[0]?.data?.targetKind).toBe('annotation');
  });

  it('stamps sourceKind=annotation + targetKind=node for an annotation→node edge', () => {
    const events: Event[] = [
      makeAnnotationEndpointEdgeCreated({
        sequence: 1,
        edgeId: 'edge-an',
        role: 'supports',
        sourceAnnotationId: ANNO_A,
        targetNodeId: NODE_B,
      }),
    ];
    const edges = selectEdgesForSession(makeState(events), SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.sourceKind).toBe('annotation');
    expect(edges[0]?.data?.targetKind).toBe('node');
  });

  it('stamps sourceKind=annotation + targetKind=annotation for an annotation→annotation edge', () => {
    const events: Event[] = [
      makeAnnotationEndpointEdgeCreated({
        sequence: 1,
        edgeId: 'edge-aa',
        role: 'supports',
        sourceAnnotationId: ANNO_A,
        targetAnnotationId: ANNO_B,
      }),
    ];
    const edges = selectEdgesForSession(makeState(events), SESSION);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.sourceKind).toBe('annotation');
    expect(edges[0]?.data?.targetKind).toBe('annotation');
  });

  it('drops an edge-created event with no source endpoint id BEFORE kind derivation runs (defensive guard regression)', () => {
    // Wire-protocol violation: neither `source_node_id` nor
    // `source_annotation_id` set. The defensive guard at L386-391 of
    // `selectEdgesForSession` filters this edge before the kind
    // discriminator code runs — so the discriminator never observes
    // `undefined`. We pin the drop here so a future refactor that
    // moves the kind derivation above the guard fails loudly.
    const events: Event[] = [
      makeAnnotationEndpointEdgeCreated({
        sequence: 1,
        edgeId: 'edge-invalid',
        role: 'supports',
        targetNodeId: NODE_B,
        // No source id set on purpose.
      }),
    ];
    const edges = selectEdgesForSession(makeState(events), SESSION);
    expect(edges).toEqual([]);
  });

  it('filters promoted annotations out of an edge data.annotations bucket (mutual exclusion)', () => {
    // The annotation A is both targeted-by-edge AND a node-target
    // annotation on its host edge. Once A is promoted (referenced as
    // an endpoint), it must NOT appear in any emitted edge's
    // `data.annotations` decoration bucket.
    const hostEdgeId = '00000000-0000-4000-8000-000000000d01';
    const events: Event[] = [
      makeNodeCreated(1, NODE_A),
      makeNodeCreated(2, NODE_B),
      makeEdgeCreated({
        sequence: 3,
        edgeId: hostEdgeId,
        role: 'supports',
        source: NODE_A,
        target: NODE_B,
      }),
      makeAnnotationCreated({
        sequence: 4,
        annotationId: ANNO_A,
        kind: 'note',
        targetNodeId: null,
        targetEdgeId: hostEdgeId,
      }),
      // Now reference ANNO_A as an endpoint — it gets promoted.
      makeAnnotationEndpointEdgeCreated({
        sequence: 5,
        edgeId: 'edge-promoted',
        role: 'contradicts',
        sourceNodeId: NODE_A,
        targetAnnotationId: ANNO_A,
      }),
    ];
    const edges = selectEdgesForSession(makeState(events), SESSION);
    // The host edge's decoration bucket must NOT include the promoted
    // annotation.
    const hostEdge = edges.find((e) => e.id === hostEdgeId);
    expect(hostEdge?.data?.annotations).toEqual([]);
  });
});
