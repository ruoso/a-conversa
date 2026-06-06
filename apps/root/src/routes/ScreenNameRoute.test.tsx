import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { ScreenNameRoute } from './ScreenNameRoute';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

beforeAll(async () => {
  await getTestI18n();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function LoginStub(): ReactElement {
  return <main data-testid="route-login-stub" />;
}

function LandingStub(): ReactElement {
  return <main data-testid="route-landing-stub" />;
}

function DeepLinkStub(): ReactElement {
  return <main data-testid="route-deep-link-stub" />;
}

function renderScreenName(initialPath: string, options: Parameters<typeof renderWithProviders>[1]) {
  return renderWithProviders(
    <Routes>
      <Route path="/screen-name" element={<ScreenNameRoute />} />
      <Route path="/login" element={<LoginStub />} />
      <Route path="/" element={<LandingStub />} />
      <Route path="/p/sessions/xyz/invite" element={<DeepLinkStub />} />
    </Routes>,
    { ...(options ?? {}), initialEntries: [initialPath] },
  );
}

describe('ScreenNameRoute', () => {
  it('renders the LoadingFrame while auth is resolving and does not render the form', async () => {
    renderScreenName('/screen-name', {
      auth: {
        status: 'loading',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-checking')).toBeTruthy();
    });
    expect(screen.queryByTestId('route-screen-name')).toBeNull();
  });

  it('navigates back to /login when unauthenticated and no ?from=callback signal', async () => {
    renderScreenName('/screen-name', {
      auth: {
        status: 'unauthenticated',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-login-stub')).toBeTruthy();
    });
    expect(screen.queryByTestId('route-screen-name')).toBeNull();
  });

  it('renders the form when unauthenticated and ?from=callback is set (new-user OIDC branch)', async () => {
    renderScreenName('/screen-name?from=callback', {
      auth: {
        status: 'unauthenticated',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-screen-name')).toBeTruthy();
    });
    expect(screen.getByTestId('screen-name-input')).toBeTruthy();
    expect(screen.queryByTestId('route-login-stub')).toBeNull();
  });

  it('navigates to / when authenticated and no return-to is remembered', async () => {
    renderScreenName('/screen-name', {
      auth: {
        status: 'authenticated',
        user: {
          userId: '00000000-0000-4000-8000-000000000031',
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
    window.sessionStorage.setItem('a-conversa:return-to', '/p/sessions/xyz/invite');

    renderScreenName('/screen-name', {
      auth: {
        status: 'authenticated',
        user: {
          userId: '00000000-0000-4000-8000-000000000030',
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
