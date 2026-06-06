import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { LoginRoute } from './LoginRoute';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

beforeAll(async () => {
  await getTestI18n();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

function ScreenNameStub(): ReactElement {
  return <main data-testid="route-screen-name-stub" />;
}

function LandingStub(): ReactElement {
  return <main data-testid="route-landing-stub" />;
}

function DeepLinkStub(): ReactElement {
  return <main data-testid="route-deep-link-stub" />;
}

function renderLogin(options: Parameters<typeof renderWithProviders>[1]) {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/" element={<LandingStub />} />
      <Route path="/screen-name" element={<ScreenNameStub />} />
      <Route path="/m/sessions/abc" element={<DeepLinkStub />} />
    </Routes>,
    { ...(options ?? {}), initialEntries: ['/login'] },
  );
}

describe('LoginRoute', () => {
  it('renders the LoadingFrame while auth is resolving and does not redirect to SSO', async () => {
    const replaceSpy = vi.spyOn(window.location, 'replace').mockImplementation(() => undefined);

    renderLogin({
      auth: {
        status: 'loading',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-checking')).toBeTruthy();
    });
    expect(screen.queryByTestId('auth-login-button')).toBeNull();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('navigates to /screen-name when status is needs-screen-name', async () => {
    const replaceSpy = vi.spyOn(window.location, 'replace').mockImplementation(() => undefined);

    renderLogin({
      auth: {
        status: 'needs-screen-name',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-screen-name-stub')).toBeTruthy();
    });
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('navigates to / when authenticated and no return-to is remembered', async () => {
    renderLogin({
      auth: {
        status: 'authenticated',
        user: {
          userId: '00000000-0000-4000-8000-000000000020',
          screenName: 'alice',
        },
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-landing-stub')).toBeTruthy();
    });
    expect(window.sessionStorage.getItem('a-conversa:return-to')).toBeNull();
  });

  it('navigates to the remembered return-to when authenticated and clears the sessionStorage slot', async () => {
    window.sessionStorage.setItem('a-conversa:return-to', '/m/sessions/abc');

    renderLogin({
      auth: {
        status: 'authenticated',
        user: {
          userId: '00000000-0000-4000-8000-000000000021',
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
  });
});
