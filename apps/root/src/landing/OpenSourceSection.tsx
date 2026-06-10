// The open-source / "adopt the format" section — the page sells the *method*,
// not a product funnel, so this is where "read the code, self-host, or adopt
// the debate format for your own community" lands, with an honest link to the
// public repository and its copyleft license.
//
// Refinement: tasks/refinements/landing_page/landing_opensource_and_cta.md
// TaskJuggler: landing_page.landing_opensource_and_cta
// ADR:        0024 (react-i18next + ICU), 0005 (Tailwind).
//
// Scope: a pure `useTranslation()`-driven section with a labelled landmark and
// a semantic heading. The repo URL, the LICENSE link target, and the SPDX tag
// are *invariant data*, not translated copy, so they live as module constants
// (Decision §D4); only the visible labels/prose come from the catalog. The
// cross-breakpoint layout + a11y audit is `landing_responsive_a11y`.

import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';

/** Stable id linking the section to its heading for `aria-labelledby`. */
const TITLE_ID = 'landing-open-source-title';

/**
 * Honest content inputs, verified against the repo (Decision §D4):
 * `git remote` → `git@github.com:ruoso/a-conversa.git`, and the root
 * `LICENSE` carries the SPDX tag `AGPL-3.0-or-later`. URLs and the SPDX
 * identifier are identical across locales, so they are constants rather than
 * catalog strings (putting them in three catalogs would invite drift).
 */
const GITHUB_REPO_URL = 'https://github.com/ruoso/a-conversa';
const LICENSE_URL = 'https://github.com/ruoso/a-conversa/blob/main/LICENSE';
const LICENSE_SPDX = 'AGPL-3.0-or-later';

export function OpenSourceSection(): ReactElement {
  const { t } = useTranslation();

  return (
    <section
      data-testid="landing-opensource"
      aria-labelledby={TITLE_ID}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <h2 id={TITLE_ID} className="text-2xl font-semibold text-slate-900">
        {t('landing.openSource.title')}
      </h2>
      <p className="mt-4 text-slate-600">{t('landing.openSource.body')}</p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="landing-opensource-repo-link"
          className="inline-flex rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700"
        >
          {t('landing.openSource.repoLinkLabel')}
        </a>
        <p className="text-sm text-slate-500">
          {t('landing.openSource.licenseNote', { license: LICENSE_SPDX })}{' '}
          <a
            href={LICENSE_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="landing-opensource-license-link"
            className="font-medium text-slate-700 underline"
          >
            {t('landing.openSource.licenseLinkLabel')}
          </a>
        </p>
      </div>
    </section>
  );
}

export default OpenSourceSection;
