import { type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { ScreenNameForm, useAuth } from '@a-conversa/shell';

import { takeRememberedReturnTo } from '../surfaces/SurfaceHost';
import { LoadingFrame } from './LoadingFrame';

function resolvePostAuthTarget(): string {
  return takeRememberedReturnTo() ?? '/';
}

export function ScreenNameRoute(): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') {
    return <LoadingFrame />;
  }

  // The OIDC callback's new-user branch 302-redirects the browser here
  // with `?from=callback` and a pending cookie set. `/api/auth/me`
  // returns 401 against the pending cookie alone, so `auth.status`
  // resolves to `unauthenticated` — but the user genuinely is mid-
  // onboarding, and the form's POST will validate the pending cookie
  // server-side. Render the form on this signal instead of bouncing
  // to /login. See
  // tasks/refinements/backend/auth_callback_new_user_browser_redirect.md.
  const fromCallback = new URLSearchParams(location.search).get('from') === 'callback';

  if (auth.status === 'unauthenticated' && !fromCallback) {
    return <Navigate to="/login" replace />;
  }

  if (auth.status === 'authenticated') {
    return <Navigate to={resolvePostAuthTarget()} replace />;
  }

  return (
    <main data-testid="route-screen-name" className="mx-auto max-w-2xl p-6">
      <h1 data-testid="route-title" className="text-2xl font-semibold">
        {t('auth.screenName.title')}
      </h1>
      {/* `ScreenNameForm` calls `auth.refresh()` internally on a
          successful POST; when that resolves to `authenticated`, the
          route's auth-status branch above re-renders into
          `<Navigate to={resolvePostAuthTarget()} replace />` and
          consumes the remembered return-to. We deliberately do NOT
          also navigate from `onSuccess` — two consumers racing for
          the single sessionStorage entry would leak the value out
          from under the Navigate and land the user on `/` instead
          of the deep link they were trying to reach. */}
      <ScreenNameForm onSuccess={() => undefined} />
    </main>
  );
}
