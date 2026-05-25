import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { AuthCallbackRoute } from './AuthCallbackRoute';
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

function renderCallback(initialPath: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/auth/callback" element={<AuthCallbackRoute />} />
      <Route path="/login" element={<LoginStub />} />
    </Routes>,
    { initialEntries: [initialPath] },
  );
}

describe('AuthCallbackRoute', () => {
  it('writes the ?return_to value into sessionStorage and navigates to /login', async () => {
    renderCallback('/auth/callback?return_to=/m/sessions/abc');

    await waitFor(() => {
      expect(screen.getByTestId('route-login-stub')).toBeTruthy();
    });
    expect(window.sessionStorage.getItem('a-conversa:return-to')).toBe('/m/sessions/abc');
  });

  it('leaves sessionStorage untouched when no ?return_to is present and still navigates to /login', async () => {
    // Pre-existing value must NOT be clobbered — a regression that
    // unconditionally calls `rememberReturnTo(searchParams.get('return_to'))`
    // would either throw on `null` or wipe the existing entry.
    window.sessionStorage.setItem('a-conversa:return-to', '/m/sessions/existing');

    renderCallback('/auth/callback');

    await waitFor(() => {
      expect(screen.getByTestId('route-login-stub')).toBeTruthy();
    });
    expect(window.sessionStorage.getItem('a-conversa:return-to')).toBe('/m/sessions/existing');
  });
});
