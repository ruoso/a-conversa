// Structural accessibility pins for the My Sessions route (acceptance: no axe
// violations — the jsdom-fast half here, the live axe scan in
// `tests/e2e/my-sessions-page.spec.ts`, ADR 0040). Mirrors
// `PublicSessionsRoute.a11y.test.tsx`, asserting the page in its AUTHENTICATED
// state: single `main` landmark, single level-1 heading, an accessibly-named
// landmark, the role badge's accessible label, and no focus-suppression /
// positive-tabindex structural defects. Colour contrast and the visible focus
// indicator — facts a real browser is needed for — are pinned in the Playwright
// spec, not here.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
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

beforeAll(async () => {
  await getTestI18n();
});

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        sessions: [
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
        ],
        total: 1,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('MySessionsRoute structural a11y', () => {
  it('exposes exactly one main landmark and exactly one level-1 heading', async () => {
    renderWithProviders(<MySessionsRoute />, { auth: AUTHENTICATED });
    await screen.findByTestId('route-my-sessions');

    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toBe(screen.getByTestId('route-my-sessions'));

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toBe(screen.getByTestId('route-title'));
  });

  it('gives the main landmark a non-empty accessible name via aria-labelledby', async () => {
    const { container } = renderWithProviders(<MySessionsRoute />, { auth: AUTHENTICATED });
    await screen.findByTestId('route-my-sessions');

    const main = screen.getByTestId('route-my-sessions');
    const labelledBy = main.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const target = container.querySelector(`[id="${String(labelledBy)}"]`);
    expect(target?.textContent?.trim()).toBeTruthy();
  });

  it('gives the per-row role badge a non-empty accessible label', async () => {
    renderWithProviders(<MySessionsRoute />, { auth: AUTHENTICATED });
    await waitFor(() => {
      expect(screen.getByText('Climate policy')).toBeTruthy();
    });

    const badge = screen.getByTestId('session-role-badge');
    expect(badge.getAttribute('aria-label')?.trim()).toBeTruthy();
  });

  it('has no positive tabindex and exposes its list controls as native focusable elements', async () => {
    const { container } = renderWithProviders(<MySessionsRoute />, { auth: AUTHENTICATED });
    await waitFor(() => {
      expect(screen.getByText('Climate policy')).toBeTruthy();
    });

    const tabbables = Array.from(container.querySelectorAll<HTMLElement>('[tabindex]'));
    for (const el of tabbables) {
      expect(Number(el.getAttribute('tabindex'))).toBeLessThanOrEqual(0);
    }

    const NATIVE = new Set(['a', 'button', 'select', 'input', 'textarea']);
    for (const testid of ['session-list-search', 'session-list-prev', 'session-list-next']) {
      const el = screen.getByTestId(testid);
      expect(NATIVE.has(el.tagName.toLowerCase())).toBe(true);
    }
  });
});
