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

// ────────────────────────────────────────────────────────────────────────
// Helper — fresh `Response` per call so multi-consumer fetches don't
// trip on body-already-consumed. With the `RequireAuth` gate in place,
// each protected-route mount fires `/auth/me` twice (once from the gate's
// `useAuth`, once from the route's `useAuth`); a single shared `Response`
// can't be read twice. `mockImplementation` constructs a new `Response`
// per call to side-step that.
// ────────────────────────────────────────────────────────────────────────
// Stub `/auth/me` to a fresh `needs-screen-name` response per call. When
// `onPostScreenName` is provided, `/auth/screen-name` POSTs return a fresh
// response from that builder. All other URLs 404.
function stubAuthMeNeedsScreenName(onPostScreenName?: () => Response): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    if (url === '/auth/me') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            userId: '00000000-0000-4000-8000-000000000007',
            screenName: '<pending>',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }
    if (url === '/auth/screen-name' && onPostScreenName) {
      return Promise.resolve(onPostScreenName());
    }
    return Promise.resolve(new Response('', { status: 404 }));
  });
}

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

  it('renders the lobby route with the session id captured from the path', async () => {
    // The lobby route is gated by `<RequireAuth mode="authenticated-only">`;
    // stub `/auth/me` to a fully-authed response so the gate renders
    // children rather than redirecting to `/login`.
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          userId: '00000000-0000-4000-8000-000000000010',
          screenName: 'alice',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    render(
      <MemoryRouter initialEntries={['/sessions/sess-123/lobby']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('route-lobby')).toBeTruthy();
    });
    expect(screen.getByTestId('session-id').textContent).toBe('sess-123');
  });

  it('renders the operate route with the session id captured from the path', async () => {
    // Same auth stub as the lobby case — the gate accepts the
    // `'authenticated'` status and renders children.
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          userId: '00000000-0000-4000-8000-000000000011',
          screenName: 'alice',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    render(
      <MemoryRouter initialEntries={['/sessions/sess-456/operate']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('route-operate')).toBeTruthy();
    });
    expect(screen.getByTestId('session-id').textContent).toBe('sess-456');
  });

  // /sessions/new/setup — the create-session form route, gated `authenticated-only`
  // by `<RequireAuth>`. Three sub-assertions cover the gate's three
  // observable cells for this route: authenticated renders the form,
  // unauthenticated redirects to /login, needs-screen-name redirects to
  // /screen-name. Mirrors the lobby + operate router-gate cases.
  describe('/sessions/new/setup — RequireAuth gate', () => {
    it('renders the create-session form when /auth/me reports authenticated', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              userId: '00000000-0000-4000-8000-00000000004a',
              screenName: 'alice',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      );
      render(
        <MemoryRouter initialEntries={['/sessions/new/setup']}>
          <App />
        </MemoryRouter>,
      );
      await waitFor(() => {
        expect(screen.getByTestId('route-create-session')).toBeTruthy();
      });
      expect(screen.getByTestId('route-title').textContent).toBe('Create a session');
    });

    it('redirects to /login when /auth/me reports unauthenticated', async () => {
      global.fetch = vi.fn(() => Promise.resolve(new Response('', { status: 401 })));
      render(
        <MemoryRouter initialEntries={['/sessions/new/setup']}>
          <App />
        </MemoryRouter>,
      );
      await waitFor(() => {
        expect(screen.getByTestId('route-login')).toBeTruthy();
      });
    });

    it('redirects to /screen-name when /auth/me reports the placeholder screen name', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              userId: '00000000-0000-4000-8000-00000000004b',
              screenName: '<pending>',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      );
      render(
        <MemoryRouter initialEntries={['/sessions/new/setup']}>
          <App />
        </MemoryRouter>,
      );
      await waitFor(() => {
        expect(screen.getByTestId('route-screen-name')).toBeTruthy();
      });
    });
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
    // Use `mockImplementation` so each `/auth/me` call (the gate AND the
    // route component each fire one) gets a fresh `Response` body.
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            userId: '00000000-0000-4000-8000-000000000003',
            screenName: '<pending>',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
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
  // All tests in this block need the gate to render the form, which
  // requires `status === 'needs-screen-name'`. Stub `/auth/me` to the
  // `<pending>` shape via `mockImplementation` so the multi-consumer
  // (gate + form) `useAuth()` calls each get a fresh response.
  it('disables submit when the input is empty or whitespace-only', async () => {
    global.fetch = stubAuthMeNeedsScreenName();

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const submit = await screen.findByTestId<HTMLButtonElement>('screen-name-submit');
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

    const fetchMock = stubAuthMeNeedsScreenName(
      () =>
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
    const input = await screen.findByTestId('screen-name-input');
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
    global.fetch = stubAuthMeNeedsScreenName();

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = await screen.findByTestId('screen-name-input');
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
    const fetchMock = stubAuthMeNeedsScreenName(
      () =>
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
    const input = await screen.findByTestId('screen-name-input');
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
    const fetchMock = stubAuthMeNeedsScreenName(
      () =>
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
    const input = await screen.findByTestId('screen-name-input');
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
    const fetchMock = stubAuthMeNeedsScreenName(
      () =>
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
    const input = await screen.findByTestId('screen-name-input');
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

  it('caps the textbox at 256 characters via maxLength', async () => {
    global.fetch = stubAuthMeNeedsScreenName();

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = await screen.findByTestId<HTMLInputElement>('screen-name-input');
    expect(input.maxLength).toBe(256);
  });
});

// ────────────────────────────────────────────────────────────────────────
// `mod_screen_name_setup` — UX polish on top of `mod_auth_flow`'s form:
//   - client-side mirror of the backend's NFKC + control-char + bidi-
//     override + printable-class checks (immediate inline feedback)
//   - accessibility wiring (aria-invalid / aria-describedby / aria-live,
//     a character-count helper, autoComplete=off, inputMode=text)
//   - focus management (autoFocus on mount via ref + re-focus after a
//     server-side error so the aria-live announcement is heard)
// Per ADR 0022 these are committed tests, not throwaway probes.
// ────────────────────────────────────────────────────────────────────────
describe('ScreenName route — client-side mirror of backend validation', () => {
  beforeEach(() => {
    global.fetch = stubAuthMeNeedsScreenName();
  });

  it('rejects a name containing an RLO (bidi-override) without POSTing', async () => {
    const fetchMock = stubAuthMeNeedsScreenName();
    global.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = await screen.findByTestId('screen-name-input');
    // 'alice' + RLO + 'admin' — the audience-broadcast-spoof case from
    // F-010. The client mirror catches it before the POST.
    fireEvent.change(input, { target: { value: 'alice‮admin' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('screen-name-error').textContent).toBe(
        'Display name contains a disallowed character (control / bidi-override / non-printable).',
      );
    });
    // No POST should have happened — only the initial /auth/me GET.
    const postCall = fetchMock.mock.calls.find((c) => (c[0] as string) === '/auth/screen-name');
    expect(postCall).toBeUndefined();
  });

  it('rejects a name containing a ZWJ (zero-width joiner) without POSTing', async () => {
    const fetchMock = stubAuthMeNeedsScreenName();
    global.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = await screen.findByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: 'alice‍bob' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('screen-name-error').textContent).toBe(
        'Display name contains a disallowed character (control / bidi-override / non-printable).',
      );
    });
    const postCall = fetchMock.mock.calls.find((c) => (c[0] as string) === '/auth/screen-name');
    expect(postCall).toBeUndefined();
  });

  it('rejects a name containing a NUL (C0 control) without POSTing', async () => {
    const fetchMock = stubAuthMeNeedsScreenName();
    global.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = await screen.findByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: 'alice\u0000' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('screen-name-error').textContent).toBe(
        'Display name contains a disallowed character (control / bidi-override / non-printable).',
      );
    });
    const postCall = fetchMock.mock.calls.find((c) => (c[0] as string) === '/auth/screen-name');
    expect(postCall).toBeUndefined();
  });

  it('POSTs the NFKC-normalized form (ligature `ﬁle` → `file`) on success', async () => {
    const fetchMock = stubAuthMeNeedsScreenName(
      () =>
        new Response(
          JSON.stringify({
            userId: '00000000-0000-4000-8000-00000000000a',
            screenName: 'file',
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
    const input = await screen.findByTestId('screen-name-input');
    // U+FB01 LATIN SMALL LIGATURE FI — NFKC decomposes to U+0066 U+0069.
    fireEvent.change(input, { target: { value: 'ﬁle' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    const postCall = fetchMock.mock.calls.find((c) => (c[0] as string) === '/auth/screen-name') as
      | [string, RequestInit]
      | undefined;
    expect(postCall).toBeDefined();
    expect(JSON.parse(postCall?.[1].body as string)).toEqual({ screenName: 'file' });
  });

  it('maps the server `screen-name-invalid` envelope to the invalidCharacter key', async () => {
    // Corner case: the client mirror passed but the server rejected
    // (e.g. a post-NFKC re-trim landed on empty, or a future server-side
    // rule the client hasn't mirrored yet). The localized message
    // surfaces invalidCharacter — the safest fallback now that empty /
    // whitespace / too-long paths are caught client-side first.
    const fetchMock = stubAuthMeNeedsScreenName(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'screen-name-invalid',
              message: 'screenName contains a disallowed character',
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
    );
    global.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = await screen.findByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: 'alice' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('screen-name-error').textContent).toBe(
        'Display name contains a disallowed character (control / bidi-override / non-printable).',
      );
    });
  });

  it('resolves the new auth.screenName.errors.invalidCharacter key in every locale', async () => {
    await i18next.changeLanguage('en-US');
    expect(i18next.t('auth.screenName.errors.invalidCharacter')).toBe(
      'Display name contains a disallowed character (control / bidi-override / non-printable).',
    );
    await i18next.changeLanguage('pt-BR');
    expect(i18next.t('auth.screenName.errors.invalidCharacter')).toBe(
      'O nome de exibição contém um caractere não permitido (controle / bidi / não imprimível).',
    );
    await i18next.changeLanguage('es-419');
    expect(i18next.t('auth.screenName.errors.invalidCharacter')).toBe(
      'El nombre contiene un carácter no permitido (control / bidi / no imprimible).',
    );
    await i18next.changeLanguage('en-US');
  });
});

describe('ScreenName route — accessibility + helper text + focus', () => {
  beforeEach(() => {
    global.fetch = stubAuthMeNeedsScreenName();
  });

  it('renders the character-count helper with 0/64 on mount', async () => {
    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('screen-name-helper').textContent).toBe('0/64 characters');
    });
  });

  it('updates the character-count helper as the user types (trimmed length)', async () => {
    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = await screen.findByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: '  alice  ' } });
    await waitFor(() => {
      // Helper reports trimmed length so the user sees what the server
      // will count against the 64-character cap.
      expect(screen.getByTestId('screen-name-helper').textContent).toBe('5/64 characters');
    });
  });

  it('sets aria-describedby on the input pointing to helper + error ids', async () => {
    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = await screen.findByTestId<HTMLInputElement>('screen-name-input');
    expect(input.getAttribute('aria-describedby')).toBe('screen-name-helper screen-name-error');
  });

  it('toggles aria-invalid on the input when an error is shown', async () => {
    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = await screen.findByTestId<HTMLInputElement>('screen-name-input');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    fireEvent.change(input, { target: { value: 'alice‮admin' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(input.getAttribute('aria-invalid')).toBe('true');
    });
    // Typing clears the error → aria-invalid resets.
    fireEvent.change(input, { target: { value: 'alice' } });
    await waitFor(() => {
      expect(input.getAttribute('aria-invalid')).toBe('false');
    });
  });

  it('sets autoComplete=off and inputMode=text on the input', async () => {
    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = await screen.findByTestId<HTMLInputElement>('screen-name-input');
    // A screen name is not a stored credential; off is the right hint.
    expect(input.getAttribute('autocomplete')).toBe('off');
    // Mobile keyboard hint: plain text (not numeric, not email, etc.).
    expect(input.getAttribute('inputmode')).toBe('text');
  });

  it('marks the error region with role=alert AND aria-live=polite + aria-atomic', async () => {
    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    const input = await screen.findByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: 'alice\u0000' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      const errorRegion = screen.getByTestId('screen-name-error');
      // `role=alert` is the assertive variant; `aria-live=polite` queues
      // in the polite channel. Different ATs implement one or the
      // other; both attributes cost nothing extra and broaden coverage.
      expect(errorRegion.getAttribute('role')).toBe('alert');
      expect(errorRegion.getAttribute('aria-live')).toBe('polite');
      expect(errorRegion.getAttribute('aria-atomic')).toBe('true');
    });
  });

  it('focuses the input on mount', async () => {
    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      const input = screen.getByTestId<HTMLInputElement>('screen-name-input');
      // The `useEffect` runs after the initial render; assert focus
      // landed on the input rather than the document body.
      expect(document.activeElement).toBe(input);
    });
  });

  it('returns focus to the input after a server-side error', async () => {
    const fetchMock = stubAuthMeNeedsScreenName(
      () =>
        new Response(
          JSON.stringify({
            error: { code: 'screen-name-already-set', message: 'already set' },
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
    const input = await screen.findByTestId<HTMLInputElement>('screen-name-input');
    fireEvent.change(input, { target: { value: 'alice' } });
    // Click the submit button (focus shifts to it from the input).
    const submitBtn = screen.getByTestId<HTMLButtonElement>('screen-name-submit');
    submitBtn.focus();
    expect(document.activeElement).toBe(submitBtn);
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      // After the server-error response, focus returns to the input so
      // the aria-live announcement is heard at the right context.
      expect(document.activeElement).toBe(input);
    });
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
