// Smoke tests for the shell's i18n bootstrap.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Covers:
//  - `createI18nInstance('en-US')` resolves with an i18next instance
//    whose `language === 'en-US'`.
//  - `createI18nInstance('pt-BR')` / `createI18nInstance('es-419')`
//    resolve to the documented per-locale instances.
//  - ICU interpolation works through the bound `t`.
//  - `<I18nProvider i18n={instance}>` makes `useTranslation()` resolve
//    in the subtree.

import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';
import type { i18n as I18nInstance } from 'i18next';

import { createI18nInstance } from './createI18nInstance.js';
import { I18nProvider } from './I18nProvider.js';

let i18n: I18nInstance;

beforeAll(async () => {
  i18n = await createI18nInstance('en-US');
});

describe('createI18nInstance', () => {
  it('resolves with an i18next instance whose language === "en-US"', () => {
    expect(i18n.language).toBe('en-US');
  });

  it('resolves the chrome.hello key for en-US', () => {
    expect(i18n.t('chrome.hello')).toBe('hello, world');
  });

  it('changeLanguage("pt-BR") resolves pt-BR catalog keys', async () => {
    await i18n.changeLanguage('pt-BR');
    expect(i18n.t('chrome.hello')).toBe('olá, mundo');
    await i18n.changeLanguage('en-US');
  });

  it('changeLanguage("es-419") resolves es-419 catalog keys', async () => {
    await i18n.changeLanguage('es-419');
    expect(i18n.t('chrome.hello')).toBe('hola, mundo');
    await i18n.changeLanguage('en-US');
  });

  it('ICU interpolation: auth.login.welcome with {name}', () => {
    expect(i18n.t('auth.login.welcome', { name: 'alice' })).toBe('Welcome, alice');
  });
});

describe('<I18nProvider>', () => {
  it('binds the instance so useTranslation() resolves in the subtree', () => {
    function Probe(): ReactElement {
      const { t } = useTranslation();
      return <span data-testid="t-out">{t('chrome.hello')}</span>;
    }
    render(
      <I18nProvider i18n={i18n}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('t-out').textContent).toBe('hello, world');
  });
});
