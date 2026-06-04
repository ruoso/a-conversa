// The visitor-facing locale control — an anonymous visitor with no account has
// no other way to pick a language (the cookie/navigator negotiation runs once
// at bootstrap and offers no in-page control). This is the control ADR 0024's
// negotiation seam explicitly anticipated ("the locale-selector control") and
// the first production caller of the shared `persistLocale` helper.
//
// Refinement: tasks/refinements/landing_page/landing_opensource_and_cta.md
// TaskJuggler: landing_page.landing_opensource_and_cta
// ADR:        0024 (react-i18next + ICU + the locale-negotiation seam),
//             0005 (Tailwind).
//
// Selecting a locale calls `i18n.changeLanguage(tag)` — which re-renders every
// `useTranslation()` consumer app-wide, since i18n is a single shared instance
// wired in `apps/root/src/main.tsx` — and `persistLocale(tag)`, which writes
// the `aconversa_locale` cookie so the choice survives a reload. The control is
// a native, keyboard-operable `<select>` driven by `SUPPORTED_LOCALES` (no
// hard-coded locale list); it must not navigate or reload the page.
//
// It lives here (one call site) rather than in `@a-conversa/shell` (Decision
// §D3); a future second consumer (the screen-name-capture control ADR 0024
// anticipates) would justify lifting it into `shell` at that point.

import { useTranslation } from 'react-i18next';
import type { ChangeEvent, ReactElement } from 'react';

import { persistLocale, SUPPORTED_LOCALES, type SupportedLocale } from '@a-conversa/i18n-catalogs';

/** Id wiring the visible `<label>` to the `<select>` for accessibility. */
const SELECT_ID = 'landing-locale-select';

/**
 * Each language is shown in its own name (its endonym), which is identical
 * regardless of the active UI locale — so these are invariant constants, not
 * catalog strings (the same reasoning as the URL/SPDX constants, Decision §D4).
 */
const LOCALE_LABELS: Record<SupportedLocale, string> = {
  'en-US': 'English',
  'pt-BR': 'Português (Brasil)',
  'es-419': 'Español (Latinoamérica)',
};

function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function LocaleSwitcher(): ReactElement {
  const { t, i18n } = useTranslation();

  // The shared instance's active language may be a resolved tag; fall back to
  // the first supported locale so the `<select>` always has a valid selection.
  const current: SupportedLocale = isSupportedLocale(i18n.language)
    ? i18n.language
    : SUPPORTED_LOCALES[0];

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    const next = event.target.value;
    if (!isSupportedLocale(next) || next === current) {
      return;
    }
    void i18n.changeLanguage(next);
    persistLocale(next);
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={SELECT_ID} className="text-sm text-slate-500">
        {t('landing.footer.localeLabel')}
      </label>
      <select
        id={SELECT_ID}
        data-testid="landing-locale-switcher"
        value={current}
        onChange={handleChange}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_LABELS[locale]}
          </option>
        ))}
      </select>
    </div>
  );
}

export default LocaleSwitcher;
