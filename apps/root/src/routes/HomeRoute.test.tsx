import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { HomeRoute } from './HomeRoute';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

beforeAll(async () => {
  await getTestI18n();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function ScreenNameStub(): ReactElement {
  return <main data-testid="route-screen-name-stub" />;
}

function LoginStub(): ReactElement {
  return <main data-testid="route-login-stub" />;
}

function DeepLinkStub(): ReactElement {
  return <main data-testid="route-deep-link-stub" />;
}

function renderHome(options: Parameters<typeof renderWithProviders>[1]) {
  return renderWithProviders(
    <Routes>
      <Route path="/home" element={<HomeRoute />} />
      <Route path="/login" element={<LoginStub />} />
      <Route path="/screen-name" element={<ScreenNameStub />} />
      <Route path="/m/sessions/new" element={<DeepLinkStub />} />
    </Routes>,
    { ...(options ?? {}), initialEntries: ['/home'] },
  );
}

describe('HomeRoute', () => {
  it('renders the LoadingFrame while auth is resolving and does not render route-home', async () => {
    renderHome({
      auth: {
        status: 'loading',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-checking')).toBeTruthy();
    });
    expect(screen.queryByTestId('route-home')).toBeNull();
  });

  it('navigates to /screen-name when status is needs-screen-name', async () => {
    renderHome({
      auth: {
        status: 'needs-screen-name',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-screen-name-stub')).toBeTruthy();
    });
    expect(screen.queryByTestId('route-home')).toBeNull();
  });

  it('redirects an unauthenticated visitor to /login and never renders the dashboard', async () => {
    renderHome({
      auth: {
        status: 'unauthenticated',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-login-stub')).toBeTruthy();
    });
    expect(screen.queryByTestId('route-home')).toBeNull();
  });

  it('renders the authenticated dashboard with the user screen name when no return-to is remembered', async () => {
    renderHome({
      auth: {
        status: 'authenticated',
        user: {
          userId: '00000000-0000-4000-8000-000000000040',
          screenName: 'bob',
        },
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('root-open-moderator')).toBeTruthy();
    });
    expect(screen.getByTestId('route-title').textContent).toContain('bob');
    expect(screen.getByTestId('root-authenticated-eyebrow').textContent).toBe('a-conversa');
    expect(screen.getByTestId('root-logout-link')).toBeTruthy();
  });

  it('consumes a remembered return-to and navigates to it on an authenticated visit, clearing the slot', async () => {
    window.sessionStorage.setItem('a-conversa:return-to', '/m/sessions/new');

    renderHome({
      auth: {
        status: 'authenticated',
        user: {
          userId: '00000000-0000-4000-8000-000000000041',
          screenName: 'alice',
        },
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-deep-link-stub')).toBeTruthy();
    });
    expect(window.sessionStorage.getItem('a-conversa:return-to')).toBeNull();
    expect(screen.queryByTestId('route-home')).toBeNull();
  });
});
