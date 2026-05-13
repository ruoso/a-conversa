// Smoke test for the moderator app skeleton + auth flow.
//
// Covers:
//   1. `initI18n` boots react-i18next + ICU off the canonical
//      `@a-conversa/i18n-catalogs` config and resolves the
//      `chrome.hello` example key per locale.
//   2. The router renders the four routes (`/login`, `/screen-name`,
//      `/sessions/:id/lobby`, `/sessions/:id/operate`) and the
//      unmatched-path redirect.
//   3. The auth hook + Login route + ScreenName route — the surface
//      `mod_auth_flow` adds (login button, welcome banner, logout,
//      screen-name form with validation + error mapping).
//   4. The client-side no-profile-data audit — the auth hook source
//      contains no OIDC profile-claim identifiers.
//
// Per ADR 0022 this is a committed test, not a throwaway probe.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18next from 'i18next';

import { App } from './App';
import { initI18n } from './i18n';

beforeAll(async () => {
  await initI18n('en-US');
});

afterEach(() => {
  cleanup();
});

// ────────────────────────────────────────────────────────────────────────
// `fetch` stub — every auth-related test installs a per-suite mock so
// the auth hook never reaches real network. The default behaviour is to
// reject with a "no stub installed" error so a missing stub fails
// loudly instead of hitting the real network. Each suite overrides
// `global.fetch` in its own `beforeEach` and restores in `afterEach`.
// ────────────────────────────────────────────────────────────────────────
const originalFetch = global.fetch;
afterAll(() => {
  global.fetch = originalFetch;
});

describe('moderator i18n bootstrap', () => {
  it('resolves the chrome.hello catalog key for en-US', () => {
    expect(i18next.t('chrome.hello')).toBe('hello, world');
  });

  it('resolves the chrome.hello catalog key for pt-BR via changeLanguage', async () => {
    await i18next.changeLanguage('pt-BR');
    expect(i18next.t('chrome.hello')).toBe('olá, mundo');
    await i18next.changeLanguage('en-US');
  });

  it('resolves the chrome.hello catalog key for es-419 via changeLanguage', async () => {
    await i18next.changeLanguage('es-419');
    expect(i18next.t('chrome.hello')).toBe('hola, mundo');
    await i18next.changeLanguage('en-US');
  });

  it('resolves the auth.login.title catalog key in every locale', async () => {
    await i18next.changeLanguage('en-US');
    expect(i18next.t('auth.login.title')).toBe('Sign in');
    await i18next.changeLanguage('pt-BR');
    expect(i18next.t('auth.login.title')).toBe('Entrar');
    await i18next.changeLanguage('es-419');
    expect(i18next.t('auth.login.title')).toBe('Iniciar sesión');
    await i18next.changeLanguage('en-US');
  });

  it('resolves the ICU-interpolated auth.login.welcome key with {name}', () => {
    expect(i18next.t('auth.login.welcome', { name: 'alice' })).toBe('Welcome, alice');
  });
});

describe('moderator router', () => {
  // The router tests render `/login`, which mounts the auth hook, which
  // calls `/auth/me`. Stub fetch to return 401 so the unauthenticated
  // branch renders.
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
  });

  it('renders the login route when the path is /login', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('route-login')).toBeTruthy();
    // After the auth hook resolves to unauthenticated, the login button
    // is rendered.
    await waitFor(() => {
      expect(screen.getByTestId('auth-login-button')).toBeTruthy();
    });
  });

  it('redirects unknown paths to /login', async () => {
    render(
      <MemoryRouter initialEntries={['/unknown-path']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('route-login')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('auth-login-button')).toBeTruthy();
    });
  });

  it('renders the lobby route with the session id captured from the path', () => {
    render(
      <MemoryRouter initialEntries={['/sessions/sess-123/lobby']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('route-lobby')).toBeTruthy();
    expect(screen.getByTestId('session-id').textContent).toBe('sess-123');
  });

  it('renders the operate route with the session id captured from the path', () => {
    render(
      <MemoryRouter initialEntries={['/sessions/sess-456/operate']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('route-operate')).toBeTruthy();
    expect(screen.getByTestId('session-id').textContent).toBe('sess-456');
  });
});

describe('Login route — auth states', () => {
  it('renders the login button for an unauthenticated caller', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      const btn = screen.getByTestId('auth-login-button');
      expect(btn.getAttribute('href')).toBe('/auth/login');
      expect(btn.textContent).toBe('Sign in with SSO');
    });
  });

  it('calls GET /auth/me with credentials: include on mount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    global.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/auth/me');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('renders the welcome banner + logout button when /auth/me returns a user', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          userId: '00000000-0000-4000-8000-000000000001',
          screenName: 'alice',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth-welcome').textContent).toBe('Welcome, alice');
    });
    expect(screen.getByTestId('auth-logout-button').textContent).toBe('Sign out');
  });

  it('discards extra fields on the /auth/me response (no profile data)', async () => {
    // Backend audit guards against the server emitting extra fields;
    // the client also self-defends by narrowing at the hook boundary.
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          userId: '00000000-0000-4000-8000-000000000002',
          screenName: 'bob',
          // Profile-data values the backend MUST never emit but the
          // client also MUST never render even if it did.
          email: 'bob@example.com',
          picture: 'https://example.com/bob.png',
          given_name: 'Bob',
          family_name: 'Smith',
          locale: 'en-GB',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth-welcome').textContent).toBe('Welcome, bob');
    });
    // The rendered DOM must contain none of the profile-claim values.
    const rendered = document.body.textContent ?? '';
    expect(rendered).not.toContain('bob@example.com');
    expect(rendered).not.toContain('https://example.com/bob.png');
    expect(rendered).not.toContain('Smith');
    expect(rendered).not.toContain('en-GB');
  });

  it('redirects to /screen-name when /auth/me reports the placeholder screen name', async () => {
    // Defensive: the backend should not put us here (the returning-user
    // callback skips issuing the session cookie for `<pending>` rows),
    // but the client transitions to `needs-screen-name` if it ever does.
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          userId: '00000000-0000-4000-8000-000000000003',
          screenName: '<pending>',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('route-screen-name')).toBeTruthy();
    });
  });

  it('renders the welcome banner pt-BR with ICU interpolation', async () => {
    await i18next.changeLanguage('pt-BR');
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          userId: '00000000-0000-4000-8000-000000000004',
          screenName: 'carol',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth-welcome').textContent).toBe('Bem-vinda(o), carol');
    });
    await i18next.changeLanguage('en-US');
  });

  it('logout posts /auth/logout with credentials: include', async () => {
    // Stub reload so the test doesn't try to navigate the test runner.
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    const fetchMock = vi
      .fn()
      // First call: /auth/me
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            userId: '00000000-0000-4000-8000-000000000005',
            screenName: 'dave',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      // Second call: /auth/logout
      .mockResolvedValueOnce(new Response('', { status: 204 }));
    global.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth-logout-button')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('auth-logout-button'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const [logoutUrl, logoutInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(logoutUrl).toBe('/auth/logout');
    expect(logoutInit.method).toBe('POST');
    expect(logoutInit.credentials).toBe('include');
    expect(reloadSpy).toHaveBeenCalled();
  });
});

describe('ScreenName route — form behavior', () => {
  it('disables submit when the input is empty or whitespace-only', () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const submit = screen.getByTestId<HTMLButtonElement>('screen-name-submit');
    const input = screen.getByTestId<HTMLInputElement>('screen-name-input');

    // Empty → disabled.
    expect(submit.disabled).toBe(true);

    // Whitespace-only → still disabled (trim is empty).
    fireEvent.change(input, { target: { value: '   ' } });
    expect(submit.disabled).toBe(true);

    // Non-empty after trim → enabled.
    fireEvent.change(input, { target: { value: ' alice ' } });
    expect(submit.disabled).toBe(false);
  });

  it('POSTs the trimmed screen name to /auth/screen-name', async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    const fetchMock = vi
      .fn()
      // /auth/me on mount → 401 unauthenticated.
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      // POST /auth/screen-name → 200 success.
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            userId: '00000000-0000-4000-8000-000000000006',
            screenName: 'alice',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      // auth.refresh() after success → /auth/me again → 200 authed.
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            userId: '00000000-0000-4000-8000-000000000006',
            screenName: 'alice',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    global.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = screen.getByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: '  alice  ' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });

    // Find the POST among the fetch calls.
    const postCall = fetchMock.mock.calls.find((c) => (c[0] as string) === '/auth/screen-name') as
      | [string, RequestInit]
      | undefined;
    expect(postCall).toBeDefined();
    expect(postCall?.[1].method).toBe('POST');
    expect(postCall?.[1].credentials).toBe('include');
    expect(JSON.parse(postCall?.[1].body as string)).toEqual({ screenName: 'alice' });
  });

  it('renders the localized too-long error when input exceeds 64 characters', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = screen.getByTestId('screen-name-input');
    // 65 visible characters (no surrounding whitespace).
    fireEvent.change(input, { target: { value: 'a'.repeat(65) } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('screen-name-error').textContent).toBe(
        'Display name must be at most 64 characters.',
      );
    });
  });

  it('renders the localized already-set error on server 409', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'screen-name-already-set',
              message: 'this account already has a screen name',
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
      );
    global.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = screen.getByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: 'alice' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('screen-name-error').textContent).toBe(
        'This account already has a display name.',
      );
    });
  });

  it('renders the localized pending-cookie-invalid error on server 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'auth-pending-cookie-invalid',
              message: 'authorization is missing or has expired',
            },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      );
    global.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = screen.getByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: 'alice' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('screen-name-error').textContent).toBe(
        'Your sign-in expired. Please sign in again.',
      );
    });
  });

  it('renders the generic error on an unrecognized server error code', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 'completely-unknown-code', message: 'something' },
          }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        ),
      );
    global.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = screen.getByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: 'alice' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('screen-name-error').textContent).toBe(
        'Could not save your display name. Please try again.',
      );
    });
  });

  it('caps the textbox at 256 characters via maxLength', () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = screen.getByTestId<HTMLInputElement>('screen-name-input');
    expect(input.maxLength).toBe(256);
  });
});

describe('no-profile-data audit on the moderator client', () => {
  it('useAuth.ts contains no OIDC profile-claim identifiers', () => {
    // Symmetric with `apps/server/src/auth/no-profile-data.test.ts`'s
    // Invariant 3 — a grep over the auth hook source confirms it
    // doesn't read any OIDC profile claim. The list mirrors the
    // backend audit's `PROFILE_DATA_VALUES` plus a few claim-name
    // aliases the client should never read off `/auth/me`.
    const here = fileURLToPath(import.meta.url);
    const path = resolve(here, '..', 'auth', 'useAuth.ts');
    const text = readFileSync(path, 'utf8');
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
    for (const ident of forbidden) {
      expect(text, `useAuth.ts must not reference ${ident}`).not.toContain(ident);
    }
  });
});
