import { lazy, Suspense, type ReactElement } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { LoginButton, useAuth } from '@a-conversa/shell';

import { LoadingFrame } from './LoadingFrame';

// Lazy-load the interactive demo subtree (Decision §6) so Cytoscape and
// the ~4k-line seed blob stay off the marketing page's first paint. The
// seed module was deliberately shaped to be `await import()`-friendly
// (`landing_walkthrough_seed` Decision §3) precisely for this.
//
// The narrated wrapper (`walkthrough_demo_narration` Decision §D1) owns the
// demo's position and renders the per-step caption beside the graph; it
// composes the bare stepper internally.
const WalkthroughDemoNarrated = lazy(() => import('../walkthrough/WalkthroughDemoNarrated'));

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
    // The public marketing surface is intentionally taller than the
    // viewport (a hero card stacked above the full-height interactive
    // walkthrough demo). Bound the scroll to `<main>` rather than letting
    // the document scroll: the e2e no-scrollbars harness
    // (`tests/e2e/fixtures/no-scrollbars.ts`) cannot opt out the root
    // `<html>` scroll, so we make `<main>` the scroll region and mark it
    // allowed — the same idiom `apps/moderator`'s OperateLayout uses for
    // its sidebar. The inner `min-h-full` wrapper keeps the content
    // vertically centered when it does fit. Cross-breakpoint layout is
    // `landing_responsive_a11y`'s job (Decision §7); this is the
    // desktop-first scaffold it composes around.
    <main data-testid="route-landing" data-allow-scroll="" className="h-screen overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-6 p-6">
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

        {/*
        The walkthrough demo — the page's hero artifact. Final composition /
        ordering relative to the hero and narrative sections, plus the
        cross-breakpoint layout, are owned by `landing_hero_and_method` +
        `landing_responsive_a11y`; this task slots the demo in with a
        desktop-first layout those tasks compose around (Decision §7).
      */}
        <section data-testid="landing-walkthrough" className="min-h-[32rem]">
          <Suspense
            fallback={
              <div
                data-testid="walkthrough-demo-loading"
                className="flex min-h-[32rem] items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500"
              >
                {t('auth.login.checking')}
              </div>
            }
          >
            <WalkthroughDemoNarrated />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
