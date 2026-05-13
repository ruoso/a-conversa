// Placeholder login route.
//
// Real auth flow (Authelia redirect, token capture, in-memory session
// token storage) lands with `moderator_ui.mod_shell.mod_auth_flow`.
// This skeleton renders a localized string from the canonical catalog
// (`chrome.hello` — the example key from `i18n_catalog_workflow`) so
// the route + i18n chain is exercisable end-to-end.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

export function LoginRoute(): ReactElement {
  const { t } = useTranslation();
  return (
    <main data-testid="route-login">
      <h1 data-testid="route-title">Login</h1>
      <p data-testid="i18n-hello">{t('chrome.hello')}</p>
    </main>
  );
}
