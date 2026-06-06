import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';

import App from './App';
import * as manifestModule from './surfaces/manifest';
import { getTestI18n, renderWithProviders } from './testing/renderWithProviders';

beforeAll(async () => {
  await getTestI18n();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('root app routes', () => {
  it('redirects the unauthenticated login route straight to /api/auth/login', async () => {
    const replaceSpy = vi.spyOn(window.location, 'replace').mockImplementation(() => undefined);

    renderWithProviders(<App />, { initialEntries: ['/login'] });

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledWith('/api/auth/login');
    });
  });

  it('renders a start-session link on the unauthenticated landing route', async () => {
    renderWithProviders(<App />, { initialEntries: ['/'] });

    await waitFor(() => {
      expect(screen.getByTestId('root-start-session')).toBeTruthy();
    });
    const link = screen.getByTestId('root-start-session');
    expect(link.getAttribute('href')).toBe('/m/sessions/new');
    expect(screen.getByTestId('auth-login-button')).toBeTruthy();
  });

  it('renders the screen-name route for needs-screen-name users', async () => {
    renderWithProviders(<App />, {
      initialEntries: ['/screen-name'],
      auth: {
        status: 'needs-screen-name',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-screen-name')).toBeTruthy();
    });
  });

  it('renders the landing surface as the home for an authenticated visit to /', async () => {
    renderWithProviders(<App />, {
      initialEntries: ['/'],
      auth: {
        status: 'authenticated',
        user: {
          userId: '00000000-0000-4000-8000-000000000002',
          screenName: 'alice',
        },
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    // `/` is now the authenticated home too (the former `/home` dashboard
    // folded back in). The marketing surface renders, with the CTA's
    // secondary action swapped to a logout link and the start-session
    // affordance still available.
    await waitFor(() => {
      expect(screen.getByTestId('route-landing')).toBeTruthy();
    });
    expect(screen.getByTestId('root-start-session')).toBeTruthy();
    expect(screen.getByTestId('root-logout-link')).toBeTruthy();
    // The anonymous SSO affordance is not shown to an authenticated visitor.
    expect(screen.queryByTestId('auth-login-button')).toBeNull();
  });

  it('redirects the removed /home path to the / landing surface', async () => {
    renderWithProviders(<App />, {
      initialEntries: ['/home'],
      auth: {
        status: 'authenticated',
        user: {
          userId: '00000000-0000-4000-8000-000000000004',
          screenName: 'alice',
        },
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    // `/home` no longer exists; the catch-all `*` route redirects any
    // stale bookmark to `/`, which renders the home surface.
    await waitFor(() => {
      expect(screen.getByTestId('route-landing')).toBeTruthy();
    });
    expect(screen.getByTestId('root-logout-link')).toBeTruthy();
  });

  it('redirects protected moderator paths through /login to the SSO endpoint and remembers the target', async () => {
    // After `aud_no_auth_for_public` re-sequenced `SurfaceHost` to read
    // `meta.requiredAuthLevel` AFTER the dynamic import, the deflection
    // path runs only once the manifest + module resolve. Mock both so
    // the moderator surface's resolved meta declares `'authenticated'`
    // and the host deflects (without this mock the jsdom fetch fails
    // with ECONNREFUSED and the host renders the error UI instead).
    vi.spyOn(manifestModule, 'loadSurfaceManifest').mockResolvedValue({
      surfaces: {
        moderator: {
          moduleUrl: '/_surfaces/moderator/moderator.js',
          styleUrls: [],
        },
      },
    });
    vi.spyOn(manifestModule, 'importSurfaceModule').mockResolvedValue({
      mount: () => () => undefined,
      meta: { requiredAuthLevel: 'authenticated' },
    });
    vi.spyOn(manifestModule, 'injectStyles').mockReturnValue([]);
    const replaceSpy = vi.spyOn(window.location, 'replace').mockImplementation(() => undefined);

    renderWithProviders(<App />, { initialEntries: ['/m/sessions/new'] });

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledWith('/api/auth/login');
    });
    expect(window.sessionStorage.getItem('a-conversa:return-to')).toBe('/m/sessions/new');
  });

  it('posts /api/auth/logout and replaces the browser location from /logout', async () => {
    const replaceSpy = vi.spyOn(window.location, 'replace').mockImplementation(() => undefined);
    global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 204 })) as typeof fetch;

    renderWithProviders(<App />, {
      initialEntries: ['/logout'],
      auth: {
        status: 'authenticated',
        user: {
          userId: '00000000-0000-4000-8000-000000000003',
          screenName: 'alice',
        },
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    });
    expect(replaceSpy).toHaveBeenCalledWith('/login');
  });
});
