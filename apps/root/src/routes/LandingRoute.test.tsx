import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { LandingRoute } from './LandingRoute';
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

function DeepLinkStub(): ReactElement {
  return <main data-testid="route-deep-link-stub" />;
}

function renderLanding(initialPath: string, options: Parameters<typeof renderWithProviders>[1]) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/screen-name" element={<ScreenNameStub />} />
      <Route path="/m/sessions/new" element={<DeepLinkStub />} />
    </Routes>,
    { ...(options ?? {}), initialEntries: [initialPath] },
  );
}

describe('LandingRoute', () => {
  it('renders the LoadingFrame while auth is resolving and does not render route-home', async () => {
    renderLanding('/', {
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
    renderLanding('/', {
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

  it('consumes a remembered return-to and navigates to it on an authenticated visit to /', async () => {
    window.sessionStorage.setItem('a-conversa:return-to', '/m/sessions/new');

    renderLanding('/', {
      auth: {
        status: 'authenticated',
        user: {
          userId: '00000000-0000-4000-8000-000000000010',
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

  it('renders the authenticated welcome card with the user screen name when no return-to is remembered', async () => {
    renderLanding('/', {
      auth: {
        status: 'authenticated',
        user: {
          userId: '00000000-0000-4000-8000-000000000011',
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

  it('renders the unauthenticated landing with i18n eyebrow + body and the login button', async () => {
    renderLanding('/', {
      auth: {
        status: 'unauthenticated',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('root-start-session')).toBeTruthy();
    });
    expect(screen.getByTestId('auth-login-button')).toBeTruthy();
    // i18n-resolved strings (the catalogs have 'a-conversa' / 'Micro-frontend host app');
    // proves these are coming through `t(...)` and not raw literals — a raw literal
    // would still match, but a missing key would render the dotted-path back instead.
    const home = screen.getByTestId('route-home');
    expect(home.textContent).toContain('a-conversa');
    expect(home.textContent).toContain('Micro-frontend host app');
  });
});
