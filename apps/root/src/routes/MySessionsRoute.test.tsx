// Behavioural coverage for the My Sessions route (acceptance criteria 1, 3, 4):
// the inlined auth gate at each status (loading / unauthenticated /
// needs-screen-name / authenticated), the credentialed fetch, the localized
// heading, the per-row role badge, and the lobby-row behaviour (lobby rows
// surface and the date-filter lobby-exclusion note appears — the inverse of the
// public page).
//
// Refinement: tasks/refinements/session_discovery/sd_my_sessions_page.md

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { AuthContextValue } from '@a-conversa/shell';

import { MySessionsRoute } from './MySessionsRoute';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

const originalFetch = global.fetch;

const AUTHENTICATED: AuthContextValue = {
  status: 'authenticated',
  user: { userId: 'u1', screenName: 'Alice' },
  refresh: () => undefined,
  logout: () => undefined,
};

function authValue(status: AuthContextValue['status']): AuthContextValue {
  if (status === 'authenticated') {
    return AUTHENTICATED;
  }
  return { status, refresh: () => undefined, logout: () => undefined };
}

function stubMySessions(sessions: unknown[], total = sessions.length): void {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ sessions, total }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

/** Render the route at `/sessions/mine` with redirect targets observable. */
function renderRoute(auth: AuthContextValue) {
  return renderWithProviders(
    <Routes>
      <Route path="/sessions/mine" element={<MySessionsRoute />} />
      <Route path="/login" element={<div data-testid="login-stub" />} />
      <Route path="/screen-name" element={<div data-testid="screen-name-stub" />} />
    </Routes>,
    { auth, initialEntries: ['/sessions/mine'] },
  );
}

beforeAll(async () => {
  await getTestI18n();
});

beforeEach(() => {
  stubMySessions([
    {
      id: 'a1',
      hostUserId: 'u1',
      privacy: 'public',
      topic: 'Climate policy',
      createdAt: '2026-06-01T09:00:00.000Z',
      startedAt: '2026-06-01T10:00:00.000Z',
      endedAt: null,
      role: 'host',
    },
  ]);
});

afterEach(async () => {
  cleanup();
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  const i18n = await getTestI18n();
  await i18n.changeLanguage('en-US');
});

describe('MySessionsRoute auth gate', () => {
  it('redirects an unauthenticated visit to /login and remembers the return-to', () => {
    renderRoute(authValue('unauthenticated'));

    expect(screen.getByTestId('login-stub')).toBeTruthy();
    expect(screen.queryByTestId('route-my-sessions')).toBeNull();
    expect(screen.queryByTestId('session-list')).toBeNull();
    // `rememberReturnTo` stashed the deep link for the post-auth bounce.
    expect(window.sessionStorage.getItem('a-conversa:return-to')).toBe('/sessions/mine');
  });

  it('redirects a needs-screen-name visit to /screen-name', () => {
    renderRoute(authValue('needs-screen-name'));

    expect(screen.getByTestId('screen-name-stub')).toBeTruthy();
    expect(screen.queryByTestId('route-my-sessions')).toBeNull();
  });

  it('shows the checking state while auth is loading and does not flash the list', () => {
    renderRoute(authValue('loading'));

    expect(screen.getByTestId('auth-checking')).toBeTruthy();
    expect(screen.queryByTestId('session-list')).toBeNull();
    expect(screen.queryByTestId('route-my-sessions')).toBeNull();
  });

  it('mounts SessionList with the localized heading when authenticated', async () => {
    renderRoute(AUTHENTICATED);

    const main = await screen.findByTestId('route-my-sessions');
    expect(main.tagName.toLowerCase()).toBe('main');
    const title = screen.getByTestId('route-title');
    expect(title.tagName.toLowerCase()).toBe('h1');
    expect(title.textContent).toBe('My sessions');
    expect(title.textContent).not.toContain('discovery.');

    expect(await screen.findByTestId('session-list')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Climate policy')).toBeTruthy();
    });
    // Authenticated endpoint: the session cookie rides along.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url.startsWith('/api/sessions/mine?')).toBe(true);
    expect(init?.credentials).toBe('include');
  });
});

describe('MySessionsRoute role badges and lobby rows', () => {
  it('renders the correct localized role badge for each row', async () => {
    stubMySessions([
      {
        id: 'h1',
        hostUserId: 'u1',
        privacy: 'public',
        topic: 'Hosted debate',
        createdAt: '2026-06-03T09:00:00.000Z',
        startedAt: '2026-06-03T10:00:00.000Z',
        endedAt: null,
        role: 'host',
      },
      {
        id: 'm2',
        hostUserId: 'other',
        privacy: 'public',
        topic: 'Moderated debate',
        createdAt: '2026-06-02T09:00:00.000Z',
        startedAt: '2026-06-02T10:00:00.000Z',
        endedAt: null,
        role: 'moderator',
      },
      {
        id: 'd3',
        hostUserId: 'other',
        privacy: 'public',
        topic: 'Debated debate',
        createdAt: '2026-06-01T09:00:00.000Z',
        startedAt: '2026-06-01T10:00:00.000Z',
        endedAt: null,
        role: 'debater-A',
      },
    ]);

    renderRoute(AUTHENTICATED);

    await waitFor(() => {
      expect(screen.getByText('Hosted debate')).toBeTruthy();
    });

    const badges = screen.getAllByTestId('session-role-badge');
    const labels = badges.map((b) => b.textContent);
    expect(labels).toEqual(['Host', 'Moderator', 'Debater']);
  });

  it('renders a join-live link beside the role badge with the role-correct href', async () => {
    // The default stub row is host + started (live) → moderator operate surface.
    renderRoute(AUTHENTICATED);

    await waitFor(() => {
      expect(screen.getByText('Climate policy')).toBeTruthy();
    });

    // Both affordances share the one actions cell (D4).
    expect(screen.getByTestId('session-role-badge').textContent).toBe('Host');
    const link = screen.getByTestId('session-join-live-link');
    expect(link.getAttribute('href')).toBe('/m/sessions/a1/operate');
    expect(link.textContent).toBe('Join live');
  });

  it('surfaces lobby rows and shows the lobby-exclusion note when a date filter is active', async () => {
    stubMySessions([
      {
        id: 'lobby1',
        hostUserId: 'u1',
        privacy: 'private',
        topic: 'Unstarted lobby',
        createdAt: '2026-06-04T09:00:00.000Z',
        startedAt: null,
        endedAt: null,
        role: 'host',
      },
    ]);

    renderRoute(AUTHENTICATED);

    await waitFor(() => {
      expect(screen.getByText('Unstarted lobby')).toBeTruthy();
    });
    // The lobby (unstarted) row renders with the lobby status.
    expect(screen.getByTestId('session-list-status').textContent).toBe('Lobby');

    fireEvent.change(screen.getByTestId('session-list-from'), {
      target: { value: '2026-06-01' },
    });

    // The fetcher re-runs with the date bound, proving the filter is active…
    await waitFor(() => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const lastUrl = fetchMock.mock.calls.at(-1)?.[0] as string;
      expect(lastUrl).toContain('startedAfter=');
    });
    // …and — unlike the started-only public page — the lobby-exclusion note
    // appears, because lobby rows are possible here (D6).
    await waitFor(() => {
      expect(screen.getByTestId('session-list-lobby-note')).toBeTruthy();
    });
  });
});
