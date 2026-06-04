// The "what it surfaces" narrative section — the three diagnostic goals the
// format makes visible: internal contradictions, category mismatches, and
// bedrock axioms.
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
const TITLE_ID = 'landing-what-it-surfaces-title';

/** The three diagnostic goals; copy resolves per-slug from the catalog. */
const ITEMS = ['contradictions', 'categories', 'axioms'] as const;

export function WhatItSurfacesSection(): ReactElement {
  const { t } = useTranslation();

  return (
    <section
      data-testid="landing-what-it-surfaces"
      aria-labelledby={TITLE_ID}
      className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
    >
      <h2 id={TITLE_ID} className="text-2xl font-semibold text-slate-900">
        {t('landing.surfaces.title')}
      </h2>
      <div className="mt-6 grid gap-6 sm:grid-cols-3">
        {ITEMS.map((slug) => (
          <div key={slug} data-testid={`landing-what-it-surfaces-item-${slug}`}>
            <h3 className="text-base font-semibold text-slate-900">
              {t(`landing.surfaces.items.${slug}.title`)}
            </h3>
            <p className="mt-2 text-slate-600">{t(`landing.surfaces.items.${slug}.body`)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default WhatItSurfacesSection;
