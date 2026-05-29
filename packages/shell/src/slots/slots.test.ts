// Vitest cases for the shell's slot-merge subsystem.
//
// Refinement: tasks/refinements/shell-package/shared_shell_extract_merge_slots_and_derive_slot_occupants.md
//   (predecessor coverage:
//      apps/moderator/src/routes/InviteParticipants.test.tsx (HTTP-prefetch
//        + merge-collision + both-debaters-prefetched cases — kept at the
//        route-level for the integrated render path; the helper-level
//        semantics they exercise are pinned here at the unit level),
//      apps/participant/src/routes/LobbyRoute.test.tsx (the
//        stale-leave / WS-absence-propagation cases — same posture).)
//
// Per ADR 0022 these are committed regression probes. Two `describe`
// blocks separate the two public functions; the seed-log scaffolding is
// shared at the top of the file. Cases enumerate the union of behaviour
// pinned by the predecessor suites, deduplicated by what they pin (not
// by which surface they originally lived in).

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import {
  SLOT_ROLES,
  deriveSlotOccupants,
  mergeSlots,
  type ParticipantRow,
  type SlotOccupants,
} from './slots.js';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const MOD_USER = '00000000-0000-4000-8000-000000000001';
const USER_A = '00000000-0000-4000-8000-0000000000a1';
const USER_B = '00000000-0000-4000-8000-0000000000a2';
const USER_C = '00000000-0000-4000-8000-0000000000a3';

function joined(
  sequence: number,
  role: 'moderator' | 'debater-A' | 'debater-B',
  userId: string,
  screenName: string,
): Event {
  return {
    id: `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
    sessionId: SESSION,
    sequence,
    kind: 'participant-joined',
    actor: userId,
    payload: {
      user_id: userId,
      role,
      screen_name: screenName,
      joined_at: '2026-05-16T00:00:00.000Z',
    },
    createdAt: '2026-05-16T00:00:00.000Z',
  };
}

function left(sequence: number, userId: string): Event {
  return {
    id: `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
    sessionId: SESSION,
    sequence,
    kind: 'participant-left',
    actor: userId,
    payload: {
      user_id: userId,
      left_at: '2026-05-16T00:01:00.000Z',
    },
    createdAt: '2026-05-16T00:01:00.000Z',
  };
}

function nodeCreated(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
    sessionId: SESSION,
    sequence,
    kind: 'node-created',
    actor: MOD_USER,
    payload: {
      node_id: '11111111-1111-4111-8111-111111111111',
      wording: 'unrelated',
      created_by: MOD_USER,
      created_at: '2026-05-16T00:02:00.000Z',
    },
    createdAt: '2026-05-16T00:02:00.000Z',
  };
}

describe('SLOT_ROLES', () => {
  it('lists moderator, debater-A, debater-B in render order', () => {
    expect([...SLOT_ROLES]).toEqual(['moderator', 'debater-A', 'debater-B']);
  });
});

describe('deriveSlotOccupants', () => {
  it('(a) empty event log → empty SlotOccupants', () => {
    const result = deriveSlotOccupants([]);
    expect(result).toEqual({});
  });

  it('(b) single participant-joined → role-keyed occupant entry with {userId, screenName} pair', () => {
    const result = deriveSlotOccupants([joined(1, 'debater-A', USER_A, 'ben')]);
    expect(result).toEqual({
      'debater-A': { userId: USER_A, screenName: 'ben' },
    } satisfies SlotOccupants);
  });

  it('(c) participant-joined followed by participant-left (same user_id) → empty SlotOccupants (slot cleared)', () => {
    const result = deriveSlotOccupants([joined(1, 'debater-A', USER_A, 'ben'), left(2, USER_A)]);
    expect(result).toEqual({});
  });

  it('(d) participant-joined followed by participant-left (different user_id) → original slot still occupied (stale-event defense)', () => {
    const result = deriveSlotOccupants([joined(1, 'debater-B', USER_A, 'ben'), left(2, USER_B)]);
    expect(result).toEqual({
      'debater-B': { userId: USER_A, screenName: 'ben' },
    } satisfies SlotOccupants);
  });

  it('(e) two participant-joined for the same role with different user_ids → latest wins (the rejoin overwrites)', () => {
    const result = deriveSlotOccupants([
      joined(1, 'debater-A', USER_A, 'ben'),
      joined(2, 'debater-A', USER_B, 'carol'),
    ]);
    expect(result).toEqual({
      'debater-A': { userId: USER_B, screenName: 'carol' },
    } satisfies SlotOccupants);
  });

  it('(f) other event kinds in the log → ignored (no spurious slot mutation)', () => {
    const result = deriveSlotOccupants([
      joined(1, 'moderator', MOD_USER, 'alice'),
      nodeCreated(2),
      joined(3, 'debater-A', USER_A, 'ben'),
    ]);
    expect(result).toEqual({
      moderator: { userId: MOD_USER, screenName: 'alice' },
      'debater-A': { userId: USER_A, screenName: 'ben' },
    } satisfies SlotOccupants);
  });

  it('rejoin after leave restores the slot under the same user_id', () => {
    const result = deriveSlotOccupants([
      joined(1, 'debater-A', USER_A, 'ben'),
      left(2, USER_A),
      joined(3, 'debater-A', USER_A, 'ben'),
    ]);
    expect(result).toEqual({
      'debater-A': { userId: USER_A, screenName: 'ben' },
    } satisfies SlotOccupants);
  });

  it('all three slots fill from a typical lobby event log', () => {
    const result = deriveSlotOccupants([
      joined(1, 'moderator', MOD_USER, 'alice'),
      joined(2, 'debater-A', USER_A, 'ben'),
      joined(3, 'debater-B', USER_B, 'carol'),
    ]);
    expect(result).toEqual({
      moderator: { userId: MOD_USER, screenName: 'alice' },
      'debater-A': { userId: USER_A, screenName: 'ben' },
      'debater-B': { userId: USER_B, screenName: 'carol' },
    } satisfies SlotOccupants);
  });
});

describe('mergeSlots', () => {
  it('(g) HTTP rows + empty WS events + empty WS occupants → HTTP rows render in their slots', () => {
    const rows: readonly ParticipantRow[] = [
      { userId: MOD_USER, role: 'moderator', screenName: '' },
      { userId: USER_A, role: 'debater-A', screenName: '' },
    ];
    const result = mergeSlots(rows, {}, []);
    expect(result).toEqual({
      moderator: { userId: MOD_USER, screenName: '' },
      'debater-A': { userId: USER_A, screenName: '' },
    } satisfies SlotOccupants);
  });

  it('(h) HTTP rows + WS occupants for the same slot → WS occupant wins (collision rule)', () => {
    const rows: readonly ParticipantRow[] = [
      { userId: USER_A, role: 'debater-A', screenName: 'old-name' },
    ];
    const wsOccupants: SlotOccupants = {
      'debater-A': { userId: USER_A, screenName: 'new-name' },
    };
    const result = mergeSlots(rows, wsOccupants, []);
    expect(result).toEqual({
      'debater-A': { userId: USER_A, screenName: 'new-name' },
    } satisfies SlotOccupants);
  });

  it('(i) HTTP rows + WS event log including participant-left for one HTTP user_id → that row is filtered out (WS-absence-propagation)', () => {
    const rows: readonly ParticipantRow[] = [
      { userId: USER_A, role: 'debater-A', screenName: '' },
      { userId: USER_B, role: 'debater-B', screenName: '' },
    ];
    const result = mergeSlots(rows, {}, [left(1, USER_A)]);
    expect(result).toEqual({
      'debater-B': { userId: USER_B, screenName: '' },
    } satisfies SlotOccupants);
  });

  it('(j) HTTP rows + WS event log with participant-left followed by participant-joined for the same user_id → row is NOT filtered (latest map ends at joined)', () => {
    const rows: readonly ParticipantRow[] = [{ userId: USER_A, role: 'debater-A', screenName: '' }];
    const events: readonly Event[] = [left(1, USER_A), joined(2, 'debater-A', USER_A, 'ben')];
    const result = mergeSlots(rows, deriveSlotOccupants(events), events);
    expect(result).toEqual({
      'debater-A': { userId: USER_A, screenName: 'ben' },
    } satisfies SlotOccupants);
  });

  it('(k) empty HTTP rows + WS occupants → WS occupants render', () => {
    const wsOccupants: SlotOccupants = {
      moderator: { userId: MOD_USER, screenName: 'alice' },
      'debater-A': { userId: USER_A, screenName: 'ben' },
    };
    const result = mergeSlots([], wsOccupants, []);
    expect(result).toEqual(wsOccupants);
  });

  it('(l) both empty → empty SlotOccupants', () => {
    expect(mergeSlots([], {}, [])).toEqual({});
  });

  it('HTTP rows for all three slots + matching WS overlay → WS screen names land in every slot', () => {
    const rows: readonly ParticipantRow[] = [
      { userId: MOD_USER, role: 'moderator', screenName: '' },
      { userId: USER_A, role: 'debater-A', screenName: '' },
      { userId: USER_B, role: 'debater-B', screenName: '' },
    ];
    const events: readonly Event[] = [
      joined(1, 'moderator', MOD_USER, 'alice'),
      joined(2, 'debater-A', USER_A, 'ben'),
      joined(3, 'debater-B', USER_B, 'carol'),
    ];
    const result = mergeSlots(rows, deriveSlotOccupants(events), events);
    expect(result).toEqual({
      moderator: { userId: MOD_USER, screenName: 'alice' },
      'debater-A': { userId: USER_A, screenName: 'ben' },
      'debater-B': { userId: USER_B, screenName: 'carol' },
    } satisfies SlotOccupants);
  });

  it('WS-derived absence + matching role refilled by a different user → the new user wins', () => {
    const rows: readonly ParticipantRow[] = [{ userId: USER_A, role: 'debater-A', screenName: '' }];
    const events: readonly Event[] = [left(1, USER_A), joined(2, 'debater-A', USER_C, 'dave')];
    const result = mergeSlots(rows, deriveSlotOccupants(events), events);
    expect(result).toEqual({
      'debater-A': { userId: USER_C, screenName: 'dave' },
    } satisfies SlotOccupants);
  });
});
