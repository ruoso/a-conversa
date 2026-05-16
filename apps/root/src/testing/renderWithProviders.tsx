import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import type { i18n as I18nInstance } from 'i18next';

import {
  AuthValueProvider,
  createI18nInstance,
  I18nProvider,
  type AuthContextValue,
} from '@a-conversa/shell';

let cachedI18n: I18nInstance | undefined;

export async function getTestI18n(): Promise<I18nInstance> {
  if (cachedI18n !== undefined) {
    return cachedI18n;
  }
  cachedI18n = await createI18nInstance('en-US');
  return cachedI18n;
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  readonly auth?: AuthContextValue;
  readonly i18n?: I18nInstance;
  readonly initialEntries?: string[];
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  const {
    auth = {
      status: 'unauthenticated',
      refresh: () => undefined,
      logout: () => undefined,
    },
    i18n,
    initialEntries = ['/'],
    ...rest
  } = options;

  const instance = i18n ?? cachedI18n;
  if (instance === undefined) {
    throw new Error('renderWithProviders: call getTestI18n() before rendering root tests');
  }
  const readyI18n = instance;

  function Wrapper(props: { children: ReactNode }): ReactElement {
    return (
      <I18nProvider i18n={readyI18n}>
        <AuthValueProvider value={auth}>
          <MemoryRouter initialEntries={initialEntries}>{props.children}</MemoryRouter>
        </AuthValueProvider>
      </I18nProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...rest });
}
