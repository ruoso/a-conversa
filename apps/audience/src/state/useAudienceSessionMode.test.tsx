// Vitest React-harness cases for `useAudienceSessionMode`.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §5 — mode derives from `session-mode-changed` envelopes;
//   this harness pins the React-render-cycle integration.)
//
// Three cases:
//   (a) initial → `'lobby'` default,
//   (b) after `session-mode-changed → operate` envelope → `'operate'`,
//   (c) stable primitive across unrelated-session events (no downstream
//       re-render churn from sessions the hook isn't watching).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement, useRef } from 'react';
import type { Event, SessionMode } from '@a-conversa/shared-types';

import { audienceWsStore } from '../ws/wsStore.js';
import { useAudienceSessionMode } from './useAudienceSessionMode.js';

const SESSION_A = '00000000-0000-4000-8000-000000000001';
const SESSION_B = '00000000-0000-4000-8000-000000000099';
const MODERATOR_ID = '00000000-0000-4000-8000-0000000000bb';

function modeChangedEvent(opts: {
  sessionId: string;
  sequence: number;
  previous: SessionMode;
  next: SessionMode;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0xb00 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: opts.sessionId,
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

function ModeProbe({ sessionId }: { sessionId: string }): ReturnType<typeof createElement> {
  const mode = useAudienceSessionMode(sessionId);
  return createElement('span', { 'data-testid': 'probe-audience-mode' }, mode);
}

function StableRefProbe({
  sessionId,
  seen,
}: {
  sessionId: string;
  seen: { current: SessionMode[] };
}): ReturnType<typeof createElement> {
  const mode = useAudienceSessionMode(sessionId);
  const renderCount = useRef(0);
  renderCount.current += 1;
  seen.current = [...seen.current, mode];
  return createElement(
    'span',
    { 'data-testid': 'probe-audience-mode-renders' },
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

describe('useAudienceSessionMode', () => {
  it("(a) returns the 'lobby' default when no session-mode-changed envelope has arrived", () => {
    render(createElement(ModeProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-audience-mode').textContent).toBe('lobby');
  });

  it("(b) re-renders to 'operate' after a session-mode-changed envelope writes through the store", () => {
    render(createElement(ModeProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-audience-mode').textContent).toBe('lobby');
    act(() => {
      audienceWsStore.getState().applyEvent(
        modeChangedEvent({
          sessionId: SESSION_A,
          sequence: 1,
          previous: 'lobby',
          next: 'operate',
        }),
      );
    });
    expect(screen.getByTestId('probe-audience-mode').textContent).toBe('operate');
  });

  it('(c) keeps the primitive identity stable across renders when no event for the watched session changed', () => {
    // Primitive identity matters for downstream `useMemo` dep arrays
    // that include `mode` — flicker between two `'lobby'` strings would
    // be benign for the value but a wasted reference comparison for
    // any consumer doing `useMemo(() => ..., [mode])`.
    const seen: { current: SessionMode[] } = { current: [] };
    render(createElement(StableRefProbe, { sessionId: SESSION_A, seen }));
    const before = seen.current[seen.current.length - 1];
    act(() => {
      audienceWsStore.getState().applyEvent(
        modeChangedEvent({
          sessionId: SESSION_B,
          sequence: 1,
          previous: 'lobby',
          next: 'operate',
        }),
      );
    });
    const after = seen.current[seen.current.length - 1];
    expect(after).toBe(before);
    expect(after).toBe('lobby');
  });
});
