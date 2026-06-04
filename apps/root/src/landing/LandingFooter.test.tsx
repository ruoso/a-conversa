import type { i18n as I18nInstance } from 'i18next';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

import { createI18nInstance } from '@a-conversa/shell';
import { LOCALE_COOKIE_NAME, SUPPORTED_LOCALES } from '@a-conversa/i18n-catalogs';

import { LandingFooter } from './LandingFooter';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

beforeAll(async () => {
  await getTestI18n();
});

afterEach(() => {
  cleanup();
  // Clear any locale cookie a behavior test wrote so it cannot leak across
  // tests (jsdom persists `document.cookie` within a file).
  document.cookie = `${LOCALE_COOKIE_NAME}=; Path=/; Max-Age=0`;
});

describe('LandingFooter', () => {
  it('renders a <footer> landmark with the product/license line', () => {
    renderWithProviders(<LandingFooter />);

    const footer = screen.getByTestId('landing-footer');
    expect(footer.tagName.toLowerCase()).toBe('footer');
    expect(footer.textContent).toContain('a-conversa');
    // The license note interpolates the SPDX constant (Decision §D4).
    expect(footer.textContent).toContain('AGPL-3.0-or-later');
  });

  it('offers one labelled locale option per SUPPORTED_LOCALES', () => {
    renderWithProviders(<LandingFooter />);

    const switcher = screen.getByTestId<HTMLSelectElement>('landing-locale-switcher');
    // A labelled control: the visible <label> resolves the accessible name.
    expect(switcher.labels?.length ?? 0).toBeGreaterThan(0);
    expect(switcher.options).toHaveLength(SUPPORTED_LOCALES.length);
    expect(Array.from(switcher.options).map((option) => option.value)).toEqual([
      ...SUPPORTED_LOCALES,
    ]);
  });

  it('switches locale in place: changeLanguage re-renders + persistLocale writes the cookie', async () => {
    // A fresh instance so changing the language here does not pollute the
    // module-cached instance shared by the other root tests.
    const instance: I18nInstance = await createI18nInstance('en-US');
    renderWithProviders(<LandingFooter />, { i18n: instance });

    const footer = screen.getByTestId('landing-footer');
    expect(footer.textContent).toContain('structured debate you can see');

    fireEvent.change(screen.getByTestId('landing-locale-switcher'), {
      target: { value: 'pt-BR' },
    });

    // changeLanguage re-renders the `useTranslation()` consumer in place...
    await waitFor(() => {
      expect(instance.language).toBe('pt-BR');
    });
    await waitFor(() => {
      expect(screen.getByTestId('landing-footer').textContent).toContain(
        'debate estruturado que você consegue ver',
      );
    });

    // ...and persistLocale wrote the choice to the locale cookie so it
    // survives a reload.
    expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=pt-BR`);
  });

  it('does not re-fire the switch when the active locale is re-selected', async () => {
    const instance: I18nInstance = await createI18nInstance('en-US');
    renderWithProviders(<LandingFooter />, { i18n: instance });

    fireEvent.change(screen.getByTestId('landing-locale-switcher'), {
      target: { value: 'en-US' },
    });

    expect(instance.language).toBe('en-US');
    expect(document.cookie).not.toContain(`${LOCALE_COOKIE_NAME}=`);
  });
});
