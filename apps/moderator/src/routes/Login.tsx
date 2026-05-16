// Login route for the moderator console.
//
// Refinement: tasks/refinements/moderator-ui/mod_auth_flow.md +
//   tasks/refinements/shell-package/shell_substrate_extraction.md
//   (the SSO `<a>` extracted to `<LoginButton>` in `@a-conversa/shell`;
//   the four-state switch + welcome banner + logout button stay in the
//   moderator).
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md
// TaskJuggler: moderator_ui.mod_shell.mod_auth_flow
//
// Renders one of four states off `useAuth()`:
//
//   - `loading`            → "Checking session…" placeholder.
//   - `unauthenticated`    → `<LoginButton />` from `@a-conversa/shell`
//                            (full-page navigation to `/api/auth/login`;
//                            the OIDC dance is cross-origin so `fetch`
//                            cannot follow the 302).
//   - `needs-screen-name`  → `<Navigate to="/screen-name" replace />`.
//   - `authenticated`      → a welcome banner with the user's screen
//                            name plus a logout button.

import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { LoginButton, useAuth } from '@a-conversa/shell';

export function LoginRoute(): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();

  if (auth.status === 'loading') {
    return (
      <main data-testid="route-login">
        <h1 data-testid="route-title">{t('auth.login.title')}</h1>
        <p data-testid="auth-checking">{t('auth.login.checking')}</p>
      </main>
    );
  }

  if (auth.status === 'needs-screen-name') {
    return <Navigate to="/screen-name" replace />;
  }

  if (auth.status === 'authenticated' && auth.user !== undefined) {
    return (
      <main data-testid="route-login">
        <h1 data-testid="route-title">{t('auth.login.title')}</h1>
        <p data-testid="auth-welcome">{t('auth.login.welcome', { name: auth.user.screenName })}</p>
        <button
          type="button"
          data-testid="auth-logout-button"
          onClick={() => {
            void auth.logout();
          }}
        >
          {t('auth.login.logout')}
        </button>
      </main>
    );
  }

  // Default branch: unauthenticated (or an unexpected status — fall
  // back to the login affordance rather than rendering a blank screen).
  return (
    <main data-testid="route-login">
      <h1 data-testid="route-title">{t('auth.login.title')}</h1>
      <LoginButton />
    </main>
  );
}
