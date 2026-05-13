// Public surface of `@a-conversa/i18n-catalogs`.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_catalog_workflow.md
// ADR:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Consumed by every `apps/*` startup module. The catalog JSONs themselves
// are exported via the package's `./en-US.json` / `./pt-BR.json` /
// `./es-419.json` subpaths so a build pipeline that wants per-locale
// chunking (the audience surface, per ADR 0024) can import them
// individually; the synchronous `buildResources()` / `buildInitOptions()`
// helpers in `./config.ts` are the v1 wiring path.

export {
  SUPPORTED_LOCALES,
  type SupportedLocale,
  FALLBACK_LNG,
  NAMESPACES,
  type Namespace,
  CATALOGS,
  buildResources,
  buildInitOptions,
} from './config.js';
