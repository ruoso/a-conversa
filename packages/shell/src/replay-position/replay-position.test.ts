// Contract-mirroring truth table for the client replay-position port.
//
// Refinement: tasks/refinements/replay_test/test_mode_timeline_scrubber.md
// ADR:        docs/adr/0043-client-side-replay-position-navigation-in-shell.md
//
// Enumerates the same boundary cases as the server primitive's truth table
// (apps/server/src/projection/position-navigation.test.ts). If the two
// contracts drift, one side's test fails (ADR 0043). Adds the client-only
// `clampPosition` cases the server primitive deliberately omitted.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import {
  clampPosition,
  isAtEnd,
  isAtStart,
  nextPosition,
  prevPosition,
  ReplayPositionError,
  replayHeadSequence,
} from './replay-position.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function evId(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

// Six contiguous events (sequences 1..6); head sequence is 6.
function buildLog(): Event[] {
  return Array.from(
    { length: 6 },
    (_unused, index): Event =>
      ({
        id: evId(index + 1),
        sessionId: SESSION_ID,
        sequence: index + 1,
        kind: 'node-created',
        actor: SESSION_ID,
        payload: {},
        createdAt: `2026-05-10T12:00:0${String(index)}Z`,
      }) as unknown as Event,
  );
}

const HEAD = 6;

describe('replayHeadSequence', () => {
  it('is 0 for an empty log', () => {
    expect(replayHeadSequence([])).toBe(0);
  });

  it('is the last event sequence for an ascending log', () => {
    expect(replayHeadSequence(buildLog())).toBe(HEAD);
  });
});

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
      expect(steps).toBeLessThanOrEqual(HEAD);
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
    expect(isAtStart(0)).toBe(true);
    expect(isAtStart(1)).toBe(false);
    expect(isAtStart(HEAD)).toBe(false);
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

describe('clampPosition (client-only)', () => {
  it('floors NaN to 0', () => {
    expect(clampPosition(Number.NaN, buildLog())).toBe(0);
  });

  it('floors negatives to 0', () => {
    expect(clampPosition(-5, buildLog())).toBe(0);
  });

  it('clamps beyond-head values to the head', () => {
    expect(clampPosition(HEAD + 10, buildLog())).toBe(HEAD);
  });

  it('truncates fractional values toward zero', () => {
    expect(clampPosition(3.9, buildLog())).toBe(3);
  });

  it('leaves in-range integers unchanged', () => {
    expect(clampPosition(4, buildLog())).toBe(4);
  });

  it('clamps everything to 0 on an empty log', () => {
    expect(clampPosition(7, [])).toBe(0);
    expect(clampPosition(0, [])).toBe(0);
  });
});
