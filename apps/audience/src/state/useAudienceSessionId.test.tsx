// Vitest React-harness cases for `useAudienceSessionId`.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §3 — `useSyncExternalStore` over `popstate`; this
//   harness asserts the snapshot resolves the URL on mount and that a
//   `popstate` event re-derives the value.)
//
// Four cases:
//   (a) initial pathname `/a/sessions/<uuid>` → UUID,
//   (b) pathname `/a` (no `/sessions/`) → null,
//   (c) `popstate` event after `window.history.replaceState` re-derives,
//   (d) `unmount` removes the popstate listener (subscribe-cleanup
//       contract that `useSyncExternalStore` already implies, but
//       pinned here so a future refactor that drops the cleanup
//       fails the test).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';

import { useAudienceSessionId } from './useAudienceSessionId.js';

const UUID_A = '00000000-0000-4000-8000-000000000099';
const UUID_B = '00000000-0000-4000-8000-0000000000aa';

function SessionIdProbe(): ReturnType<typeof createElement> {
  const sessionId = useAudienceSessionId();
  return createElement(
    'span',
    { 'data-testid': 'probe-audience-session-id' },
    sessionId ?? '__null__',
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('useAudienceSessionId', () => {
  it('(a) returns the UUID parsed from an initial `/a/sessions/<uuid>` pathname', () => {
    window.history.replaceState({}, '', `/a/sessions/${UUID_A}`);
    render(createElement(SessionIdProbe));
    expect(screen.getByTestId('probe-audience-session-id').textContent).toBe(UUID_A);
  });

  it('(b) returns null for the bare `/a` pathname (no `/sessions/` marker)', () => {
    window.history.replaceState({}, '', '/a');
    render(createElement(SessionIdProbe));
    expect(screen.getByTestId('probe-audience-session-id').textContent).toBe('__null__');
  });

  it('(c) re-derives the session id after a popstate event fires (back/forward navigation simulation)', () => {
    window.history.replaceState({}, '', `/a/sessions/${UUID_A}`);
    render(createElement(SessionIdProbe));
    expect(screen.getByTestId('probe-audience-session-id').textContent).toBe(UUID_A);
    act(() => {
      window.history.replaceState({}, '', `/a/sessions/${UUID_B}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByTestId('probe-audience-session-id').textContent).toBe(UUID_B);
  });

  it('(d) removes the popstate listener on unmount (subscribe-cleanup pin)', () => {
    window.history.replaceState({}, '', `/a/sessions/${UUID_A}`);
    let listenerCount = 0;
    const originalAdd = window.addEventListener.bind(window);
    const originalRemove = window.removeEventListener.bind(window);
    // Wrap addEventListener / removeEventListener for the duration of
    // this case to count `popstate`-specific adds and removes. The
    // count returning to zero on unmount is the load-bearing assertion.
    window.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'popstate') listenerCount += 1;
      return originalAdd(type, listener, options);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      if (type === 'popstate') listenerCount -= 1;
      return originalRemove(type, listener, options);
    }) as typeof window.removeEventListener;
    try {
      const { unmount } = render(createElement(SessionIdProbe));
      expect(listenerCount).toBeGreaterThan(0);
      act(() => {
        unmount();
      });
      expect(listenerCount).toBe(0);
    } finally {
      window.addEventListener = originalAdd;
      window.removeEventListener = originalRemove;
    }
  });
});
