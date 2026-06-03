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

function HomeStub(): ReactElement {
  return <main data-testid="route-home-stub" />;
}

function renderLanding(initialPath: string, options: Parameters<typeof renderWithProviders>[1]) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/home" element={<HomeStub />} />
      <Route path="/screen-name" element={<ScreenNameStub />} />
    </Routes>,
    { ...(options ?? {}), initialEntries: [initialPath] },
  );
}

describe('LandingRoute', () => {
  it('renders the LoadingFrame while auth is resolving and does not render route-landing', async () => {
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
    expect(screen.queryByTestId('route-landing')).toBeNull();
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
    expect(screen.queryByTestId('route-landing')).toBeNull();
  });

  it('redirects an authenticated visitor to /home without rendering the dashboard or consuming return-to', async () => {
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
      expect(screen.getByTestId('route-home-stub')).toBeTruthy();
    });
    // `/` no longer renders the dashboard card...
    expect(screen.queryByTestId('route-home')).toBeNull();
    expect(screen.queryByTestId('root-open-moderator')).toBeNull();
    // ...and no longer consumes the return-to — that is `/home`'s job.
    expect(window.sessionStorage.getItem('a-conversa:return-to')).toBe('/m/sessions/new');
  });

  it('renders the public landing with i18n eyebrow + body and the login button for anonymous visitors', async () => {
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
    // The public surface uses the new `route-landing` testid, not `route-home`.
    expect(screen.queryByTestId('route-home')).toBeNull();
    // i18n-resolved strings (the catalogs have 'a-conversa' / 'Micro-frontend host app');
    // proves these are coming through `t(...)` and not raw literals — a raw literal
    // would still match, but a missing key would render the dotted-path back instead.
    const landing = screen.getByTestId('route-landing');
    expect(landing.textContent).toContain('a-conversa');
    expect(landing.textContent).toContain('Micro-frontend host app');
  });
});
