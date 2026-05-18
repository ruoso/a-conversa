import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';

import { type AuthContextValue } from '@a-conversa/shell';

import { SurfaceHost } from './SurfaceHost';
import * as manifestModule from './manifest';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

beforeAll(async () => {
  await getTestI18n();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('SurfaceHost', () => {
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: {
      userId: '00000000-0000-4000-8000-000000000004',
      screenName: 'alice',
    },
    refresh: () => undefined,
    logout: () => undefined,
  };

  it('loads the moderator manifest entry and mounts it with the provided basename', async () => {
    const mount = vi.fn(() => () => undefined);

    vi.spyOn(manifestModule, 'loadSurfaceManifest').mockResolvedValue({
      surfaces: {
        moderator: {
          moduleUrl: '/_surfaces/moderator/moderator.js',
          styleUrls: ['/_surfaces/moderator/moderator.css'],
        },
      },
    });
    vi.spyOn(manifestModule, 'importSurfaceModule').mockResolvedValue({ mount });
    const injectStylesSpy = vi.spyOn(manifestModule, 'injectStyles').mockReturnValue([]);

    renderWithProviders(<SurfaceHost surfaceId="moderator" routerBasePath="/m" />, {
      auth,
      initialEntries: ['/m/sessions/new'],
    });

    await waitFor(() => {
      expect(mount).toHaveBeenCalledTimes(1);
    });
    const firstCall = mount.mock.calls.at(0) as [{ routerBasePath: string }] | undefined;
    expect(firstCall?.[0].routerBasePath).toBe('/m');
    expect(injectStylesSpy).toHaveBeenCalledWith(['/_surfaces/moderator/moderator.css']);
  });

  it('renders an error state when the manifest omits the requested surface', async () => {
    vi.spyOn(manifestModule, 'loadSurfaceManifest').mockResolvedValue({
      surfaces: {},
    });

    renderWithProviders(<SurfaceHost surfaceId="moderator" routerBasePath="/m" />, {
      auth,
      initialEntries: ['/m/sessions/new'],
    });

    await waitFor(() => {
      expect(screen.getByTestId('surface-load-error')).toBeTruthy();
    });
  });

  // The three cases below pin the host's `meta.requiredAuthLevel`
  // branch landed by `aud_no_auth_for_public`. See the refinement at
  // `tasks/refinements/audience/aud_no_auth_for_public.md` (Decisions
  // §1 + §6 + the "Vitest cases" subsection of "Constraints /
  // requirements"). Together they pin: (a) public surfaces mount
  // under an unauthenticated `auth` value without the redirect, (b)
  // missing meta still defaults to the authenticated-only deflection,
  // and (c) an explicit `'authenticated'` meta keeps gating — i.e.
  // the moderator's + participant's existing behavior is preserved.

  const anonymousAuth: AuthContextValue = {
    status: 'unauthenticated',
    refresh: () => undefined,
    logout: () => undefined,
  };

  const RETURN_TO_KEY = 'a-conversa:return-to';

  it('mounts a surface whose meta declares requiredAuthLevel="public" even when auth.status is "unauthenticated"', async () => {
    const mount = vi.fn(() => () => undefined);

    vi.spyOn(manifestModule, 'loadSurfaceManifest').mockResolvedValue({
      surfaces: {
        audience: {
          moduleUrl: '/_surfaces/audience/audience.js',
          styleUrls: [],
        },
      },
    });
    vi.spyOn(manifestModule, 'importSurfaceModule').mockResolvedValue({
      mount,
      meta: { requiredAuthLevel: 'public' },
    });
    vi.spyOn(manifestModule, 'injectStyles').mockReturnValue([]);

    // Pre-clean the return-to slot — Decision §6 says public-surface
    // mounts MUST NOT write it.
    window.sessionStorage.removeItem(RETURN_TO_KEY);

    renderWithProviders(<SurfaceHost surfaceId="audience" routerBasePath="/a" />, {
      auth: anonymousAuth,
      initialEntries: ['/a/sessions/00000000-0000-4000-8000-000000000099'],
    });

    await waitFor(() => {
      expect(mount).toHaveBeenCalledTimes(1);
    });
    const firstCall = mount.mock.calls.at(0) as
      | [{ auth: AuthContextValue; routerBasePath: string }]
      | undefined;
    // Surface receives the real unauthenticated AuthContextValue
    // verbatim — no synthesized "anonymous user" identity (Decision §5).
    expect(firstCall?.[0].auth.status).toBe('unauthenticated');
    expect(firstCall?.[0].auth.user).toBeUndefined();
    expect(firstCall?.[0].routerBasePath).toBe('/a');
    // No deflection: the surface container renders.
    expect(screen.queryByTestId('surface-container-audience')).not.toBeNull();
    // And the rememberReturnTo bookkeeping did NOT fire (Decision §6).
    expect(window.sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
  });

  it("continues to deflect to /login when a surface's meta omits requiredAuthLevel (defaults to authenticated)", async () => {
    const mount = vi.fn(() => () => undefined);

    vi.spyOn(manifestModule, 'loadSurfaceManifest').mockResolvedValue({
      surfaces: {
        moderator: {
          moduleUrl: '/_surfaces/moderator/moderator.js',
          styleUrls: [],
        },
      },
    });
    vi.spyOn(manifestModule, 'importSurfaceModule').mockResolvedValue({
      mount,
      // Explicitly no meta — the host must default to 'authenticated'.
    });
    vi.spyOn(manifestModule, 'injectStyles').mockReturnValue([]);

    renderWithProviders(<SurfaceHost surfaceId="moderator" routerBasePath="/m" />, {
      auth: anonymousAuth,
      initialEntries: ['/m/sessions/new'],
    });

    // The deflection happens after the dynamic import resolves; wait
    // for the rememberReturnTo write that immediately precedes
    // `<Navigate to="/login">`. Surface MUST NOT mount. The original
    // pathname is what `rememberReturnTo` records — note the test
    // renders SurfaceHost without a wrapping `<Routes>`, so after the
    // `<Navigate>` flips the MemoryRouter location to `/login`,
    // SurfaceHost stays mounted and re-renders; `sanitizeReturnTo`
    // collapses that second write to `/`. We assert on the FIRST
    // observed write by re-checking before the re-render lands.
    await waitFor(() => {
      expect(mount).not.toHaveBeenCalled();
      const written = window.sessionStorage.getItem(RETURN_TO_KEY);
      // Either the first write (the value a real `<Routes>`-wrapped
      // App would persist) or the second-render collapse to `/`. Both
      // prove the deflection fired and `rememberReturnTo` was called.
      expect(written === '/m/sessions/new' || written === '/').toBe(true);
    });
    expect(mount).not.toHaveBeenCalled();
  });

  it('continues to deflect to /login when a surface\'s meta declares requiredAuthLevel="authenticated" explicitly', async () => {
    const mount = vi.fn(() => () => undefined);

    vi.spyOn(manifestModule, 'loadSurfaceManifest').mockResolvedValue({
      surfaces: {
        moderator: {
          moduleUrl: '/_surfaces/moderator/moderator.js',
          styleUrls: [],
        },
      },
    });
    vi.spyOn(manifestModule, 'importSurfaceModule').mockResolvedValue({
      mount,
      meta: { requiredAuthLevel: 'authenticated' },
    });
    vi.spyOn(manifestModule, 'injectStyles').mockReturnValue([]);

    renderWithProviders(<SurfaceHost surfaceId="moderator" routerBasePath="/m" />, {
      auth: anonymousAuth,
      initialEntries: ['/m/sessions/new'],
    });

    // Same shape as case 2 — the explicit `'authenticated'` declaration
    // must drive the same deflection (mount NOT called; `rememberReturnTo`
    // fires).
    await waitFor(() => {
      expect(mount).not.toHaveBeenCalled();
      const written = window.sessionStorage.getItem(RETURN_TO_KEY);
      expect(written === '/m/sessions/new' || written === '/').toBe(true);
    });
    expect(mount).not.toHaveBeenCalled();
  });
});
