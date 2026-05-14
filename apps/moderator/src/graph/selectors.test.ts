// Tests for `selectEdgesForSession` — the pure projection from the WS
// event log to the ReactFlow edge list.
//
// Refinement: tasks/refinements/moderator-ui/mod_edge_rendering.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// The selector is the load-bearing surface between the WS store and the
// canvas; pinning its behaviour with unit tests means a regression here
// surfaces independently from a React render.
//
// Cases:
//   1. Unknown sessionId returns [].
//   2. Known session with empty event log returns [].
//   3. Single `edge-created` projects to a single ReactFlow `Edge` with
//      `id`/`source`/`target`/`type`/`data.role` mapped from the payload.
//   4. Multiple `edge-created` events project in arrival order.
//   5. Mixed event log: only `edge-created` events appear in the output.
//   6. Every one of the seven `EdgeRole` values round-trips intact onto
//      `data.role` (covers `supports` / `rebuts` / `qualifies` /
//      `bridges-from` / `bridges-to` / `defines` / `contradicts`).

import { describe, expect, it } from 'vitest';
import type { EdgeRole, Event } from '@a-conversa/shared-types';

import type { WsState } from '../ws/wsStore.js';
import { selectEdgesForSession } from './selectors.js';

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
      data: { role: 'supports' },
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
});
