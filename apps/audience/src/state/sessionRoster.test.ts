// Vitest cases for `sessionRoster.ts`.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §4 — duplicate-for-v0 of `participantRosterFrom`; the
//   case shape mirrors `apps/participant/src/detail/participantRoster.test.ts`
//   so a future shell extraction has a single combined test surface
//   to consume.)
//
// Five cases:
//   (a) empty events → `EMPTY_AUDIENCE_ROSTER` identity,
//   (b) one join sets entry,
//   (c) second join with the same user_id overrides screen name,
//   (d) join + leave deletes the entry,
//   (e) out-of-order left-before-join is a no-op.

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { EMPTY_AUDIENCE_ROSTER, sessionRosterFrom } from './sessionRoster.js';

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const ALICE_ID = '00000000-0000-4000-8000-000000000001';
const BEN_ID = '00000000-0000-4000-8000-000000000002';

function joinedEvent(opts: {
  sequence: number;
  userId: string;
  screenName: string;
  role?: 'moderator' | 'debater-A' | 'debater-B';
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x500 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'participant-joined',
    actor: opts.userId,
    payload: {
      user_id: opts.userId,
      role: opts.role ?? 'debater-A',
      screen_name: opts.screenName,
      joined_at: '2026-05-18T00:00:00.000Z',
    },
    createdAt: '2026-05-18T00:00:00.000Z',
  };
}

function leftEvent(opts: { sequence: number; userId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x600 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'participant-left',
    actor: opts.userId,
    payload: {
      user_id: opts.userId,
      left_at: '2026-05-18T00:01:00.000Z',
    },
    createdAt: '2026-05-18T00:01:00.000Z',
  };
}

describe('sessionRosterFrom', () => {
  it('(a) returns the EMPTY_AUDIENCE_ROSTER stable reference for an empty event log', () => {
    const result = sessionRosterFrom([]);
    expect(result).toBe(EMPTY_AUDIENCE_ROSTER);
    expect(result.size).toBe(0);
  });

  it('(b) builds a one-entry roster from a single participant-joined event', () => {
    const result = sessionRosterFrom([
      joinedEvent({ sequence: 1, userId: ALICE_ID, screenName: 'alice' }),
    ]);
    expect(result.size).toBe(1);
    expect(result.get(ALICE_ID)).toBe('alice');
  });

  it('(c) overrides the screen name when a second participant-joined fires for the same user_id (rejoin)', () => {
    const result = sessionRosterFrom([
      joinedEvent({ sequence: 1, userId: ALICE_ID, screenName: 'alice' }),
      joinedEvent({ sequence: 2, userId: ALICE_ID, screenName: 'alice-reborn' }),
    ]);
    expect(result.size).toBe(1);
    expect(result.get(ALICE_ID)).toBe('alice-reborn');
  });

  it('(d) drops the entry when participant-joined is followed by participant-left for the same user_id', () => {
    const result = sessionRosterFrom([
      joinedEvent({ sequence: 1, userId: ALICE_ID, screenName: 'alice' }),
      joinedEvent({ sequence: 2, userId: BEN_ID, screenName: 'ben', role: 'debater-B' }),
      leftEvent({ sequence: 3, userId: ALICE_ID }),
    ]);
    expect(result.size).toBe(1);
    expect(result.get(ALICE_ID)).toBeUndefined();
    expect(result.get(BEN_ID)).toBe('ben');
  });

  it('(e) treats a participant-left arriving before its participant-joined as a no-op (out-of-order tolerant)', () => {
    const result = sessionRosterFrom([
      leftEvent({ sequence: 1, userId: ALICE_ID }),
      joinedEvent({ sequence: 2, userId: ALICE_ID, screenName: 'alice' }),
    ]);
    expect(result.size).toBe(1);
    expect(result.get(ALICE_ID)).toBe('alice');
  });
});
