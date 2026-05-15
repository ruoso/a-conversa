// Tests for the `RequireAuth` route-level auth gate.
//
// Refinement: tasks/refinements/moderator-ui/mod_route_auth_gate.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: moderator_ui.mod_shell.mod_route_auth_gate
//
// Pins all 12 cells of the (3 routes × 4 statuses) redirect table from
// the refinement's "Redirect loops — the rule" section, plus a
// regression assertion that `/login` is NOT wrapped by the gate (the
// in-component four-state switch in `Login.tsx` handles that route).
// Per ADR 0022 these cases are the committed probes for the gate's
// observable behavior; they are not throwaway sanity checks.
//
// Each `(route, status)` cell is its own `it()` case; the names embed
// both axes so a failing test reports the exact cell it pins.
//
// `fetch` stubbing — mirrors `App.test.tsx`. The four `AuthStatus`
// values are produced by these `/auth/me` shapes:
//   - 401                                        → 'unauthenticated'
//   - 200 + { userId, screenName: '<pending>' }  → 'needs-screen-name'
//   - 200 + { userId, screenName: 'alice' }      → 'authenticated'
//   - never-resolving fetch                       → 'loading'
// The `mockImplementation` form returns a fresh `Response` per call so
// the multi-consumer fetches (the gate's `useAuth` AND the wrapped
// route's `useAuth` each fire one) don't trip on body-already-consumed.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { App } from '../App';
import { initI18n } from '../i18n';

beforeAll(async () => {
  await initI18n('en-US');
});

afterEach(() => {
  cleanup();
});

const originalFetch = global.fetch;
afterAll(() => {
  global.fetch = originalFetch;
});

// ────────────────────────────────────────────────────────────────────────
// `/auth/me` fetch-stub helpers, one per `AuthStatus` value. Each
// constructs a fresh `Response` per call to handle the gate-plus-route
// double-consumer pattern.
// ────────────────────────────────────────────────────────────────────────

function fetchUnauthenticated(): ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.resolve(new Response('', { status: 401 })));
}

function fetchNeedsScreenName(): ReturnType<typeof vi.fn> {
  return vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          userId: '00000000-0000-4000-8000-000000000020',
          screenName: '<pending>',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
}

function fetchAuthenticated(): ReturnType<typeof vi.fn> {
  return vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          userId: '00000000-0000-4000-8000-000000000021',
          screenName: 'alice',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
}

// Returns a `fetch` that never resolves. The auth hook stays in
// `'loading'` for the duration of the test, so the gate renders the
// placeholder DOM. The test asserts on that DOM synchronously after
// `render` — no `await waitFor` for a final state, since there is none.
function fetchPendingForever(): ReturnType<typeof vi.fn> {
  return vi.fn(
    () =>
      new Promise<Response>(() => {
        /* never resolves */
      }),
  );
}

// ────────────────────────────────────────────────────────────────────────
// (route × status) cells from the refinement's redirect table:
//
//   state \ route        | /screen-name           | /sessions/:id/lobby   | /sessions/:id/operate
//   ---------------------|------------------------|-----------------------|------------------------
//   'loading'            | placeholder            | placeholder           | placeholder
//   'unauthenticated'    | → /login               | → /login              | → /login
//   'needs-screen-name'  | render children (form) | → /screen-name        | → /screen-name
//   'authenticated'      | → /login               | render children       | render children
//
// Each describe block below pins one route's column.
// ────────────────────────────────────────────────────────────────────────

describe('RequireAuth — /screen-name (mode: needs-screen-name-only)', () => {
  it('/screen-name with loading status renders the placeholder DOM', () => {
    global.fetch = fetchPendingForever();

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    // Loading-frame DOM mirrors Login.tsx:31-38 — `route-login` main +
    // `route-title` + `auth-checking` testids, all i18n-resolved.
    expect(screen.getByTestId('route-login')).toBeTruthy();
    expect(screen.getByTestId('route-title').textContent).toBe('Sign in');
    expect(screen.getByTestId('auth-checking').textContent).toBe('Checking session…');
  });

  it('/screen-name with unauthenticated status redirects to /login', async () => {
    global.fetch = fetchUnauthenticated();

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    // After the gate redirects to /login, the Login route renders the
    // SSO button (the unauthenticated branch of its in-component switch).
    await waitFor(() => {
      expect(screen.getByTestId('auth-login-button')).toBeTruthy();
    });
  });

  it('/screen-name with needs-screen-name status renders the form', async () => {
    global.fetch = fetchNeedsScreenName();

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    // The accepting branch — children render.
    await waitFor(() => {
      expect(screen.getByTestId('route-screen-name')).toBeTruthy();
    });
  });

  it('/screen-name with authenticated status redirects to /login', async () => {
    global.fetch = fetchAuthenticated();

    render(
      <MemoryRouter initialEntries={['/screen-name']}>
        <App />
      </MemoryRouter>,
    );
    // The Login route renders the welcome banner for an authed user;
    // assert on that testid to prove the navigation landed.
    await waitFor(() => {
      expect(screen.getByTestId('auth-welcome')).toBeTruthy();
    });
  });
});

describe('RequireAuth — /sessions/:id/lobby (mode: authenticated-only)', () => {
  it('/sessions/abc/lobby with loading status renders the placeholder DOM', () => {
    global.fetch = fetchPendingForever();

    render(
      <MemoryRouter initialEntries={['/sessions/abc/lobby']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('route-login')).toBeTruthy();
    expect(screen.getByTestId('route-title').textContent).toBe('Sign in');
    expect(screen.getByTestId('auth-checking').textContent).toBe('Checking session…');
  });

  it('/sessions/abc/lobby with unauthenticated status redirects to /login', async () => {
    global.fetch = fetchUnauthenticated();

    render(
      <MemoryRouter initialEntries={['/sessions/abc/lobby']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth-login-button')).toBeTruthy();
    });
  });

  it('/sessions/abc/lobby with needs-screen-name status redirects to /screen-name', async () => {
    global.fetch = fetchNeedsScreenName();

    render(
      <MemoryRouter initialEntries={['/sessions/abc/lobby']}>
        <App />
      </MemoryRouter>,
    );
    // The half-authed user lands on the screen-name form rather than an
    // empty lobby canvas.
    await waitFor(() => {
      expect(screen.getByTestId('route-screen-name')).toBeTruthy();
    });
  });

  it('/sessions/abc/lobby with authenticated status renders the lobby', async () => {
    global.fetch = fetchAuthenticated();

    render(
      <MemoryRouter initialEntries={['/sessions/abc/lobby']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('route-lobby')).toBeTruthy();
    });
    // The session id captured from the path is still wired through the
    // wrapped route — a small extra pin that proves children render
    // with their normal params, not a stripped-down shell.
    expect(screen.getByTestId('session-id').textContent).toBe('abc');
  });
});

describe('RequireAuth — /sessions/:id/operate (mode: authenticated-only)', () => {
  it('/sessions/abc/operate with loading status renders the placeholder DOM', () => {
    global.fetch = fetchPendingForever();

    render(
      <MemoryRouter initialEntries={['/sessions/abc/operate']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('route-login')).toBeTruthy();
    expect(screen.getByTestId('route-title').textContent).toBe('Sign in');
    expect(screen.getByTestId('auth-checking').textContent).toBe('Checking session…');
  });

  it('/sessions/abc/operate with unauthenticated status redirects to /login', async () => {
    global.fetch = fetchUnauthenticated();

    render(
      <MemoryRouter initialEntries={['/sessions/abc/operate']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth-login-button')).toBeTruthy();
    });
  });

  it('/sessions/abc/operate with needs-screen-name status redirects to /screen-name', async () => {
    global.fetch = fetchNeedsScreenName();

    render(
      <MemoryRouter initialEntries={['/sessions/abc/operate']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('route-screen-name')).toBeTruthy();
    });
  });

  it('/sessions/abc/operate with authenticated status renders the operate console', async () => {
    global.fetch = fetchAuthenticated();

    render(
      <MemoryRouter initialEntries={['/sessions/abc/operate']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('route-operate')).toBeTruthy();
    });
  });
});

describe('RequireAuth — /login is not wrapped by the gate', () => {
  it('/login with authenticated status renders the welcome banner directly', async () => {
    // If the gate wrapped /login, an `'authenticated'` user on a
    // `'needs-screen-name-only'` mode (or any mode) would loop into a
    // redirect. The in-component switch in Login.tsx handles all four
    // states directly. This assertion proves the wrapper is not on the
    // /login route — the welcome banner renders without bouncing.
    global.fetch = fetchAuthenticated();

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth-welcome').textContent).toBe('Welcome, alice');
    });
  });
});
