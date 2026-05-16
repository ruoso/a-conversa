// Shell-supplied i18n provider.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// ADR:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Thin wrapper around react-i18next's `<I18nextProvider>` so consumers
// (moderator's `main.tsx`, the future root app, future surface bundles)
// import a uniform provider name from `@a-conversa/shell` rather than
// reaching into react-i18next directly. The provider's job is to bind
// an i18next instance into the React subtree so `useTranslation()` and
// `<Trans>` resolve against it.

import type { ReactElement, ReactNode } from 'react';
import type { i18n as I18nInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

export interface I18nProviderProps {
  /** The i18next instance returned by `createI18nInstance(locale)`. */
  readonly i18n: I18nInstance;
  readonly children: ReactNode;
}

export function I18nProvider(props: I18nProviderProps): ReactElement {
  const { i18n, children } = props;
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
