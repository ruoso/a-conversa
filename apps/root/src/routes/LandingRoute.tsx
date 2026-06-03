import { type ReactElement } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { LoginButton, useAuth } from '@a-conversa/shell';

import { LoadingFrame } from './LoadingFrame';

export function LandingRoute(): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();

  if (auth.status === 'loading') {
    return <LoadingFrame />;
  }

  if (auth.status === 'needs-screen-name') {
    return <Navigate to="/screen-name" replace />;
  }

  // `/` is the public marketing surface; an authenticated visitor's home
  // is the dashboard, so bounce them to `/home` (a `replace` so the
  // marketing page never enters history). The OIDC callback's
  // returning-user branch 302s back to `APP_BASE_URL` (i.e. `/`), so
  // returnees land here first — this redirect shepherds them onward
  // rather than stranding them on marketing content, and `/home` is the
  // single consumer of any remembered deep-link return-to.
  if (auth.status === 'authenticated' && auth.user !== undefined) {
    return <Navigate to="/home" replace />;
  }

  return (
    <main
      data-testid="route-landing"
      className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 p-6"
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm uppercase tracking-[0.18em] text-slate-500">
          {t('root.landing.eyebrow')}
        </p>
        <h1 data-testid="route-title" className="mt-3 text-3xl font-semibold text-slate-900">
          {t('auth.login.title')}
        </h1>
        <p className="mt-3 text-slate-600">{t('root.landing.body')}</p>
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
