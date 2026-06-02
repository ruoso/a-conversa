// Smoke tests for the shell's auth subsystem (`AuthProvider` + `useAuth`).
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// Covers:
//   - Bootstrap matrix: 200/200-needs-screen-name/401/5xx/malformed/network
//     responses lead to the documented `status` transitions plus the
//     documented `error` shapes.
//   - Refresh: `auth.refresh()` re-fires `/api/auth/me` and re-resolves
//     the status.
//   - Logout: `auth.logout()` POSTs `/api/auth/logout` with
//     `credentials: 'include'` and calls `window.location.reload()`.
//   - One-fetch-per-provider pin (the consolidation regression-pin
//     introduced by this extraction): N=4 children each call `useAuth()`,
//     `fetch` is invoked exactly once with `/api/auth/me`.
//   - `useAuth()` outside a provider throws.
//   - No-OIDC-profile-data audit: greps the shell's auth source files
//     for the forbidden OIDC identifier list.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

import { AuthProvider } from './AuthProvider.js';
import { useAuth } from './useAuth.js';

const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  cleanup();
});

afterAll(() => {
  global.fetch = ORIGINAL_FETCH;
});

interface ProbeProps {
  readonly testId?: string;
}

function AuthProbe(props: ProbeProps): ReactElement {
  const auth = useAuth();
  return (
    <span data-testid={props.testId ?? 'auth-probe'}>
      {auth.status}|{auth.user?.screenName ?? ''}|{auth.error?.code ?? ''}
    </span>
  );
}

function fetchOk(body: unknown) {
  return vi.fn((_input?: URL | RequestInfo) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

function fetchStatus(status: number, body = '') {
  return vi.fn(() => Promise.resolve(new Response(body, { status })));
}

describe('AuthProvider — bootstrap matrix', () => {
  it('200 + {userId, screenName: "alice"} → authenticated', async () => {
    global.fetch = fetchOk({
      userId: '00000000-0000-4000-8000-000000000001',
      screenName: 'alice',
    });
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth-probe').textContent).toBe('authenticated|alice|');
    });
  });

  it('200 + screenName: "<pending>" → needs-screen-name', async () => {
    global.fetch = fetchOk({
      userId: '00000000-0000-4000-8000-000000000002',
      screenName: '<pending>',
    });
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth-probe').textContent).toBe('needs-screen-name|<pending>|');
    });
  });

  it('401 → unauthenticated (no error slot)', async () => {
    global.fetch = fetchStatus(401);
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth-probe').textContent).toBe('unauthenticated||');
    });
  });

  it('5xx → unauthenticated + error.code=auth-me-failed', async () => {
    global.fetch = fetchStatus(500);
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth-probe').textContent).toBe('unauthenticated||auth-me-failed');
    });
  });

  it('malformed body → unauthenticated + error.code=auth-me-malformed', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ something: 'else' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth-probe').textContent).toBe(
        'unauthenticated||auth-me-malformed',
      );
    });
  });

  it('network error → unauthenticated + error.code=network-error', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('boom')));
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth-probe').textContent).toBe('unauthenticated||network-error');
    });
  });
});

describe('AuthProvider — refresh + logout', () => {
  it('refresh() re-fires /api/auth/me and re-resolves the status', async () => {
    // First call: 401 (unauthenticated); second call: 200 (authenticated).
    let callCount = 0;
    global.fetch = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(new Response('', { status: 401 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            userId: '00000000-0000-4000-8000-000000000003',
            screenName: 'bob',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });

    function RefreshProbe(): ReactElement {
      const auth = useAuth();
      return (
        <>
          <AuthProbe />
          <button
            type="button"
            data-testid="refresh-btn"
            onClick={() => {
              void auth.refresh();
            }}
          >
            refresh
          </button>
        </>
      );
    }

    render(
      <AuthProvider>
        <RefreshProbe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth-probe').textContent).toBe('unauthenticated||');
    });
    await act(async () => {
      screen.getByTestId('refresh-btn').click();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('auth-probe').textContent).toBe('authenticated|bob|');
    });
  });

  it('logout() POSTs /api/auth/logout with credentials:include and calls reload()', async () => {
    const reloadSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- we only restore the reference, never call it directly.
    const originalReload = window.location.reload;
    // happy-dom's window.location.reload is configurable.
    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value: reloadSpy,
    });

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') {
        return Promise.resolve(new Response('', { status: 401 }));
      }
      if (url === '/api/auth/logout') {
        expect(init?.method).toBe('POST');
        expect(init?.credentials).toBe('include');
        return Promise.resolve(new Response('', { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    global.fetch = fetchMock as typeof fetch;

    function LogoutProbe(): ReactElement {
      const auth = useAuth();
      return (
        <button
          type="button"
          data-testid="logout-btn"
          onClick={() => {
            void auth.logout();
          }}
        >
          logout
        </button>
      );
    }

    render(
      <AuthProvider>
        <LogoutProbe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    await act(async () => {
      screen.getByTestId('logout-btn').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalled();
    });
    const logoutCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/auth/logout');
    expect(logoutCalls).toHaveLength(1);

    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value: originalReload,
    });
  });
});

describe('AuthProvider — single-fetch consolidation', () => {
  it('N=4 children calling useAuth() trigger /api/auth/me exactly once', async () => {
    const fetchMock = fetchOk({
      userId: '00000000-0000-4000-8000-000000000004',
      screenName: 'carol',
    });
    global.fetch = fetchMock;

    render(
      <AuthProvider>
        <AuthProbe testId="probe-1" />
        <AuthProbe testId="probe-2" />
        <AuthProbe testId="probe-3" />
        <AuthProbe testId="probe-4" />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('probe-1').textContent).toBe('authenticated|carol|');
    });
    const meCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/auth/me');
    expect(meCalls).toHaveLength(1);
  });
});

describe('useAuth — provider-required', () => {
  beforeEach(() => {
    global.fetch = fetchStatus(401);
  });

  it('useAuth() outside <AuthProvider> throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<AuthProbe />)).toThrow(/useAuth must be called inside/);
    errorSpy.mockRestore();
  });
});

describe('no-profile-data audit on the shell auth source', () => {
  it('shell auth source files contain no OIDC profile-claim identifiers', () => {
    const here = fileURLToPath(import.meta.url);
    const dir = resolve(here, '..');
    const filesToAudit = ['AuthProvider.tsx', 'useAuth.ts', 'types.ts', 'AuthContext.ts'];
    const forbidden = [
      'email',
      'picture',
      'given_name',
      'givenName',
      'family_name',
      'familyName',
      'preferred_username',
      'preferredUsername',
      'oauthSubject',
      'fetchUserInfo',
    ];
    for (const file of filesToAudit) {
      const text = readFileSync(resolve(dir, file), 'utf8');
      for (const ident of forbidden) {
        expect(text, `${file} must not reference ${ident}`).not.toContain(ident);
      }
    }
  });
});
