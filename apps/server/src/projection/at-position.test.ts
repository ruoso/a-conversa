import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { projectAtPosition, ReplayPositionError } from './at-position.js';
import { type Projection, projectFromLog } from './index.js';
import { OutOfOrderEventError } from './replay.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';

const NODE_ID_1 = '66666666-6666-4666-8666-666666666666';
const NODE_ID_2 = '77777777-7777-4777-8777-777777777777';
const EDGE_ID_1 = '99999999-9999-4999-8999-999999999999';
const SNAPSHOT_ID_1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const T0 = '2026-05-10T12:00:00Z';
const T1 = '2026-05-10T12:00:01Z';
const T2 = '2026-05-10T12:00:02Z';
const T3 = '2026-05-10T12:00:03Z';
const T4 = '2026-05-10T12:00:04Z';

function evId(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

function makeEvent<K extends Event['kind']>(
  sequence: number,
  kind: K,
  actor: string | null,
  createdAt: string,
  payload: Extract<Event, { kind: K }>['payload'],
): Extract<Event, { kind: K }> {
  return {
    id: evId(sequence),
    sessionId: SESSION_ID,
    sequence,
    kind,
    actor,
    payload,
    createdAt,
  } as Extract<Event, { kind: K }>;
}

function buildLog(): Event[] {
  return [
    makeEvent(1, 'session-created', HOST_ID, T0, {
      host_user_id: HOST_ID,
      privacy: 'public',
      topic: 'Test debate',
      created_at: T0,
    }),
    makeEvent(2, 'participant-joined', MODERATOR_ID, T1, {
      user_id: MODERATOR_ID,
      role: 'moderator',
      screen_name: 'Mod',
      joined_at: T1,
    }),
    makeEvent(3, 'node-created', DEBATER_A_ID, T2, {
      node_id: NODE_ID_1,
      wording: 'Claim A',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
    makeEvent(4, 'snapshot-created', MODERATOR_ID, T3, {
      snapshot_id: SNAPSHOT_ID_1,
      label: 'midpoint',
      log_position: 3,
    }),
    makeEvent(5, 'node-created', DEBATER_A_ID, T4, {
      node_id: NODE_ID_2,
      wording: 'Claim B',
      created_by: DEBATER_A_ID,
      created_at: T4,
    }),
    makeEvent(6, 'edge-created', DEBATER_A_ID, T4, {
      edge_id: EDGE_ID_1,
      role: 'supports',
      source_node_id: NODE_ID_1,
      target_node_id: NODE_ID_2,
      created_by: DEBATER_A_ID,
      created_at: T4,
    }),
  ];
}

function projectionFingerprint(p: Projection): string {
  const nodes = [...p.nodes()]
    .map((n) => ({ id: n.id, wording: n.wording, visible: n.visible }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...p.edges()]
    .map((e) => ({
      id: e.id,
      role: e.role,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      visible: e.visible,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const snapshots = [...p.snapshots()]
    .map((s) => ({ id: s.snapshotId, label: s.label, logPosition: s.logPosition }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const participants = [...p.currentParticipants()]
    .map((pp) => ({ userId: pp.userId, role: pp.role }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
  return JSON.stringify({
    sessionState: p.sessionState,
    lastAppliedSequence: p.lastAppliedSequence,
    nodes,
    edges,
    snapshots,
    participants,
  });
}

describe('projectAtPosition', () => {
  it('returns the empty baseline for position 0 on an empty log', () => {
    const projection = projectAtPosition([], SESSION_ID, 0);

    expect(projection.sessionId).toBe(SESSION_ID);
    expect(projection.sessionState).toBe('open');
    expect(projection.lastAppliedSequence).toBe(0);
    expect(projection.nodeCount()).toBe(0);
    expect(projection.edgeCount()).toBe(0);
    expect(projection.snapshotCount()).toBe(0);
    expect(projection.participantCount()).toBe(0);
  });

  it('replays only the requested prefix and leaves later events absent', () => {
    const projection = projectAtPosition(buildLog(), SESSION_ID, 3);

    expect(projection.lastAppliedSequence).toBe(3);
    expect(projection.getNode(NODE_ID_1)?.wording).toBe('Claim A');
    expect(projection.getNode(NODE_ID_2)).toBeUndefined();
    expect(projection.getEdge(EDGE_ID_1)).toBeUndefined();
    expect(projection.getSnapshot(SNAPSHOT_ID_1)).toBeUndefined();
  });

  it('matches projectFromLog at the log head', () => {
    const events = buildLog();
    const head = events[events.length - 1]!.sequence;

    expect(projectionFingerprint(projectAtPosition(events, SESSION_ID, head))).toBe(
      projectionFingerprint(projectFromLog(events, SESSION_ID)),
    );
  });

  it('includes snapshots only at or after the snapshot-created event', () => {
    const events = buildLog();

    expect(projectAtPosition(events, SESSION_ID, 3).getSnapshot(SNAPSHOT_ID_1)).toBeUndefined();
    expect(projectAtPosition(events, SESSION_ID, 4).getSnapshot(SNAPSHOT_ID_1)?.label).toBe(
      'midpoint',
    );
    expect(projectAtPosition(events, SESSION_ID, 5).getSnapshot(SNAPSHOT_ID_1)?.logPosition).toBe(
      3,
    );
  });

  it('rejects negative, fractional, and beyond-head positions', () => {
    const events = buildLog();

    expect(() => projectAtPosition(events, SESSION_ID, -1)).toThrow(ReplayPositionError);
    expect(() => projectAtPosition(events, SESSION_ID, 2.5)).toThrow(ReplayPositionError);
    expect(() => projectAtPosition(events, SESSION_ID, 7)).toThrow(ReplayPositionError);
    expect(() => projectAtPosition([], SESSION_ID, 1)).toThrow(ReplayPositionError);
  });

  it('surfaces replay consistency faults from the existing dispatcher', () => {
    const events = [
      makeEvent(1, 'session-created', HOST_ID, T0, {
        host_user_id: HOST_ID,
        privacy: 'public',
        topic: 'Test debate',
        created_at: T0,
      }),
      makeEvent(3, 'participant-joined', MODERATOR_ID, T1, {
        user_id: MODERATOR_ID,
        role: 'moderator',
        screen_name: 'Mod',
        joined_at: T1,
      }),
    ];

    expect(() => projectAtPosition(events, SESSION_ID, 3)).toThrow(OutOfOrderEventError);
  });
});
