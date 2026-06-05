// Per-locale expected-string matrix consumed by the i18n smoke specs.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_testing.md
// ADR:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Reads catalog strings directly from `@a-conversa/i18n-catalogs` so a
// translation edit can never silently drift from the assertion. If
// `auth.login.title` changes in `en-US.json`, this matrix updates with
// it; if a translator changes `pt-BR.json`, the assertion changes
// alongside.
//
// The `expected` shape mirrors the keys the moderator's `Login` route
// reads (`auth.login.title`, `auth.login.button`, `auth.login.checking`).
// Adding a new key to the matrix is the place to widen coverage; the
// specs walk the matrix entries.

import { CATALOGS, SUPPORTED_LOCALES, type SupportedLocale } from '@a-conversa/i18n-catalogs';

/**
 * The shape every per-locale entry conforms to. Strings here are the
 * exact text the SPA renders for the corresponding catalog key under
 * that locale.
 */
export interface LocaleExpectations {
  readonly locale: SupportedLocale;
  /** `auth.login.title` — the login route's H1. */
  readonly loginTitle: string;
  /** `landing.hero.title` — the public `/` marketing hero's H1. */
  readonly landingHeroTitle: string;
  /** `auth.login.button` — the "Sign in with SSO" affordance label. */
  readonly loginButton: string;
  /** `auth.screenName.title` — the screen-name route's H1. */
  readonly screenNameTitle: string;
}

/**
 * Walk into a nested catalog by dotted key, with a clear error if the
 * key is missing. Keeps the matrix builder strict so a refactor of
 * the catalog shape surfaces here at typecheck/test time.
 *
 * Exported so other e2e specs (e.g. the landing walkthrough's caption-text
 * walk in `landing-demo.spec.ts`) can resolve a catalog string the same
 * drift-proof way — a copy edit updates the assertion automatically rather
 * than reddening a stale literal.
 */
export function lookup(catalog: unknown, dottedKey: string): string {
  const parts = dottedKey.split('.');
  let current: unknown = catalog;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) {
      throw new Error(
        `i18n locale fixture: key "${dottedKey}" walked into a non-object at "${part}"`,
      );
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== 'string') {
    throw new Error(`i18n locale fixture: key "${dottedKey}" did not resolve to a string`);
  }
  return current;
}

/**
 * The full per-locale expectation matrix. The specs iterate
 * `LOCALE_EXPECTATIONS` (or look up a specific locale via
 * `expectationsFor`) and assert the SPA renders the matching strings.
 */
export const LOCALE_EXPECTATIONS: readonly LocaleExpectations[] = SUPPORTED_LOCALES.map(
  (locale) => ({
    locale,
    loginTitle: lookup(CATALOGS[locale], 'auth.login.title'),
    landingHeroTitle: lookup(CATALOGS[locale], 'landing.hero.title'),
    loginButton: lookup(CATALOGS[locale], 'auth.login.button'),
    screenNameTitle: lookup(CATALOGS[locale], 'auth.screenName.title'),
  }),
);

/**
 * Resolve the expectations for one locale. Throws if the locale is
 * unknown — the per-project test setup pins the locale via
 * `process.env.PLAYWRIGHT_LOCALE` or the project metadata, so a typo
 * trips here rather than as a silent miss.
 */
export function expectationsFor(locale: string): LocaleExpectations {
  const entry = LOCALE_EXPECTATIONS.find((e) => e.locale === locale);
  if (entry === undefined) {
    throw new Error(
      `i18n locale fixture: no expectations for "${locale}" — supported: ${SUPPORTED_LOCALES.join(', ')}`,
    );
  }
  return entry;
}
