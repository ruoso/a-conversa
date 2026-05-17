import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { App } from './App';
import { getTestI18n, renderWithProviders } from './testing/renderWithProviders';
import { useWsStore } from './ws/wsStore';

beforeAll(async () => {
  await getTestI18n();
});

class FakeWebSocketCtor {
  readyState = 0;

  constructor(_url: string) {
    /* no-op */
  }

  close(): void {
    /* no-op */
  }

  send(): void {
    /* no-op */
  }

  addEventListener(): void {
    /* no-op */
  }

  removeEventListener(): void {
    /* no-op */
  }
}

const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
const originalFetch = global.fetch;

beforeAll(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocketCtor;
});

afterAll(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
  global.fetch = originalFetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fetchAuthenticated(extra?: (url: string) => Promise<Response>): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    if (url === '/api/auth/me') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            userId: '00000000-0000-4000-8000-000000000007',
            screenName: 'alice',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }

    if (extra !== undefined) {
      return extra(url);
    }

    return Promise.resolve(new Response('', { status: 404 }));
  });
}

describe('moderator i18n bootstrap', () => {
  it('resolves the chrome.hello catalog key for en-US', () => {
    expect(i18next.t('chrome.hello')).toBe('hello, world');
  });

  it('resolves the auth.login.title catalog key in en-US', () => {
    expect(i18next.t('auth.login.title')).toBe('Sign in');
  });
});

describe('moderator mounted router', () => {
  it('renders the create-session route for an authenticated user', async () => {
    global.fetch = fetchAuthenticated();

    renderWithProviders(<App />, { initialEntries: ['/sessions/new'] });

    await waitFor(() => {
      expect(screen.getByTestId('route-create-session')).toBeTruthy();
    });
  });

  it('renders the lobby route with the session id from the mounted-region path', async () => {
    global.fetch = fetchAuthenticated();

    renderWithProviders(<App />, { initialEntries: ['/sessions/sess-123/lobby'] });

    await waitFor(() => {
      expect(screen.getByTestId('route-lobby')).toBeTruthy();
    });
    expect(screen.getByTestId('session-id').textContent).toBe('sess-123');
  });

  it('renders the operate route with the session id from the mounted-region path', async () => {
    global.fetch = fetchAuthenticated();

    renderWithProviders(<App />, { initialEntries: ['/sessions/sess-456/operate'] });

    await waitFor(() => {
      expect(screen.getByTestId('route-operate')).toBeTruthy();
    });
    expect(screen.getByTestId('session-id').textContent).toBe('sess-456');
  });

  it('renders the invite route for an authenticated user', async () => {
    global.fetch = fetchAuthenticated((url: string) => {
      if (url.startsWith('/api/sessions/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'abc-123',
              hostUserId: '00000000-0000-4000-8000-000000000007',
              privacy: 'private',
              topic: 'invite route test',
              createdAt: '2026-05-16T00:00:00.000Z',
              endedAt: null,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }

      return Promise.resolve(new Response('', { status: 404 }));
    });

    renderWithProviders(<App />, { initialEntries: ['/sessions/abc-123/invite'] });

    await waitFor(() => {
      expect(screen.getByTestId('route-invite-participants')).toBeTruthy();
    });
  });

  it('redirects unknown mounted-region paths to /sessions/new', async () => {
    global.fetch = fetchAuthenticated();

    renderWithProviders(<App />, { initialEntries: ['/does-not-exist'] });

    await waitFor(() => {
      expect(screen.getByTestId('route-create-session')).toBeTruthy();
    });
  });
});

describe('moderator operate route — diagnostic-flags sidebar slot', () => {
  // Refinement: tasks/refinements/moderator-ui/mod_diagnostic_methodology_suggestions.md
  // Acceptance #5 (smoke): with an active diagnostic in `useWsStore`,
  // the `<RightSidebar>`'s `diagnostic-flags` pane body contains the
  // `<DiagnosticSuggestionsPanel>` (data-testid="diagnostic-suggestions-panel").
  // Per-render behavior is covered by `DiagnosticSuggestionsPanel.test.tsx`;
  // this case only pins the slot-mount wiring through `Operate.tsx`.

  it('renders the suggestions panel inside the diagnostic-flags pane body when a diagnostic is active', async () => {
    global.fetch = fetchAuthenticated();
    const sessionId = '00000000-0000-4000-8000-000000abcdef';

    // Reset and prime the moderator's WS store with one blocking cycle.
    act(() => {
      useWsStore.getState().reset();
    });
    const cyclePayload: DiagnosticPayload = {
      sessionId,
      kind: 'cycle',
      severity: 'blocking',
      status: 'fired',
      sequence: 1,
      diagnostic: { kind: 'cycle', nodes: ['n-a', 'n-b', 'n-c'] },
    };
    act(() => {
      useWsStore.getState().applyDiagnostic(cyclePayload);
    });

    renderWithProviders(<App />, { initialEntries: [`/sessions/${sessionId}/operate`] });

    await waitFor(() => {
      expect(screen.getByTestId('route-operate')).toBeTruthy();
    });
    const paneBody = screen.getByTestId('right-sidebar-pane-body-diagnostic-flags');
    const panel = screen.getByTestId('diagnostic-suggestions-panel');
    expect(paneBody.contains(panel)).toBe(true);
    expect(panel.getAttribute('data-diagnostic-kind')).toBe('cycle');
  });
});
