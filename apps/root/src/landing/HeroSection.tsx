// The marketing hero — the top of the public `/` page. Carries the product
// name, the one-line value proposition (the page's single `<h1>`), and the
// core hypothesis the platform is built on. The hero is now pure pitch: the
// action affordances (start-a-session link + SSO login) were relocated into the
// dedicated *secondary* CTA section lower on the page, so the call-to-action
// follows the methodology argument rather than competing with the hypothesis
// (`landing_opensource_and_cta` Decision §D2; see `CallToActionSection`).
//
// Refinement: tasks/refinements/landing_page/landing_hero_and_method.md
// TaskJuggler: landing_page.landing_hero_and_method
// ADR:        0024 (react-i18next + ICU), 0005 (Tailwind).
//
// Scope: a pure presentational, `useTranslation()`-driven section with an
// accessible desktop-first baseline (a labelled landmark with the page's
// single `<h1>`). The cross-breakpoint layout + whole-page a11y audit is
// `landing_responsive_a11y` (Decision §D4).

import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';

/** Stable id linking the hero region to its heading for `aria-labelledby`. */
const TITLE_ID = 'landing-hero-title';

export function HeroSection(): ReactElement {
  const { t } = useTranslation();

  return (
    <section
      data-testid="landing-hero"
      aria-labelledby={TITLE_ID}
      className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
    >
      <p className="text-sm uppercase tracking-[0.18em] text-slate-500">
        {t('landing.hero.eyebrow')}
      </p>
      <h1
        id={TITLE_ID}
        data-testid="route-title"
        className="mt-3 text-3xl font-semibold text-slate-900"
      >
        {t('landing.hero.title')}
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-slate-600">{t('landing.hero.hypothesis')}</p>
    </section>
  );
}

export default HeroSection;
