// Behavioural coverage for the Public Sessions route (acceptance criteria 1 +
// 3): it renders a localized heading, mounts `SessionList` fed by the public
// fetcher (rows render through the real `fetchPublicSessions`, with `fetch`
// stubbed), and passes `lobbyRowsPossible={false}` so the date-filter
// lobby-exclusion note never appears.
//
// Refinement: tasks/refinements/session_discovery/sd_public_sessions_page.md

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

import { PublicSessionsRoute } from './PublicSessionsRoute';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

const originalFetch = global.fetch;

function stubPublicSessions(sessions: unknown[], total = sessions.length): void {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ sessions, total }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

beforeAll(async () => {
  await getTestI18n();
});

beforeEach(() => {
  stubPublicSessions([
    { id: 'a1', topic: 'Climate policy', startedAt: '2026-06-01T10:00:00.000Z', endedAt: null },
  ]);
});

afterEach(async () => {
  cleanup();
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  const i18n = await getTestI18n();
  await i18n.changeLanguage('en-US');
});

describe('PublicSessionsRoute', () => {
  it('renders the localized page heading inside a single main landmark', async () => {
    renderWithProviders(<PublicSessionsRoute />);

    const main = await screen.findByTestId('route-public-sessions');
    expect(main.tagName.toLowerCase()).toBe('main');
    const title = screen.getByTestId('route-title');
    expect(title.tagName.toLowerCase()).toBe('h1');
    // i18n-resolved en-US string — a missing key would render the dotted path.
    expect(title.textContent).toBe('Public sessions');
    expect(title.textContent).not.toContain('discovery.');
  });

  it('mounts SessionList and renders the rows the public fetcher returns', async () => {
    renderWithProviders(<PublicSessionsRoute />);

    expect(await screen.findByTestId('session-list')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Climate policy')).toBeTruthy();
    });
    // The endpoint is anonymous (ADR 0029): no `credentials: 'include'`.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url.startsWith('/api/sessions/public?')).toBe(true);
    expect(init?.credentials).toBeUndefined();
  });

  it('renders a join-live link routing a started public row into the audience surface', async () => {
    renderWithProviders(<PublicSessionsRoute />);

    await waitFor(() => {
      expect(screen.getByText('Climate policy')).toBeTruthy();
    });

    // Public rows carry no role, so the anonymous matrix cell routes to /a.
    const link = screen.getByTestId('session-join-live-link');
    expect(link.getAttribute('href')).toBe('/a/sessions/a1');
    expect(link.textContent).toBe('Join live');
  });

  it('passes lobbyRowsPossible={false}: no lobby-exclusion note when a date filter is active', async () => {
    renderWithProviders(<PublicSessionsRoute />);

    await waitFor(() => {
      expect(screen.getByText('Climate policy')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('session-list-from'), {
      target: { value: '2026-06-01' },
    });

    // The fetcher re-runs with the date bound, proving the filter is active…
    await waitFor(() => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const lastUrl = fetchMock.mock.calls.at(-1)?.[0] as string;
      expect(lastUrl).toContain('startedAfter=');
    });
    // …yet the lobby-exclusion note is suppressed (started-only list).
    expect(screen.queryByTestId('session-list-lobby-note')).toBeNull();
  });
});
