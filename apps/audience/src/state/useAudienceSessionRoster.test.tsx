// Vitest React-harness cases for `useAudienceSessionRoster`.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §8 — hook consumes the narrowed `ws/` barrel; this
//   harness mounts a probe component, seeds the audienceWsStore
//   singleton, and asserts the selector + `useMemo` behave correctly.)
//
// Three cases:
//   (a) initial empty events → empty map (the `EMPTY_AUDIENCE_ROSTER`
//       identity is what the projector returns; the hook surfaces it),
//   (b) after store seeded with a participant-joined event → map
//       contains the entry,
//   (c) stable reference across renders when no event for the watched
//       session changed (the `useMemo` + projector identity that
//       prevents downstream re-render churn).
//
// Mirrors `apps/audience/src/ws/useAudienceSessionEvents.test.ts`'s
// probe shape — `render(createElement(Probe))` puts the writer-driven
// re-render inside React's tree so `act()` correctly flushes it.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement, useRef } from 'react';
import type { Event } from '@a-conversa/shared-types';

import { audienceWsStore } from '../ws/wsStore.js';
import { useAudienceSessionRoster } from './useAudienceSessionRoster.js';

const SESSION_A = '00000000-0000-4000-8000-000000000001';
const SESSION_B = '00000000-0000-4000-8000-000000000099';
const ALICE_ID = '00000000-0000-4000-8000-0000000000a1';
const BEN_ID = '00000000-0000-4000-8000-0000000000a2';

function joinedEvent(opts: {
  sessionId: string;
  sequence: number;
  userId: string;
  screenName: string;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0xa00 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: opts.sessionId,
    sequence: opts.sequence,
    kind: 'participant-joined',
    actor: opts.userId,
    payload: {
      user_id: opts.userId,
      role: 'debater-A',
      screen_name: opts.screenName,
      joined_at: '2026-05-18T00:00:00.000Z',
    },
    createdAt: '2026-05-18T00:00:00.000Z',
  };
}

function RosterProbe({ sessionId }: { sessionId: string }): ReturnType<typeof createElement> {
  const roster = useAudienceSessionRoster(sessionId);
  const entries = Array.from(roster.entries())
    .map(([userId, name]) => `${userId}:${name}`)
    .join(',');
  return createElement(
    'span',
    { 'data-testid': 'probe-audience-roster' },
    `size=${String(roster.size)};${entries}`,
  );
}

function StableRefProbe({
  sessionId,
  seen,
}: {
  sessionId: string;
  seen: { current: ReadonlyArray<ReadonlyMap<string, string>> };
}): ReturnType<typeof createElement> {
  const roster = useAudienceSessionRoster(sessionId);
  const renderCount = useRef(0);
  renderCount.current += 1;
  seen.current = [...seen.current, roster];
  return createElement(
    'span',
    { 'data-testid': 'probe-audience-roster-renders' },
    String(renderCount.current),
  );
}

beforeEach(() => {
  audienceWsStore.getState().reset();
});

afterEach(() => {
  cleanup();
  audienceWsStore.getState().reset();
});

describe('useAudienceSessionRoster', () => {
  it('(a) returns an empty map when no participant-joined event has arrived for the session', () => {
    render(createElement(RosterProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-audience-roster').textContent).toBe('size=0;');
  });

  it('(b) re-renders with the entry after a participant-joined event writes through the store', () => {
    render(createElement(RosterProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-audience-roster').textContent).toBe('size=0;');
    act(() => {
      audienceWsStore.getState().applyEvent(
        joinedEvent({
          sessionId: SESSION_A,
          sequence: 1,
          userId: ALICE_ID,
          screenName: 'alice',
        }),
      );
    });
    expect(screen.getByTestId('probe-audience-roster').textContent).toBe(
      `size=1;${ALICE_ID}:alice`,
    );
  });

  it('(c) returns a stable map reference across renders when no event for the watched session changed', () => {
    // Load-bearing: the `useMemo` over `useAudienceSessionEvents` is
    // what keeps the roster reference stable when an unrelated
    // session's events change. Without the memo, every event applied
    // for ANY session would mint a fresh map for SESSION_A and
    // re-render the downstream tree.
    const seen: { current: ReadonlyArray<ReadonlyMap<string, string>> } = { current: [] };
    render(createElement(StableRefProbe, { sessionId: SESSION_A, seen }));
    const before = seen.current[seen.current.length - 1];
    act(() => {
      audienceWsStore.getState().applyEvent(
        joinedEvent({
          sessionId: SESSION_B,
          sequence: 1,
          userId: BEN_ID,
          screenName: 'ben',
        }),
      );
    });
    const after = seen.current[seen.current.length - 1];
    expect(after).toBe(before);
  });
});
