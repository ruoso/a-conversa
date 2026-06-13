// Exhaustive unit coverage for the join-live routing matrix (acceptance
// criterion 1): every (role × lifecycle-status) cell maps to its exact href
// string or to `null`. Pure-function test, no React.
//
// Refinement: tasks/refinements/session_discovery/sd_join_live_link.md

import { describe, expect, it } from 'vitest';

import { joinLiveHref, type JoinLiveRow } from './joinLiveHref';
import type { MySessionRole } from './mySessionsFetcher';

const ID = 's1';

const LOBBY: JoinLiveRow = { id: ID, startedAt: null, endedAt: null };
const LIVE: JoinLiveRow = { id: ID, startedAt: '2026-06-01T10:00:00.000Z', endedAt: null };
const ENDED: JoinLiveRow = {
  id: ID,
  startedAt: '2026-05-01T10:00:00.000Z',
  endedAt: '2026-05-01T11:00:00.000Z',
};

interface Case {
  readonly role: MySessionRole | undefined;
  readonly row: JoinLiveRow;
  readonly expected: string | null;
  readonly label: string;
}

const CASES: readonly Case[] = [
  // host → moderator surface
  { role: 'host', row: LOBBY, expected: '/m/sessions/s1/lobby', label: 'host lobby' },
  { role: 'host', row: LIVE, expected: '/m/sessions/s1/operate', label: 'host live' },
  { role: 'host', row: ENDED, expected: null, label: 'host ended' },
  // moderator → moderator surface (same as host)
  { role: 'moderator', row: LOBBY, expected: '/m/sessions/s1/lobby', label: 'moderator lobby' },
  { role: 'moderator', row: LIVE, expected: '/m/sessions/s1/operate', label: 'moderator live' },
  { role: 'moderator', row: ENDED, expected: null, label: 'moderator ended' },
  // debater-A → participant surface (slot, not invite)
  { role: 'debater-A', row: LOBBY, expected: '/p/sessions/s1/lobby', label: 'debater-A lobby' },
  { role: 'debater-A', row: LIVE, expected: '/p/sessions/s1', label: 'debater-A live' },
  { role: 'debater-A', row: ENDED, expected: null, label: 'debater-A ended' },
  // debater-B → participant surface (same as debater-A)
  { role: 'debater-B', row: LOBBY, expected: '/p/sessions/s1/lobby', label: 'debater-B lobby' },
  { role: 'debater-B', row: LIVE, expected: '/p/sessions/s1', label: 'debater-B live' },
  { role: 'debater-B', row: ENDED, expected: null, label: 'debater-B ended' },
  // undefined (anonymous/public) → audience surface, started-only
  { role: undefined, row: LOBBY, expected: null, label: 'anon lobby (defensive null)' },
  { role: undefined, row: LIVE, expected: '/a/sessions/s1', label: 'anon live' },
  { role: undefined, row: ENDED, expected: null, label: 'anon ended' },
];

describe('joinLiveHref', () => {
  for (const { role, row, expected, label } of CASES) {
    it(`maps ${label} to ${expected === null ? 'null' : expected}`, () => {
      expect(joinLiveHref(row, role)).toBe(expected);
    });
  }
});
