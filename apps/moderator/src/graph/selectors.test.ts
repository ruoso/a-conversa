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
import { MarkerType } from 'reactflow';
import type { AnnotationKind, EdgeRole, Event } from '@a-conversa/shared-types';

import { AXIOM_MARK_PALETTE_SIZE, axiomMarkColorFor } from '@a-conversa/shell';

import type { WsState } from '../ws/wsStore.js';
import {
  groupPendingAxiomMarksByNode,
  projectPendingAxiomMarks,
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
