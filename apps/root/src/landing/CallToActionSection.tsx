// The page's *secondary* call-to-action — secondary because the page sells the
// methodology, not a sign-up funnel, so the action affordances follow the
// argument rather than competing with the hypothesis in the hero.
//
// This section owns the action affordances that previously lived in the hero
// (`landing_hero_and_method` Decision §D5 deferred their final treatment here):
// the start-a-session link and the SSO `<LoginButton>`. The affordance testids
// (`root-start-session`, `auth-login-button`) are preserved exactly so the
// auth-flow Playwright scenarios that select them stay green (Constraint 6).
//
// Refinement: tasks/refinements/landing_page/landing_opensource_and_cta.md
// TaskJuggler: landing_page.landing_opensource_and_cta
// ADR:        0024 (react-i18next + ICU), 0005 (Tailwind), 0026 (route ownership).
//
// Scope: a pure `useTranslation()`-driven section with a labelled landmark and
// a semantic heading; reuses the shared `LoginButton` primitive (no new auth
// path). Cross-breakpoint layout + a11y audit is `landing_responsive_a11y`.

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ReactElement } from 'react';

import { LoginButton } from '@a-conversa/shell';

/** Stable id linking the section to its heading for `aria-labelledby`. */
const TITLE_ID = 'landing-cta-title';

export function CallToActionSection(): ReactElement {
  const { t } = useTranslation();

  return (
    <section
      data-testid="landing-cta"
      aria-labelledby={TITLE_ID}
      className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
    >
      <h2 id={TITLE_ID} className="text-2xl font-semibold text-slate-900">
        {t('landing.cta.title')}
      </h2>
      <p className="mt-4 max-w-2xl text-slate-600">{t('landing.cta.body')}</p>
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
    </section>
  );
}

export default CallToActionSection;
