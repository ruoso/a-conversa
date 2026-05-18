// Vitest cases for `participantRoster.ts`.
//
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel.md
//              (six cases per the Constraints sketch — empty events,
//              one joined, two joined, joined-then-left, joined-left-
//              rejoined, screenNameFor fallback discrimination).

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import {
  EMPTY_PARTICIPANT_ROSTER,
  participantRosterFrom,
  screenNameFor,
} from './participantRoster';

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
      joined_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
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
      left_at: '2026-05-17T00:01:00.000Z',
    },
    createdAt: '2026-05-17T00:01:00.000Z',
  };
}

describe('participantRosterFrom', () => {
  it('(a) returns the EMPTY_PARTICIPANT_ROSTER stable reference for an empty event log', () => {
    const result = participantRosterFrom([]);
    expect(result).toBe(EMPTY_PARTICIPANT_ROSTER);
    expect(result.size).toBe(0);
  });

  it('(b) builds a one-entry roster from a single participant-joined event', () => {
    const result = participantRosterFrom([
      joinedEvent({ sequence: 1, userId: ALICE_ID, screenName: 'alice' }),
    ]);
    expect(result.size).toBe(1);
    expect(result.get(ALICE_ID)).toBe('alice');
  });

  it('(c) carries both entries when two participants join for different user ids', () => {
    const result = participantRosterFrom([
      joinedEvent({ sequence: 1, userId: ALICE_ID, screenName: 'alice', role: 'debater-A' }),
      joinedEvent({ sequence: 2, userId: BEN_ID, screenName: 'ben', role: 'debater-B' }),
    ]);
    expect(result.size).toBe(2);
    expect(result.get(ALICE_ID)).toBe('alice');
    expect(result.get(BEN_ID)).toBe('ben');
  });

  it('(d) drops the entry when participant-joined is followed by participant-left for the same user_id', () => {
    const result = participantRosterFrom([
      joinedEvent({ sequence: 1, userId: ALICE_ID, screenName: 'alice' }),
      leftEvent({ sequence: 2, userId: ALICE_ID }),
    ]);
    expect(result.size).toBe(0);
    expect(result.get(ALICE_ID)).toBeUndefined();
  });

  it('(e) restores the entry on a rejoin (joined → left → joined surfaces the latest screen name)', () => {
    const result = participantRosterFrom([
      joinedEvent({ sequence: 1, userId: ALICE_ID, screenName: 'alice' }),
      leftEvent({ sequence: 2, userId: ALICE_ID }),
      joinedEvent({ sequence: 3, userId: ALICE_ID, screenName: 'alice-reborn' }),
    ]);
    expect(result.size).toBe(1);
    expect(result.get(ALICE_ID)).toBe('alice-reborn');
  });
});

describe('screenNameFor', () => {
  it('(f) returns the roster entry when present; falls back to the fallback arg; falls back to the raw userId when no fallback', () => {
    const roster = new Map<string, string>([[ALICE_ID, 'alice']]);

    // Entry present — roster wins.
    expect(screenNameFor(roster, ALICE_ID)).toBe('alice');
    expect(screenNameFor(roster, ALICE_ID, '(unknown)')).toBe('alice');

    // Entry absent + fallback provided — fallback wins.
    expect(screenNameFor(roster, BEN_ID, '(unknown user)')).toBe('(unknown user)');

    // Entry absent + no fallback — raw userId is the floor (never an
    // empty string; the panel always has SOMETHING to render).
    expect(screenNameFor(roster, BEN_ID)).toBe(BEN_ID);

    // Empty-string fallback is treated as "no fallback" — the userId
    // floor still applies. Prevents a stray empty-string render.
    expect(screenNameFor(roster, BEN_ID, '')).toBe(BEN_ID);
  });
});
