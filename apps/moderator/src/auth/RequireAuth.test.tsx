import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthValueProvider, I18nProvider, type AuthContextValue } from '@a-conversa/shell';

import { RequireAuth } from './RequireAuth';
import { getTestI18n } from '../testing/renderWithProviders';

let testI18n: Awaited<ReturnType<typeof getTestI18n>>;

beforeAll(async () => {
  testI18n = await getTestI18n();
});

afterEach(() => {
  cleanup();
});

function renderGate(
  auth: AuthContextValue,
  mode: 'authenticated-only' | 'needs-screen-name-only',
): void {
  render(
    <I18nProvider i18n={testI18n}>
      <AuthValueProvider value={auth}>
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route
              path="/protected"
              element={
                <RequireAuth mode={mode}>
                  <div data-testid="protected">protected</div>
                </RequireAuth>
              }
            />
            <Route path="/login" element={<div data-testid="login-route">login</div>} />
            <Route
              path="/screen-name"
              element={<div data-testid="screen-name-route">screen-name</div>}
            />
          </Routes>
        </MemoryRouter>
      </AuthValueProvider>
    </I18nProvider>,
  );
}

describe('RequireAuth', () => {
  it('renders the loading frame while auth is loading', () => {
    renderGate(
      {
        status: 'loading',
        refresh: () => undefined,
        logout: () => undefined,
      },
      'authenticated-only',
    );

    expect(screen.getByTestId('route-login')).toBeTruthy();
    expect(screen.getByTestId('auth-checking')).toBeTruthy();
  });

  it('redirects unauthenticated users to /login for authenticated-only routes', () => {
    renderGate(
      {
        status: 'unauthenticated',
        refresh: () => undefined,
        logout: () => undefined,
      },
      'authenticated-only',
    );

    expect(screen.getByTestId('login-route')).toBeTruthy();
  });

  it('redirects needs-screen-name users to /screen-name for authenticated-only routes', () => {
    renderGate(
      {
        status: 'needs-screen-name',
        refresh: () => undefined,
        logout: () => undefined,
      },
      'authenticated-only',
    );

    expect(screen.getByTestId('screen-name-route')).toBeTruthy();
  });

  it('renders children for authenticated users on authenticated-only routes', () => {
    renderGate(
      {
        status: 'authenticated',
        user: {
          userId: '00000000-0000-4000-8000-000000000021',
          screenName: 'alice',
        },
        refresh: () => undefined,
        logout: () => undefined,
      },
      'authenticated-only',
    );

    expect(screen.getByTestId('protected')).toBeTruthy();
  });

  it('renders children for needs-screen-name-only routes when the auth state matches', () => {
    renderGate(
      {
        status: 'needs-screen-name',
        refresh: () => undefined,
        logout: () => undefined,
      },
      'needs-screen-name-only',
    );

    expect(screen.getByTestId('protected')).toBeTruthy();
  });
});
