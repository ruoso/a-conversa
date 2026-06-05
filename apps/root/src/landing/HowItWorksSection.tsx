// The "how it works" narrative section — explains the format around the
// interactive demo: two debaters and one moderator working a single, shared,
// live-growing graph where nothing lands until everyone agrees.
//
// Refinement: tasks/refinements/landing_page/landing_hero_and_method.md
// TaskJuggler: landing_page.landing_hero_and_method
// ADR:        0024 (react-i18next + ICU), 0005 (Tailwind).
//
// Scope: a pure `useTranslation()`-driven section with a labelled landmark
// and a semantic heading. Cross-breakpoint layout + the a11y audit is
// `landing_responsive_a11y` (Decision §D4).

import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';

/** Stable id linking the section to its heading for `aria-labelledby`. */
const TITLE_ID = 'landing-how-it-works-title';

/** The three points, in narrative order; copy resolves per-slug from the catalog. */
const ITEMS = ['participants', 'sharedGraph', 'consensus'] as const;

export function HowItWorksSection(): ReactElement {
  const { t } = useTranslation();

  return (
    <section
      data-testid="landing-how-it-works"
      aria-labelledby={TITLE_ID}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <h2 id={TITLE_ID} className="text-2xl font-semibold text-slate-900">
        {t('landing.howItWorks.title')}
      </h2>
      <div className="mt-6 grid gap-6 sm:grid-cols-3">
        {ITEMS.map((slug) => (
          <div key={slug} data-testid={`landing-how-it-works-item-${slug}`}>
            <h3 className="text-base font-semibold text-slate-900">
              {t(`landing.howItWorks.items.${slug}.title`)}
            </h3>
            <p className="mt-2 text-slate-600">{t(`landing.howItWorks.items.${slug}.body`)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default HowItWorksSection;
