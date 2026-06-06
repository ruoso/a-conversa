// Vitest React-harness cases for `useAudienceLatestSnapshot`.
//
// Refinement: tasks/refinements/audience/aud_chapter_marker_render.md
//   (Acceptance criteria §2 — mounts null with no snapshot, re-renders
//   to the label after a `snapshot-created` event writes through the
//   store, and supersedes to a newer label after a second snapshot.)
//
// Mirrors `useAudienceSessionRoster.test.tsx`'s probe shape —
// `render(createElement(Probe))` puts the writer-driven re-render inside
// React's tree so `act()` correctly flushes it.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { Event } from '@a-conversa/shared-types';

import { audienceWsStore } from '../ws/wsStore.js';
import { useAudienceLatestSnapshot } from './useAudienceLatestSnapshot.js';

const SESSION_A = '00000000-0000-4000-8000-000000000001';
const ACTOR_ID = '00000000-0000-4000-8000-0000000000a1';
const SNAP_1 = '00000000-0000-4000-8000-0000000000c1';
const SNAP_2 = '00000000-0000-4000-8000-0000000000c2';

function snapshotEvent(opts: {
  sessionId: string;
  sequence: number;
  snapshotId: string;
  label: string;
  logPosition: number;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0xc00 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: opts.sessionId,
    sequence: opts.sequence,
    kind: 'snapshot-created',
    actor: ACTOR_ID,
    payload: {
      snapshot_id: opts.snapshotId,
      label: opts.label,
      log_position: opts.logPosition,
    },
    createdAt: '2026-05-18T00:00:00.000Z',
  };
}

function SnapshotProbe({ sessionId }: { sessionId: string }): ReturnType<typeof createElement> {
  const snapshot = useAudienceLatestSnapshot(sessionId);
  return createElement(
    'span',
    { 'data-testid': 'probe-audience-latest-snapshot' },
    snapshot === null ? 'null' : snapshot.label,
  );
}

beforeEach(() => {
  audienceWsStore.getState().reset();
});

afterEach(() => {
  cleanup();
  audienceWsStore.getState().reset();
});

describe('useAudienceLatestSnapshot', () => {
  it('(a) returns null when no snapshot-created event has arrived for the session', () => {
    render(createElement(SnapshotProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-audience-latest-snapshot').textContent).toBe('null');
  });

  it('(b) re-renders with the label after a snapshot-created event writes through the store', () => {
    render(createElement(SnapshotProbe, { sessionId: SESSION_A }));
    expect(screen.getByTestId('probe-audience-latest-snapshot').textContent).toBe('null');
    act(() => {
      audienceWsStore.getState().applyEvent(
        snapshotEvent({
          sessionId: SESSION_A,
          sequence: 1,
          snapshotId: SNAP_1,
          label: 'Segment 1 close',
          logPosition: 1,
        }),
      );
    });
    expect(screen.getByTestId('probe-audience-latest-snapshot').textContent).toBe(
      'Segment 1 close',
    );
  });

  it('(c) supersedes to the newer label after a second snapshot-created event', () => {
    render(createElement(SnapshotProbe, { sessionId: SESSION_A }));
    act(() => {
      audienceWsStore.getState().applyEvent(
        snapshotEvent({
          sessionId: SESSION_A,
          sequence: 1,
          snapshotId: SNAP_1,
          label: 'Segment 1 close',
          logPosition: 1,
        }),
      );
    });
    expect(screen.getByTestId('probe-audience-latest-snapshot').textContent).toBe(
      'Segment 1 close',
    );
    act(() => {
      audienceWsStore.getState().applyEvent(
        snapshotEvent({
          sessionId: SESSION_A,
          sequence: 2,
          snapshotId: SNAP_2,
          label: 'Commercial',
          logPosition: 2,
        }),
      );
    });
    expect(screen.getByTestId('probe-audience-latest-snapshot').textContent).toBe('Commercial');
  });
});
