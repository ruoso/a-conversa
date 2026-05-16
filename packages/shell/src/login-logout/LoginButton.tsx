// `<LoginButton>` — shell-supplied SSO login link styled as a button.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// Extraction source: apps/moderator/src/routes/Login.tsx lines 67–74.
//
// Renders an `<a href="/api/auth/login" role="button">` — full-page
// navigation, NOT a `fetch`, because the OIDC handshake is inherently
// cross-origin (Authelia is a foreign origin; `fetch` cannot follow
// the 302 onto a foreign origin). See `tasks/refinements/moderator-ui/
// mod_auth_flow.md` lines 51–55 for the original rationale.
//
// Public props are intentionally narrow: `className` (so consumers can
// pass through styling without the shell owning theme tokens), and
// `data-testid` (defaulting to `auth-login-button` so the moderator's
// existing assertion at `App.test.tsx` line 138 keeps working). The
// link text resolves to the `auth.login.button` i18n key — the catalog
// entry already exists in `@a-conversa/i18n-catalogs`.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

export interface LoginButtonProps {
  readonly className?: string;
  readonly 'data-testid'?: string;
}

export function LoginButton(props: LoginButtonProps): ReactElement {
  const { className, 'data-testid': testId = 'auth-login-button' } = props;
  const { t } = useTranslation();
  return (
    <a href="/api/auth/login" data-testid={testId} role="button" className={className}>
      {t('auth.login.button')}
    </a>
  );
}
