import { type ReactElement } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@a-conversa/shell';

import { takeRememberedReturnTo } from '../surfaces/SurfaceHost';
import { LoadingFrame } from './LoadingFrame';

export function HomeRoute(): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();

  if (auth.status === 'loading') {
    return <LoadingFrame />;
  }

  if (auth.status === 'needs-screen-name') {
    return <Navigate to="/screen-name" replace />;
  }

  // `/home` is the authenticated dashboard — anonymous visitors have no
  // home to render, so deflect into `/login` (which kicks off SSO).
  // Unlike the `/m/*` surfaces, we do NOT `rememberReturnTo('/home')`:
  // `/home` is the post-auth fallback target itself (see
  // `LoginRoute`/`ScreenNameRoute`'s `resolvePostAuthTarget`), so a
  // returning user lands here anyway without a remembered deep link.
  if (auth.status !== 'authenticated' || auth.user === undefined) {
    return <Navigate to="/login" replace />;
  }

  // Consume the sessionStorage-remembered return-to set by `SurfaceHost`
  // when an unauthenticated visitor hit a deep link (e.g.
  // `/m/sessions/new`). The OIDC callback's returning-user branch 302s
  // back to `APP_BASE_URL` (i.e. `/`), `LandingRoute` bounces the
  // authenticated visitor here, and this is where the single
  // read-and-clear happens — keeping `/home` the one consumer of the
  // dashboard-or-deep-link decision. `LoginRoute` and `ScreenNameRoute`
  // already do the same consumption on their post-auth Navigate.
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
          {t('root.landing.eyebrow')}
        </p>
        <h1 data-testid="route-title" className="mt-3 text-3xl font-semibold text-slate-900">
          {t('auth.login.welcome', { name: auth.user.screenName })}
        </h1>
        <p className="mt-3 text-slate-600">{t('root.landing.body')}</p>
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
