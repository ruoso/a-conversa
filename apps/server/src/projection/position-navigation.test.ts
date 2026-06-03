import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { projectAtPosition } from './at-position.js';
import { isAtEnd, isAtStart, nextPosition, prevPosition, ReplayPositionError } from './index.js';

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

// Six contiguous events (sequences 1..6); head sequence is 6.
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

const HEAD = 6;

describe('nextPosition', () => {
  it('steps +1 from the pre-history baseline', () => {
    expect(nextPosition(buildLog(), 0)).toBe(1);
  });

  it('steps +1 mid-log', () => {
    expect(nextPosition(buildLog(), 3)).toBe(4);
  });

  it('saturates at the head', () => {
    expect(nextPosition(buildLog(), HEAD)).toBe(HEAD);
  });

  it('saturates at 0 on an empty log', () => {
    expect(nextPosition([], 0)).toBe(0);
  });

  it('throws ReplayPositionError for non-integer, negative, or beyond-head current positions', () => {
    const events = buildLog();
    expect(() => nextPosition(events, 2.5)).toThrow(ReplayPositionError);
    expect(() => nextPosition(events, -1)).toThrow(ReplayPositionError);
    expect(() => nextPosition(events, HEAD + 1)).toThrow(ReplayPositionError);
    expect(() => nextPosition([], 1)).toThrow(ReplayPositionError);
  });
});

describe('prevPosition', () => {
  it('steps -1 from the head', () => {
    expect(prevPosition(buildLog(), HEAD)).toBe(HEAD - 1);
  });

  it('steps -1 to the baseline', () => {
    expect(prevPosition(buildLog(), 1)).toBe(0);
  });

  it('saturates at 0', () => {
    expect(prevPosition(buildLog(), 0)).toBe(0);
  });

  it('saturates at 0 on an empty log', () => {
    expect(prevPosition([], 0)).toBe(0);
  });

  it('throws ReplayPositionError for non-integer, negative, or beyond-head current positions', () => {
    const events = buildLog();
    expect(() => prevPosition(events, 2.5)).toThrow(ReplayPositionError);
    expect(() => prevPosition(events, -1)).toThrow(ReplayPositionError);
    expect(() => prevPosition(events, HEAD + 1)).toThrow(ReplayPositionError);
    expect(() => prevPosition([], 1)).toThrow(ReplayPositionError);
  });
});

describe('forward / backward walks', () => {
  it('reaches the head from 0 in exactly head steps, visiting every sequence once', () => {
    const events = buildLog();
    const visited: number[] = [0];
    let position = 0;
    let steps = 0;
    while (!isAtEnd(events, position)) {
      position = nextPosition(events, position);
      visited.push(position);
      steps += 1;
      expect(steps).toBeLessThanOrEqual(HEAD); // guard against a non-terminating walk
    }
    expect(steps).toBe(HEAD);
    expect(visited).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('reaches 0 from the head in exactly head steps, visiting every sequence once', () => {
    const events = buildLog();
    const visited: number[] = [HEAD];
    let position = HEAD;
    let steps = 0;
    while (!isAtStart(position)) {
      position = prevPosition(events, position);
      visited.push(position);
      steps += 1;
      expect(steps).toBeLessThanOrEqual(HEAD);
    }
    expect(steps).toBe(HEAD);
    expect(visited).toEqual([6, 5, 4, 3, 2, 1, 0]);
  });
});

describe('isAtStart / isAtEnd', () => {
  it('isAtStart is true iff position is 0', () => {
    const events = buildLog();
    expect(isAtStart(0)).toBe(true);
    expect(isAtStart(1)).toBe(false);
    expect(isAtStart(HEAD)).toBe(false);
    // independent of the log
    expect(isAtStart(0)).toBe(true);
    void events;
  });

  it('isAtEnd is true iff position is the head sequence', () => {
    const events = buildLog();
    expect(isAtEnd(events, HEAD)).toBe(true);
    expect(isAtEnd(events, HEAD - 1)).toBe(false);
    expect(isAtEnd(events, 0)).toBe(false);
  });

  it('treats position 0 on an empty log as simultaneously at-start and at-end', () => {
    expect(isAtStart(0)).toBe(true);
    expect(isAtEnd([], 0)).toBe(true);
  });
});

describe('composition with projectAtPosition', () => {
  it('stepping forward from 0 and projecting at each stop yields lastAppliedSequence === stop', () => {
    const events = buildLog();
    let position = 0;

    expect(projectAtPosition(events, SESSION_ID, position).lastAppliedSequence).toBe(0);
    while (!isAtEnd(events, position)) {
      position = nextPosition(events, position);
      const projection = projectAtPosition(events, SESSION_ID, position);
      expect(projection.lastAppliedSequence).toBe(position);
    }
    expect(position).toBe(HEAD);
  });
});
