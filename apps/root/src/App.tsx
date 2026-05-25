import { useEffect, type ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { ScreenNameForm, useAuth } from '@a-conversa/shell';

const SSO_LOGIN_URL = '/api/auth/login';

import { SurfaceHost, rememberReturnTo, takeRememberedReturnTo } from './surfaces/SurfaceHost';
import { LandingRoute } from './routes/LandingRoute';
import { LoadingFrame } from './routes/LoadingFrame';

function resolvePostAuthTarget(): string {
  return takeRememberedReturnTo() ?? '/';
}

function LoginRoute(): ReactElement {
  const auth = useAuth();
  const shouldRedirectToSso = auth.status === 'unauthenticated';

  // Unauthenticated visitors have nothing to do on this route except
  // hand control to the OIDC provider, so skip the intermediate "Sign
  // in" button and full-page navigate straight to the server's
  // `/api/auth/login` endpoint (which 302s onto Authelia). A useEffect
  // is the right hook: the redirect is a side effect and React forbids
  // mutating `window.location` during render. The OIDC dance is cross-
  // origin so `window.location.replace` (not React Router) is required.
  useEffect(() => {
    if (shouldRedirectToSso && typeof window !== 'undefined') {
      window.location.replace(SSO_LOGIN_URL);
    }
  }, [shouldRedirectToSso]);

  if (auth.status === 'loading') {
    return <LoadingFrame />;
  }

  if (auth.status === 'needs-screen-name') {
    return <Navigate to="/screen-name" replace />;
  }

  if (auth.status === 'authenticated') {
    return <Navigate to={resolvePostAuthTarget()} replace />;
  }

  return <LoadingFrame />;
}

function ScreenNameRoute(): ReactElement {
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
          from under the Navigate and land the user on `/` instead of
          the deep link they were trying to reach. */}
      <ScreenNameForm onSuccess={() => undefined} />
    </main>
  );
}

function LogoutRoute(): ReactElement {
  const { t } = useTranslation();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem('a-conversa:return-to');
    }

    void (async () => {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
        });
      } finally {
        window.location.replace('/login');
      }
    })();
  }, []);

  return (
    <main data-testid="route-logout" className="mx-auto max-w-2xl p-6">
      <h1 data-testid="route-title" className="text-2xl font-semibold">
        {t('auth.login.logout')}
      </h1>
    </main>
  );
}

function AuthCallbackRoute(): ReactElement {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const returnTo = searchParams.get('return_to');
  if (returnTo !== null) {
    rememberReturnTo(returnTo);
  }
  return <Navigate to="/login" replace />;
}

export default function App(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/screen-name" element={<ScreenNameRoute />} />
      <Route path="/logout" element={<LogoutRoute />} />
      <Route path="/auth/callback" element={<AuthCallbackRoute />} />
      <Route path="/m/*" element={<SurfaceHost surfaceId="moderator" routerBasePath="/m" />} />
      <Route path="/p/*" element={<SurfaceHost surfaceId="participant" routerBasePath="/p" />} />
      <Route path="/a/*" element={<SurfaceHost surfaceId="audience" routerBasePath="/a" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
