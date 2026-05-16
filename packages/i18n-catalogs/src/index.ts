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

export {
  LOCALE_COOKIE_NAME,
  type PersistLocaleOptions,
  type UrlLocaleResult,
  canonicalizeLocale,
  clearLocaleCookie,
  defaultLocale,
  negotiateAuthenticatedLocale,
  negotiateUrlLocale,
  persistLocale,
  readLocaleCookie,
} from './negotiation.js';

export {
  KEYBOARD_SHORTCUT_POLICY,
  type KeyboardShortcutPolicy,
  KIND_TO_SHORTCUT,
  METHODOLOGY_KINDS,
  type MethodologyKind,
  EDGE_ROLES,
  type EdgeRole,
  EDGE_ROLE_TO_SHORTCUT,
  type ShortcutMatrixRow,
  buildShortcutMatrix,
  getShortcutForKind,
  getShortcutForEdgeRole,
} from './keyboard-shortcuts.js';

export {
  __resetFormatterCache,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  formatTime,
  getDateTimeFormatter,
  getNumberFormatter,
  getRelativeTimeFormatter,
} from './format.js';

export {
  BROADCAST_FALLBACK_FONTS,
  BROADCAST_FONT_STACK,
  BROADCAST_PRIMARY_FONT,
  REQUIRED_DIACRITICS,
  V1_LOCALE_CODEPOINT_RANGES,
  collectAllCatalogStrings,
  collectCatalogStrings,
  findOutOfRangeCodepoints,
  isInV1LocaleCodepointRange,
} from './typography.js';
