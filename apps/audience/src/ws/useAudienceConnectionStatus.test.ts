// Tests for the audience-side `useAudienceConnectionStatus` selector hook.
//
// Refinement: tasks/refinements/audience/aud_ws_client.md
//   (Decision §6 — TypeScript-narrowed audience WS surface. The hook
//   IS the read-only status selector exposed by the audience barrel;
//   this file pins the selector contract.)
//
// Mirrors `apps/participant/src/layout/useParticipantConnectionStatus.test.ts`'s
// probe shape — `renderHook` would produce React-out-of-act warnings
// when the Zustand writer fires from outside the test-component;
// rendering a probe through `render(createElement(Probe))` puts the
// re-render inside React's tree and the wrapping `act()` correctly
// flushes it.
//
// Per ADR 0022 these are committed tests, not throwaway probes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';

import { audienceWsStore } from './wsStore.js';
import { useAudienceConnectionStatus } from './useAudienceConnectionStatus.js';

function StatusProbe(): ReturnType<typeof createElement> {
  const status = useAudienceConnectionStatus();
  return createElement('span', { 'data-testid': 'probe-audience-status' }, status);
}

beforeEach(() => {
  audienceWsStore.getState().reset();
});

afterEach(() => {
  cleanup();
  audienceWsStore.getState().reset();
});

describe('useAudienceConnectionStatus — reads from audienceWsStore', () => {
  it('returns the factory-default "idle" before any writer fires', () => {
    render(createElement(StatusProbe));
    expect(screen.getByTestId('probe-audience-status').textContent).toBe('idle');
  });

  it('re-renders to "open" after setConnectionStatus("open")', () => {
    render(createElement(StatusProbe));
    expect(screen.getByTestId('probe-audience-status').textContent).toBe('idle');
    act(() => {
      audienceWsStore.getState().setConnectionStatus('open');
    });
    expect(screen.getByTestId('probe-audience-status').textContent).toBe('open');
  });

  it('re-renders to "closed" after setConnectionStatus("closed")', () => {
    render(createElement(StatusProbe));
    expect(screen.getByTestId('probe-audience-status').textContent).toBe('idle');
    act(() => {
      audienceWsStore.getState().setConnectionStatus('closed');
    });
    expect(screen.getByTestId('probe-audience-status').textContent).toBe('closed');
  });
});
