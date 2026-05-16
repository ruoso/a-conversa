import { useEffect, type ReactElement } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { LoginButton, ScreenNameForm, useAuth } from '@a-conversa/shell';

import { SurfaceHost, rememberReturnTo, takeRememberedReturnTo } from './surfaces/SurfaceHost';

function resolvePostAuthTarget(): string {
  return takeRememberedReturnTo() ?? '/';
}

function LoadingFrame(): ReactElement {
  const { t } = useTranslation();
  return (
    <main data-testid="route-login" className="mx-auto max-w-2xl p-6">
      <h1 data-testid="route-title" className="text-2xl font-semibold">
        {t('auth.login.title')}
      </h1>
      <p data-testid="auth-checking">{t('auth.login.checking')}</p>
    </main>
  );
}

function LandingRoute(): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();

  if (auth.status === 'loading') {
    return <LoadingFrame />;
  }

  if (auth.status === 'needs-screen-name') {
    return <Navigate to="/screen-name" replace />;
  }

  // Consume the sessionStorage-remembered return-to set by
  // `SurfaceHost` when an unauthenticated visitor hit a deep link
  // (e.g. `/m/sessions/new`). The OIDC callback's returning-user
  // branch 302s back to `APP_BASE_URL` (i.e. `/`), so without this
  // the user lands on the welcome view and has to click the
  // start-session link again instead of being carried to where they
  // were trying to go. `LoginRoute` and `ScreenNameRoute` already do
  // the same consumption; this keeps the three auth-chrome routes
  // symmetric.
  if (auth.status === 'authenticated' && auth.user !== undefined) {
    const remembered = takeRememberedReturnTo();
    if (remembered !== undefined) {
      return <Navigate to={remembered} replace />;
    }
    return (
      <main
        data-testid="route-home"
        className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 p-6"
      >
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <p
            data-testid="root-authenticated-eyebrow"
            className="text-sm uppercase tracking-[0.18em] text-slate-500"
          >
            a-conversa
          </p>
          <h1 data-testid="route-title" className="mt-3 text-3xl font-semibold text-slate-900">
            {t('auth.login.welcome', { name: auth.user.screenName })}
          </h1>
          <p className="mt-3 text-slate-600">Micro-frontend host app</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/m/sessions/new"
              data-testid="root-open-moderator"
              className="rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white"
            >
              {t('moderator.createSession.title')}
            </Link>
            <Link
              to="/logout"
              data-testid="root-logout-link"
              className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700"
            >
              {t('auth.login.logout')}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      data-testid="route-home"
      className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 p-6"
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm uppercase tracking-[0.18em] text-slate-500">a-conversa</p>
        <h1 data-testid="route-title" className="mt-3 text-3xl font-semibold text-slate-900">
          {t('auth.login.title')}
        </h1>
        <p className="mt-3 text-slate-600">Micro-frontend host app</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/m/sessions/new"
            data-testid="root-start-session"
            className="inline-flex rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white"
          >
            {t('moderator.createSession.title')}
          </Link>
          <LoginButton className="inline-flex rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700" />
        </div>
      </div>
    </main>
  );
}

function LoginRoute(): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();

  if (auth.status === 'loading') {
    return <LoadingFrame />;
  }

  if (auth.status === 'needs-screen-name') {
    return <Navigate to="/screen-name" replace />;
  }

  if (auth.status === 'authenticated') {
    return <Navigate to={resolvePostAuthTarget()} replace />;
  }

  return (
    <main data-testid="route-login" className="mx-auto max-w-2xl p-6">
      <h1 data-testid="route-title" className="text-2xl font-semibold">
        {t('auth.login.title')}
      </h1>
      <div className="mt-4">
        <LoginButton className="inline-flex rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white" />
      </div>
    </main>
  );
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
