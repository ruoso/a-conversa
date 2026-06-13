// Exhaustive unit coverage for the see-replay availability/href helper
// (acceptance criterion 1): every lifecycle status maps to its exact href
// string or to `null`. Pure-function test, no React. Mirrors
// `joinLiveHref.test.ts`.
//
// Refinement: tasks/refinements/session_discovery/sd_see_replay_link.md

import { describe, expect, it } from 'vitest';

import { seeReplayHref, type SeeReplayRow } from './seeReplayHref';

const ID = 's1';

const LOBBY: SeeReplayRow = { id: ID, startedAt: null, endedAt: null };
const LIVE: SeeReplayRow = { id: ID, startedAt: '2026-06-01T10:00:00.000Z', endedAt: null };
const ENDED: SeeReplayRow = {
  id: ID,
  startedAt: '2026-05-01T10:00:00.000Z',
  endedAt: '2026-05-01T11:00:00.000Z',
};

interface Case {
  readonly row: SeeReplayRow;
  readonly expected: string | null;
  readonly label: string;
}

const CASES: readonly Case[] = [
  { row: LOBBY, expected: null, label: 'lobby (no log to replay)' },
  { row: LIVE, expected: null, label: 'live (join-live owns the live feed)' },
  { row: ENDED, expected: '/a/replay/s1', label: 'ended' },
];

describe('seeReplayHref', () => {
  for (const { row, expected, label } of CASES) {
    it(`maps ${label} to ${expected === null ? 'null' : expected}`, () => {
      expect(seeReplayHref(row)).toBe(expected);
    });
  }
});
