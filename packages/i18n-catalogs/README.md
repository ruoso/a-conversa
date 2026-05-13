# `@a-conversa/i18n-catalogs`

Per-locale UI strings for every `apps/*` surface. Created by `frontend_i18n.i18n_catalog_workflow`; see
[`tasks/refinements/frontend-i18n/i18n_catalog_workflow.md`](../../tasks/refinements/frontend-i18n/i18n_catalog_workflow.md)
and [ADR 0024](../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md).

## What lives here

- `src/catalogs/en-US.json`, `src/catalogs/pt-BR.json`, `src/catalogs/es-419.json` — the three v1 locale catalogs. Each is a single nested object keyed first by namespace (`chrome` / `methodology` / `diagnostics` / `errors`) and then by string id.
- `src/config.ts` — the canonical `i18next.init` configuration every app passes through (`buildResources`, `buildInitOptions`, `FALLBACK_LNG`, `SUPPORTED_LOCALES`, `NAMESPACES`).
- `src/index.ts` — re-exports of `src/config.ts` plus types.
- `scripts/check-parity.ts` — the parity-check CI gate; runs via `pnpm --filter @a-conversa/i18n-catalogs run check`.

The package's `exports` map publishes per-locale subpaths (`@a-conversa/i18n-catalogs/en-US.json`) for downstream code that wants to lazy-load a single locale's catalog (the audience-surface bundle-size case from ADR 0024). The synchronous `buildInitOptions()` path is what every v1 `apps/*` `main.tsx` calls.

## How an `apps/*` consumes it

```ts
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';
import { buildInitOptions, type SupportedLocale } from '@a-conversa/i18n-catalogs';

const locale: SupportedLocale = 'en-US';

await i18next
  .use(ICU)
  .use(initReactI18next)
  .init(buildInitOptions(locale));
```

After init, `t('chrome.hello')` resolves through the dotted-key lookup. The fallback chain (`pt-BR` → `pt` → `en-US`, `es-419` → `es` → `en-US`) is wired by `FALLBACK_LNG`.

Locale detection (browser-detector vs. URL-prefix per surface) lands in `frontend_i18n.i18n_locale_negotiation`. The cookie name `aconversa_locale` is settled there; this package does not parse cookies itself.

## Adding a string

1. Add the key under the appropriate namespace in `src/catalogs/en-US.json`.
2. Add the same key path in `src/catalogs/pt-BR.json` and `src/catalogs/es-419.json` with the locale-appropriate translation.
3. Run `pnpm --filter @a-conversa/i18n-catalogs run check` — the parity check exits non-zero if any locale is missing the key (or has a key not present in `en-US`, which signals a typo or stale translation).
4. Reference the key from a consumer via `t('chrome.<id>')`.

Native-speaker + philosophical review is gating for any string under `methodology` and `diagnostics` (per ADR 0024's "Glossary review is gating" consequence). `chrome` and `errors` are maintainer-edited.

## Fallback chain

```
pt-BR → pt   → en-US
es-419 → es  → en-US
en-US  → en
```

Intermediate language-only tags (`pt`, `es`, `en`) are present so a future generic-Portuguese or generic-Spanish catalog can land without editing every consumer. Today they resolve through to `en-US` because no `pt.json` / `es.json` / `en.json` exists.

## Namespacing

The four v1 namespaces:

- `chrome` — generic UI labels: button text, dialog titles, form fields. Maintainer-edited.
- `methodology` — statement kinds, edge roles, facet states. Native-speaker + philosophical review per locale (lands via `frontend_i18n.i18n_methodology_glossary`).
- `diagnostics` — diagnostic description templates (cycle, contradiction, multi-warrant, etc.). Lands via `frontend_i18n.i18n_diagnostic_descriptions`.
- `errors` — `ApiError.code` → localized message mapping. Lands via `frontend_i18n.i18n_error_code_catalog`.

v1 ships every namespace inside a single nested JSON per locale. Splitting by file (`en-US/chrome.json`, etc.) is a deferred refactor — revisit on first content load.

## Translator workflow

v1 ships **maintainer-edited JSON via PR**. Crowdin / Lokalise / Weblate integration is deferred to v1.x (open question on the refinement).
