// The page footer — a `<footer>` landmark carrying the product/license line and
// the visitor-facing locale switcher.
//
// Refinement: tasks/refinements/landing_page/landing_opensource_and_cta.md
// TaskJuggler: landing_page.landing_opensource_and_cta
// ADR:        0024 (react-i18next + ICU), 0005 (Tailwind).
//
// Scope: a pure `useTranslation()`-driven `<footer>` landmark with the locale
// switcher composed in. The SPDX tag interpolated into the license note is an
// invariant constant (Decision §D4); the surrounding sentence is localized.
// Cross-breakpoint layout + a11y audit is `landing_responsive_a11y`.

import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';

import { LocaleSwitcher } from './LocaleSwitcher';

/** SPDX identifier of the repo's license; see `OpenSourceSection` (Decision §D4). */
const LICENSE_SPDX = 'AGPL-3.0-or-later';

export function LandingFooter(): ReactElement {
  const { t } = useTranslation();

  return (
    <footer
      data-testid="landing-footer"
      aria-label={t('landing.footer.regionLabel')}
      className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 px-2 py-6 text-sm text-slate-500"
    >
      <div>
        <p className="text-slate-600">{t('landing.footer.tagline')}</p>
        <p className="mt-1">{t('landing.footer.note', { license: LICENSE_SPDX })}</p>
      </div>
      <LocaleSwitcher />
    </footer>
  );
}

export default LandingFooter;
