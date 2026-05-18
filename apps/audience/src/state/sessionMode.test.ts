// Vitest cases for `sessionMode.ts`.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §5 — `'lobby'` default; mode derives ONLY from
//   `session-mode-changed` envelopes per ADR 0028.)
//
// Four cases:
//   (a) empty events → `'lobby'`,
//   (b) first `session-mode-changed → 'operate'` returns `'operate'`,
//   (c) multiple transitions → last value wins,
//   (d) events without any `session-mode-changed` → `'lobby'` default
//       (no content-event heuristic).

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { sessionModeFrom } from './sessionMode.js';

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const MODERATOR_ID = '00000000-0000-4000-8000-0000000000bb';

function modeChangedEvent(opts: {
  sequence: number;
  previous: 'lobby' | 'operate';
  next: 'lobby' | 'operate';
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x700 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'session-mode-changed',
    actor: MODERATOR_ID,
    payload: {
      previous_mode: opts.previous,
      new_mode: opts.next,
      changed_by: MODERATOR_ID,
      changed_at: '2026-05-18T00:05:00.000Z',
    },
    createdAt: '2026-05-18T00:05:00.000Z',
  };
}

function nodeCreatedEvent(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x800 + sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence,
    kind: 'node-created',
    actor: MODERATOR_ID,
    payload: {
      node_id: `00000000-0000-4000-8000-${(0x900 + sequence).toString(16).padStart(12, '0')}`,
      wording: 'sample wording',
      created_by: MODERATOR_ID,
      created_at: '2026-05-18T00:06:00.000Z',
    },
    createdAt: '2026-05-18T00:06:00.000Z',
  };
}

describe('sessionModeFrom', () => {
  it("(a) returns the 'lobby' default for an empty event log", () => {
    expect(sessionModeFrom([])).toBe('lobby');
  });

  it("(b) returns 'operate' after a single session-mode-changed envelope flipping to operate", () => {
    expect(
      sessionModeFrom([modeChangedEvent({ sequence: 1, previous: 'lobby', next: 'operate' })]),
    ).toBe('operate');
  });

  it('(c) returns the latest new_mode when multiple session-mode-changed envelopes are present (last wins)', () => {
    expect(
      sessionModeFrom([
        modeChangedEvent({ sequence: 1, previous: 'lobby', next: 'operate' }),
        modeChangedEvent({ sequence: 2, previous: 'operate', next: 'lobby' }),
        modeChangedEvent({ sequence: 3, previous: 'lobby', next: 'operate' }),
      ]),
    ).toBe('operate');
  });

  it("(d) returns the 'lobby' default for an event log with content events but no session-mode-changed envelope (no heuristic fallback)", () => {
    // Content events alone do NOT imply operate mode — the audience is
    // a forward-only consumer (post-ADR-0028), so the participant's
    // CONTENT_EVENT_KINDS backward-compat heuristic is deliberately
    // NOT mirrored. A `node-created` envelope without an accompanying
    // `session-mode-changed` returns the lobby default.
    expect(sessionModeFrom([nodeCreatedEvent(1), nodeCreatedEvent(2)])).toBe('lobby');
  });
});
