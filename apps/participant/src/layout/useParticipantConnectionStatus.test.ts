// Source-hook contract pin for `useParticipantConnectionStatus`.
//
// Refinement: tasks/refinements/participant-ui/part_ws_client.md
//   (Vitest source-hook contract — three cases per the refinement's
//   "Test layers per ADR 0022" section).
//
// Pins that the source hook reads from the participant's `useWsStore`
// singleton and re-renders a probe component when the store's
// `setConnectionStatus` writer fires. The other two `WsConnectionStatus`
// arms (`'connecting'`, `'reconnecting'`) are sufficiently covered by
// the chip's existing component-shape suite at
// `ParticipantStatusIndicator.test.tsx`, which mocks this hook per
// state — three arms here pin the source-side contract without
// duplicating the chip's per-state coverage.
//
// Per ADR 0022 these are committed tests, not throwaway probes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';

import { useParticipantConnectionStatus } from './useParticipantConnectionStatus.js';
import { useWsStore } from '../ws/wsStore.js';

function StatusProbe(): ReturnType<typeof createElement> {
  const status = useParticipantConnectionStatus();
  return createElement('span', { 'data-testid': 'probe-source-status' }, status);
}

beforeEach(() => {
  useWsStore.getState().reset();
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
});

describe('useParticipantConnectionStatus — reads from participant useWsStore', () => {
  it('returns the factory-default "idle" before any writer fires', () => {
    render(createElement(StatusProbe));
    expect(screen.getByTestId('probe-source-status').textContent).toBe('idle');
  });

  it('re-renders to "open" after setConnectionStatus("open")', () => {
    render(createElement(StatusProbe));
    expect(screen.getByTestId('probe-source-status').textContent).toBe('idle');
    act(() => {
      useWsStore.getState().setConnectionStatus('open');
    });
    expect(screen.getByTestId('probe-source-status').textContent).toBe('open');
  });

  it('re-renders to "closed" after setConnectionStatus("closed")', () => {
    render(createElement(StatusProbe));
    expect(screen.getByTestId('probe-source-status').textContent).toBe('idle');
    act(() => {
      useWsStore.getState().setConnectionStatus('closed');
    });
    expect(screen.getByTestId('probe-source-status').textContent).toBe('closed');
  });
});
