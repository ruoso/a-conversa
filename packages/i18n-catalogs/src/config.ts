// Per-app i18next configuration consumed by `apps/*` startup wiring.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_catalog_workflow.md
// ADR:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
// TaskJuggler: frontend_i18n.i18n_catalog_workflow
//
// This module is the catalog-as-data substrate ADR 0024 names. It owns:
//
//   - The canonical list of supported locales (`SUPPORTED_LOCALES`).
//   - The fallback chain (`FALLBACK_LNG`) — settled in
//     `i18n_locale_negotiation` and mirrored here so the wiring task can
//     read a single source of truth without circular task dependencies.
//   - The namespace list (`NAMESPACES`) — settled by this refinement's
//     Decisions block: `chrome` / `methodology` / `diagnostics` /
//     `errors`. The current catalogs ship every namespace inside one
//     nested JSON per locale; the namespace constants give downstream
//     code a stable union to switch on without parsing the JSON shape.
//   - `buildResources()` — a synchronous loader that returns the
//     `Resource` map every `apps/*` `main.tsx` passes to
//     `i18next.init({ resources, ... })`. Lazy-loading per locale is a
//     v1.x optimization (see ADR 0024's "bundle-size impact on
//     audience" consequence) — the v1 wiring ships the three catalogs
//     synchronously since each is a few KB.
//   - `buildInitOptions()` — the canonical `i18next.init` options
//     object every app passes through, parameterized by the resolved
//     locale.
//
// The locale-detection / negotiation logic lives in
// `i18n_locale_negotiation` (`negotiation.ts`, when that task lands).

import type { Resource, ResourceLanguage } from 'i18next';

import enUS from './catalogs/en-US.json' with { type: 'json' };
import ptBR from './catalogs/pt-BR.json' with { type: 'json' };
import es419 from './catalogs/es-419.json' with { type: 'json' };

/**
 * The shape every per-locale JSON file conforms to. Nested objects are
 * permitted (dotted-key lookup walks them); leaves are strings. The
 * JSON files themselves are loaded via TypeScript's
 * `resolveJsonModule`, which infers a precise literal type — that
 * literal type is structurally a `LocaleCatalog`, but TypeScript does
 * not auto-narrow from `Record<string, ...>` to the i18next
 * `ResourceLanguage` union, so we re-cast at the boundary.
 */
type LocaleCatalog = {
  readonly [namespace: string]: { readonly [key: string]: LocaleCatalog[string] | string } | string;
};

/**
 * Locale tags the v1 frontend ships. Order is the display order in any
 * locale-picker UI; `en-US` is first because it is the development
 * baseline and the fallback target.
 */
export const SUPPORTED_LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Fallback chain per ADR 0024 / `i18n_locale_negotiation`:
 *
 *   - `pt-BR` -> `pt` -> `en-US`
 *   - `es-419` -> `es` -> `en-US`
 *   - `en-US` -> `en` -> (no further fallback)
 *
 * `i18next` reads this as the `fallbackLng` map. The intermediate
 * language-only tags (`pt`, `es`, `en`) are present so a future
 * generic-Portuguese or generic-Spanish catalog can be added without
 * editing every consumer. Today those tags resolve through to `en-US`
 * because no `pt.json` / `es.json` / `en.json` exists.
 */
export const FALLBACK_LNG: Record<string, readonly string[]> = {
  'pt-BR': ['pt', 'en-US'],
  pt: ['en-US'],
  'es-419': ['es', 'en-US'],
  es: ['en-US'],
  'en-US': ['en'],
  default: ['en-US'],
};

/**
 * Namespace list per the refinement Decisions block. The current
 * catalogs ship every namespace inside one nested JSON; the constant
 * exists so downstream code keys off a stable union rather than a
 * stringly-typed namespace name.
 */
export const NAMESPACES = ['chrome', 'methodology', 'diagnostics', 'errors'] as const;

export type Namespace = (typeof NAMESPACES)[number];

/**
 * The three catalog JSONs, keyed by locale. Each is the full nested
 * object (`{ chrome: {...}, methodology: {...}, ... }`). `i18next`
 * accepts this shape via `resources[locale].translation = catalog` or
 * via `resources[locale][namespace] = subtree`; we ship as `translation`
 * (the default namespace) to keep the `t('chrome.hello')` dotted-key
 * call site uniform across surfaces.
 */
export const CATALOGS: Record<SupportedLocale, LocaleCatalog> = {
  'en-US': enUS,
  'pt-BR': ptBR,
  'es-419': es419,
};

/**
 * Build the `Resource` map `i18next.init({ resources })` consumes.
 * Each locale gets a single `translation` namespace containing the full
 * nested catalog; `t('chrome.hello')` resolves through dotted-key
 * lookup. Per-namespace splitting is deferred until catalog volume
 * justifies it (refinement Open question).
 */
export function buildResources(): Resource {
  const resources: Resource = {};
  for (const locale of SUPPORTED_LOCALES) {
    // i18next's `ResourceLanguage` requires `{ [ns]: ResourceKey }` where
    // `ResourceKey` is a string or a nested object. Our `LocaleCatalog`
    // is structurally compatible but TypeScript can't auto-narrow from
    // the literal type the JSON import produces; the cast names the
    // boundary explicitly.
    resources[locale] = {
      translation: CATALOGS[locale],
    } satisfies ResourceLanguage;
  }
  return resources;
}

/**
 * Canonical `i18next.init` options shared across surfaces. Each
 * `apps/*` `main.tsx` calls `buildInitOptions(locale)` and passes the
 * result to `i18next.use(ICU).use(initReactI18next).init(...)`. The
 * ICU plugin is mounted by the consumer (not here) so the catalog
 * package stays runtime-agnostic and the per-app entrypoint owns the
 * plugin chain.
 */
export function buildInitOptions(locale: SupportedLocale): {
  resources: Resource;
  lng: SupportedLocale;
  fallbackLng: Record<string, readonly string[]>;
  supportedLngs: readonly SupportedLocale[];
  defaultNS: 'translation';
  ns: readonly ['translation'];
  interpolation: { escapeValue: false };
  returnNull: false;
} {
  return {
    resources: buildResources(),
    lng: locale,
    fallbackLng: FALLBACK_LNG,
    supportedLngs: SUPPORTED_LOCALES,
    defaultNS: 'translation',
    ns: ['translation'] as const,
    // React already escapes; i18next's escape would double-encode.
    interpolation: { escapeValue: false },
    // Missing keys return the key string, not `null`, so the moderator
    // can see `chrome.unimplemented_button` instead of a silent blank
    // until the catalog lands. This matches react-i18next's
    // recommended development setting.
    returnNull: false,
  };
}
