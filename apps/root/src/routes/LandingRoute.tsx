import { lazy, Suspense, type ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@a-conversa/shell';

import { takeRememberedReturnTo } from '../surfaces/SurfaceHost';
import { LoadingFrame } from './LoadingFrame';
import { HeroSection } from '../landing/HeroSection';
import { HowItWorksSection } from '../landing/HowItWorksSection';
import { WhatItSurfacesSection } from '../landing/WhatItSurfacesSection';
import { OpenSourceSection } from '../landing/OpenSourceSection';
import { CallToActionSection } from '../landing/CallToActionSection';
import { LandingFooter } from '../landing/LandingFooter';

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

  // `/` is the home for everyone: ADR 0026 scopes this route to both the
  // authenticated and unauthenticated states, and the former `/home`
  // dashboard folded back in here (the create-session affordance it
  // offered already lives in `CallToActionSection`, which renders an
  // auth-appropriate action below). The one job `/home` did beyond
  // rendering — consuming the sessionStorage-remembered deep-link
  // return-to set by `SurfaceHost` for an unauthenticated deep-link
  // visitor — moves here, because the OIDC callback's returning-user
  // branch 302s back to `APP_BASE_URL` (i.e. `/`), so returnees land
  // here first. Read-and-clear once: forward to the deep link if one was
  // remembered, otherwise fall through and render the page as their home.
  if (auth.status === 'authenticated' && auth.user !== undefined) {
    const remembered = takeRememberedReturnTo();
    if (remembered !== undefined) {
      return <Navigate to={remembered} replace />;
    }
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
    // vertically centered when it does fit, and now spans the full window
    // width (capped at a generous `max-w-[120rem]` to stay sane on
    // ultrawide displays) so the interactive walkthrough — the page's hero
    // artifact — gets the room to breathe; the marketing prose fills its
    // section box (the page-level `max-w-[120rem]` cap is what keeps the
    // measure sane). Cross-breakpoint layout is `landing_responsive_a11y`'s
    // job (Decision §7); this is the desktop-first scaffold it composes
    // around.
    <main data-testid="route-landing" data-allow-scroll="" className="h-screen overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[120rem] flex-col justify-center gap-6 p-4 sm:p-6 lg:px-8">
        {/*
        The methodology pitch composed around the interactive demo
        (`landing_hero_and_method` Decision §D1): the hero (product name +
        value-prop + hypothesis) leads, "how it works" frames the format, the
        demo shows it, and "what it surfaces" names the three diagnostic
        goals. Each section is a self-contained, `useTranslation()`-driven
        presentational unit; `LandingRoute` stays a thin composition root and
        `landing_responsive_a11y` later restyles the sections without touching
        the auth branching above.
      */}
        <HeroSection />

        <HowItWorksSection />

        {/*
        The walkthrough demo — the page's hero artifact. The demo subtree is
        left exactly as the demo leaves shipped it (`landing_hero_and_method`
        constraint 3); this task only positions the narrative sections around
        it. Cross-breakpoint layout is owned by `landing_responsive_a11y`.

        At `lg` the section takes a *definite* viewport height
        (`100dvh` minus the container's 3rem vertical padding) rather than a
        fixed `rem` floor, so the graph — `flex-1` inside the demo — grows to
        fill the screen height. A definite height (not just `min-h`) is what
        lets the nested `h-full` chain resolve so the canvas actually expands;
        `min-h-[36rem]` stays as the short-viewport floor.
      */}
        <section
          data-testid="landing-walkthrough"
          aria-label={t('landing.demo.embedRegionLabel')}
          className="min-h-[36rem] lg:h-[calc(100dvh-3rem)]"
        >
          <Suspense
            fallback={
              <div
                data-testid="walkthrough-demo-loading"
                className="flex min-h-[36rem] items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 lg:h-[calc(100dvh-3rem)]"
              >
                {t('auth.login.checking')}
              </div>
            }
          >
            <WalkthroughDemoNarrated />
          </Suspense>
        </section>

        <WhatItSurfacesSection />

        {/*
        The page chrome below the methodology pitch
        (`landing_opensource_and_cta` Decision §D1): the open-source / "adopt
        the format" pitch, the page's *secondary* call-to-action (the action
        affordances relocated out of the hero, Decision §D2), and the footer
        with the visitor-facing locale switcher. Each is a self-contained
        `useTranslation()`-driven unit composed after the narrative + demo;
        `landing_responsive_a11y` later restyles them without touching the
        auth branching above.
      */}
        <OpenSourceSection />

        <CallToActionSection />

        <LandingFooter />
      </div>
    </main>
  );
}
