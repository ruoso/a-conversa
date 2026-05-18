// Tests for the audience-side `useAudienceSessionEvents` selector hook.
//
// Refinement: tasks/refinements/audience/aud_ws_client.md
//   (Decision §6 — TypeScript-narrowed audience WS surface. The hook
//   IS the read-only selector consumers reach via the audience barrel;
//   this file pins the contract.)
//
// Three cases:
//   (a) returns an empty array when no events for `sessionId`,
//   (b) re-renders with the event stream after `applyEvent` writes
//       through,
//   (c) returns a stable reference across renders when no new events
//       arrived — load-bearing for React render-loop avoidance.
//
// Mirrors the probe-render pattern used by
// `useAudienceConnectionStatus.test.ts` (and the participant's
// `useParticipantConnectionStatus.test.ts`). `renderHook` would
// produce React-out-of-act warnings when the Zustand writer fires
// from outside the test-component; rendering a probe through
// `render(createElement(Probe))` puts the re-render inside React's
// tree and the wrapping `act()` correctly flushes it.
//
// Per ADR 0022 these are committed tests, not throwaway probes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement, useRef } from 'react';
import type { Event } from '@a-conversa/shared-types';

import { audienceWsStore } from './wsStore.js';
import { useAudienceSessionEvents } from './useAudienceSessionEvents.js';

const SESSION_A = '00000000-0000-4000-8000-000000000001';
const SESSION_B = '00000000-0000-4000-8000-000000000099';

function makeEvent(sessionId: string, sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-00000000000${sequence}`,
    sessionId,
    sequence,
    kind: 'session-created',
    actor: '00000000-0000-4000-8000-0000000000aa',
    createdAt: '2026-05-18T10:00:00.000Z',
    payload: {
      host_user_id: '00000000-0000-4000-8000-0000000000aa',
      privacy: 'public',
      topic: 'audience selector test',
      created_at: '2026-05-18T10:00:00.000Z',
    },
  };
}

function EventCountProbe({ sessionId }: { sessionId: string }): ReturnType<typeof createElement> {
  const events = useAudienceSessionEvents(sessionId);
  return createElement(
    'span',
    { 'data-testid': 'probe-audience-events-count' },
    String(events.length),
  );
}

/**
 * Probe component that captures the array identity returned by the
 * selector hook across renders. Used by the stable-reference test
 * below: a render number is rendered into the DOM so the parent
 * `act()` can re-render and the test can compare `seen.current[0]`
 * with `seen.current[1]`.
 */
function StableRefProbe({
  sessionId,
  seen,
}: {
  sessionId: string;
  seen: { current: ReadonlyArray<readonly Event[]> };
}): ReturnType<typeof createElement> {
  const events = useAudienceSessionEvents(sessionId);
  const renderCount = useRef(0);
  renderCount.current += 1;
  seen.current = [...seen.current, events];
  return createElement(
    'span',
    { 'data-testid': 'probe-audience-events-renders' },
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

describe('useAudienceSessionEvents — reads from audienceWsStore', () => {
  it('renders 0 events when no events have arrived for the session', () => {
    render(createElement(EventCountProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-audience-events-count').textContent).toBe('0');
  });

  it('re-renders with the event stream after applyEvent writes through', () => {
    render(createElement(EventCountProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-audience-events-count').textContent).toBe('0');
    act(() => {
      audienceWsStore.getState().applyEvent(makeEvent(SESSION_A, 1));
    });
    expect(screen.getByTestId('probe-audience-events-count').textContent).toBe('1');
  });

  it('returns a stable empty-array reference across renders when no events arrived for the session', () => {
    // Load-bearing: the `?? EMPTY_EVENTS` (vs. a `?? []` literal) is
    // what prevents Zustand from re-rendering every consumer on every
    // store change for sessions that have no events. Drive an
    // unrelated store change (event for a DIFFERENT session) and
    // verify the empty array reference for SESSION_A is identical
    // before and after.
    const seen: { current: ReadonlyArray<readonly Event[]> } = { current: [] };
    render(createElement(StableRefProbe, { sessionId: SESSION_A, seen }));
    const before = seen.current[seen.current.length - 1];
    act(() => {
      audienceWsStore.getState().applyEvent(makeEvent(SESSION_B, 1));
    });
    const after = seen.current[seen.current.length - 1];
    expect(after).toBe(before);
  });
});
