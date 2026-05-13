// Smoke test for the moderator app skeleton.
//
// Covers the end-to-end chain the refinement requires:
//   1. `initI18n` boots react-i18next + ICU off the canonical
//      `@a-conversa/i18n-catalogs` config and resolves the
//      `chrome.hello` example key per locale (the key shipped by the
//      `i18n_catalog_workflow` refinement as the parity smoke key).
//   2. The router renders `/login` and the unmatched-path redirect
//      lands on `/login` too.
//   3. The three-route shape (`/login`, `/sessions/:id/lobby`,
//      `/sessions/:id/operate`) renders its placeholder content and
//      the session-id segment is captured from the path.
//
// Per ADR 0022 this is a committed test, not a throwaway probe.

import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
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
});

describe('moderator router', () => {
  it('renders the login route when the path is /login', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('route-login')).toBeTruthy();
    expect(screen.getByTestId('i18n-hello').textContent).toBe('hello, world');
  });

  it('redirects unknown paths to /login', () => {
    render(
      <MemoryRouter initialEntries={['/unknown-path']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('route-login')).toBeTruthy();
  });

  it('renders the lobby route with the session id captured from the path', () => {
    render(
      <MemoryRouter initialEntries={['/sessions/sess-123/lobby']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('route-lobby')).toBeTruthy();
    expect(screen.getByTestId('session-id').textContent).toBe('sess-123');
  });

  it('renders the operate route with the session id captured from the path', () => {
    render(
      <MemoryRouter initialEntries={['/sessions/sess-456/operate']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('route-operate')).toBeTruthy();
    expect(screen.getByTestId('session-id').textContent).toBe('sess-456');
  });
});
