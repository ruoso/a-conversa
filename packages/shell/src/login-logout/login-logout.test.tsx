// Smoke tests for the shell's login + logout subsystem.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// Covers:
//  - `<LoginButton>` renders an `<a href="/api/auth/login"
//    data-testid="auth-login-button">` by default.
//  - `<LoginButton className="custom">` passes className through.
//  - `<LoginButton data-testid="custom-id">` overrides the default testid.
//  - `logout()` POSTs `/api/auth/logout` with `credentials: 'include'`.
//  - `logout()` calls `window.location.reload()` after the POST resolves.
//  - `logout()` swallows fetch rejections but still calls `reload()`.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { createI18nInstance } from '../i18n/createI18nInstance.js';
import { I18nProvider } from '../i18n/I18nProvider.js';
import { LoginButton } from './LoginButton.js';
import { logout } from './logout.js';

import type { i18n as I18nInstance } from 'i18next';

let i18n: I18nInstance;

beforeAll(async () => {
  i18n = await createI18nInstance('en-US');
});

afterEach(() => {
  cleanup();
});

const ORIGINAL_FETCH = global.fetch;
afterAll(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe('<LoginButton>', () => {
  it('renders an anchor pointing at /api/auth/login with the default testid', () => {
    render(
      <I18nProvider i18n={i18n}>
        <LoginButton />
      </I18nProvider>,
    );
    const a = screen.getByTestId('auth-login-button');
    expect(a.tagName).toBe('A');
    expect((a as HTMLAnchorElement).getAttribute('href')).toBe('/api/auth/login');
    expect(a.getAttribute('role')).toBe('button');
  });

  it('passes className through', () => {
    render(
      <I18nProvider i18n={i18n}>
        <LoginButton className="custom-class" />
      </I18nProvider>,
    );
    const a = screen.getByTestId('auth-login-button');
    expect(a.className).toBe('custom-class');
  });

  it('overrides the testid via data-testid prop', () => {
    render(
      <I18nProvider i18n={i18n}>
        <LoginButton data-testid="my-login-btn" />
      </I18nProvider>,
    );
    expect(screen.getByTestId('my-login-btn')).toBeTruthy();
  });
});

describe('logout()', () => {
  it('POSTs /api/auth/logout with credentials:include and calls window.location.reload()', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe('/api/auth/logout');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('include');
      return Promise.resolve(new Response('', { status: 200 }));
    });
    global.fetch = fetchMock as typeof fetch;

    const reloadSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- we only restore the reference, never call it directly.
    const originalReload = window.location.reload;
    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value: reloadSpy,
    });

    await logout();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value: originalReload,
    });
  });

  it('swallows fetch rejections but still calls reload()', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('boom')));

    const reloadSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- we only restore the reference, never call it directly.
    const originalReload = window.location.reload;
    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value: reloadSpy,
    });

    await logout();
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value: originalReload,
    });
  });
});
