// Vitest end-to-end React-harness cases for `useAudienceSession`.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §2 — the facade is the canonical "everything the audience
//   UI needs" entry; this harness asserts the composition wires every
//   focused hook correctly.)
//
// Two cases:
//   (a) initial mount with a seeded URL → every field of the returned
//       view is asserted explicitly (sessionId from URL, lobby default,
//       empty events, empty roster, idle status),
//   (b) after `applyEvent` + `setConnectionStatus('open')` the view
//       recomputes (events / roster / sessionMode / connectionStatus
//       all update).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { Event } from '@a-conversa/shared-types';

import { audienceWsStore } from '../ws/wsStore.js';
import { useAudienceSession } from './useAudienceSession.js';

const SESSION_UUID = '00000000-0000-4000-8000-000000000099';
const ALICE_ID = '00000000-0000-4000-8000-0000000000a1';
const MODERATOR_ID = '00000000-0000-4000-8000-0000000000bb';

function joinedEvent(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-${(0xc00 + sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_UUID,
    sequence,
    kind: 'participant-joined',
    actor: ALICE_ID,
    payload: {
      user_id: ALICE_ID,
      role: 'debater-A',
      screen_name: 'alice',
      joined_at: '2026-05-18T00:00:00.000Z',
    },
    createdAt: '2026-05-18T00:00:00.000Z',
  };
}

function modeChangedEvent(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-${(0xd00 + sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_UUID,
    sequence,
    kind: 'session-mode-changed',
    actor: MODERATOR_ID,
    payload: {
      previous_mode: 'lobby',
      new_mode: 'operate',
      changed_by: MODERATOR_ID,
      changed_at: '2026-05-18T00:05:00.000Z',
    },
    createdAt: '2026-05-18T00:05:00.000Z',
  };
}

function SessionViewProbe(): ReturnType<typeof createElement> {
  const view = useAudienceSession();
  return createElement(
    'span',
    { 'data-testid': 'probe-audience-session-view' },
    [
      `sessionId=${view.sessionId ?? '__null__'}`,
      `status=${view.connectionStatus}`,
      `events=${String(view.events.length)}`,
      `roster=${String(view.roster.size)}`,
      `mode=${view.sessionMode}`,
    ].join(';'),
  );
}

beforeEach(() => {
  audienceWsStore.getState().reset();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  audienceWsStore.getState().reset();
  window.history.replaceState({}, '', '/');
});

describe('useAudienceSession (composing facade)', () => {
  it('(a) returns the initial view with every field at its baseline (URL-derived id, lobby, empty)', () => {
    window.history.replaceState({}, '', `/a/sessions/${SESSION_UUID}`);
    render(createElement(SessionViewProbe));
    const text = screen.getByTestId('probe-audience-session-view').textContent;
    expect(text).toBe(`sessionId=${SESSION_UUID};status=idle;events=0;roster=0;mode=lobby`);
  });

  it('(b) recomputes each field after the store applies events and the connection status flips to open', () => {
    window.history.replaceState({}, '', `/a/sessions/${SESSION_UUID}`);
    render(createElement(SessionViewProbe));
    expect(screen.getByTestId('probe-audience-session-view').textContent).toBe(
      `sessionId=${SESSION_UUID};status=idle;events=0;roster=0;mode=lobby`,
    );

    act(() => {
      audienceWsStore.getState().applyEvent(joinedEvent(1));
      audienceWsStore.getState().applyEvent(modeChangedEvent(2));
      audienceWsStore.getState().setConnectionStatus('open');
    });

    expect(screen.getByTestId('probe-audience-session-view').textContent).toBe(
      `sessionId=${SESSION_UUID};status=open;events=2;roster=1;mode=operate`,
    );
  });
});
