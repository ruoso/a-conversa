// Locale negotiation helpers consumed by every `apps/*` startup module.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_locale_negotiation.md
// ADR:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
// TaskJuggler: frontend_i18n.i18n_locale_negotiation
//
// Locale resolution is the first decision the app makes on every page
// load — every `t(...)` call after that point reads from the resolved
// locale's catalog. The four frontend surfaces have different
// operational contexts, so a single resolution strategy doesn't fit:
//
//   - Moderator + participant + private audience (authenticated):
//     `negotiateAuthenticatedLocale()` reads from a chain that
//     prioritises an explicit user choice persisted to a cookie
//     (`aconversa_locale`) and falls back to `navigator.languages`
//     and finally `en-US`. Backed by `i18next-browser-languagedetector`
//     per ADR 0024.
//
//   - Public audience + replay (anonymous, often inside an OBS browser
//     source): `negotiateUrlLocale(pathname)` reads the leading URL
//     segment (`/pt-BR/sessions/abc123`). No browser detector and no
//     cookie — the producer pointing OBS at the URL is the only
//     locale-choosing actor.
//
// `persistLocale(locale)` writes the cookie at the screen-name capture
// step (when the user makes an explicit choice via the locale-selector
// control); reading the cookie back is the authenticated chain's first
// step.
//
// The cookie name `aconversa_locale` is settled by the refinement; the
// scope is `Path=/; SameSite=Lax` plus `Secure` in production. The
// backend ignores the cookie entirely (per ADR 0023 + ADR 0024 — locale
// is a frontend concern).

import LanguageDetector from 'i18next-browser-languagedetector';

import { FALLBACK_LNG, SUPPORTED_LOCALES, type SupportedLocale } from './config.js';

/**
 * Cookie name the moderator + participant surfaces persist the
 * user-chosen locale under. Settled in the refinement; documented in
 * `packages/i18n-catalogs/README.md`. The backend does not read this
 * cookie.
 */
export const LOCALE_COOKIE_NAME = 'aconversa_locale';

/**
 * Cookie lifetime in days for the persisted locale choice. One year is
 * long enough that returning users see their last choice without
 * needing to re-pick; short enough that a stale browser eventually
 * re-negotiates.
 */
const LOCALE_COOKIE_MAX_AGE_DAYS = 365;

/**
 * Canonicalize a raw locale tag onto one of `SUPPORTED_LOCALES`. Used
 * to interpret values that may arrive in any of several legitimate
 * shapes:
 *
 *   - The cookie / URL prefix may carry an exact supported tag
 *     (`pt-BR`, `es-419`, `en-US`).
 *   - `navigator.languages` entries may be language-only (`pt`, `es`,
 *     `en`) or region-tagged with a different region than we ship
 *     (`pt-PT`, `es-ES`, `es-MX`).
 *   - URL segments may arrive in mixed case (`pt-br`, `PT-BR`).
 *
 * Matching rules:
 *
 *   1. Exact case-insensitive match against `SUPPORTED_LOCALES` →
 *      return the canonical tag (preserves `pt-BR` casing).
 *   2. Language-only prefix match (`pt` → `pt-BR`, `es` → `es-419`,
 *      `en` → `en-US`).
 *   3. No match → `undefined`. Callers fall back to `FALLBACK_LNG`'s
 *      default (`en-US`).
 *
 * `pt-PT` therefore canonicalizes to `pt-BR` (and `es-ES` to `es-419`).
 * That's intentional: the v1 catalogs are the only Portuguese / Spanish
 * we ship, and serving any pt/es speaker the closest available locale
 * is strictly better than serving them English silently.
 */
export function canonicalizeLocale(raw: string | undefined | null): SupportedLocale | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const lower = raw.toLowerCase();
  for (const supported of SUPPORTED_LOCALES) {
    if (supported.toLowerCase() === lower) return supported;
  }
  // Language-only prefix: take the first sub-tag and match by language code.
  const dashIdx = lower.indexOf('-');
  const language = dashIdx === -1 ? lower : lower.substring(0, dashIdx);
  for (const supported of SUPPORTED_LOCALES) {
    const supportedLang = supported.toLowerCase().split('-')[0];
    if (supportedLang === language) return supported;
  }
  return undefined;
}

/**
 * The fallback locale used when no other rule resolves. Mirrors the
 * `FALLBACK_LNG.default` entry in `config.ts` to keep a single source
 * of truth — if the fallback ever changes, both reads agree.
 */
export function defaultLocale(): SupportedLocale {
  const fallback = FALLBACK_LNG['default']?.[0];
  if (fallback !== undefined) {
    const canonical = canonicalizeLocale(fallback);
    if (canonical !== undefined) return canonical;
  }
  // SUPPORTED_LOCALES[0] is `en-US` by display order; the constructor
  // forbids an empty list, so this index is safe.
  return SUPPORTED_LOCALES[0];
}

/**
 * Parse the document's cookies into a name→value map. The browser's
 * `document.cookie` API is a single semicolon-separated string;
 * decoding the value handles URL-encoded tags (none of `pt-BR` /
 * `es-419` / `en-US` need encoding, but the API does).
 *
 * Exported for the rare consumer that needs to read other cookies the
 * platform sets; the locale-negotiation path goes through
 * `readLocaleCookie()` which already does the lookup.
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (cookieHeader === '') return out;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      out[trimmed] = '';
      continue;
    }
    const name = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      // Malformed encoding — fall back to the raw value rather than
      // throwing. A malformed locale cookie just fails to canonicalize
      // and the chain moves on.
      out[name] = value;
    }
  }
  return out;
}

/**
 * Read the locale cookie value, canonicalized. Returns `undefined`
 * when the cookie is absent, empty, or carries a value that doesn't
 * resolve to a supported locale.
 *
 * Pure DOM read; safe to call from anywhere that has a `document`
 * (i.e., the browser bundle). In SSR / Node contexts (Vitest's
 * happy-dom does provide `document`) it just sees an empty cookie
 * string.
 */
export function readLocaleCookie(): SupportedLocale | undefined {
  if (typeof document === 'undefined') return undefined;
  const cookies = parseCookies(document.cookie);
  return canonicalizeLocale(cookies[LOCALE_COOKIE_NAME]);
}

/**
 * Options accepted by `persistLocale`. Exposed so callers (and tests)
 * can override the default cookie attributes — the moderator surface
 * in dev needs `Secure=false`, in prod it needs `Secure=true`. The
 * default is environment-driven via `window.location.protocol`:
 * `https:` → `Secure`, anything else → not Secure.
 */
export interface PersistLocaleOptions {
  /** Max-Age in seconds. Defaults to one year. */
  readonly maxAgeSeconds?: number;
  /** Cookie path. Defaults to `/`. */
  readonly path?: string;
  /** SameSite policy. Defaults to `Lax`. */
  readonly sameSite?: 'Strict' | 'Lax' | 'None';
  /** Secure flag. Defaults to true iff `window.location.protocol === 'https:'`. */
  readonly secure?: boolean;
}

/**
 * Persist a user-chosen locale to the `aconversa_locale` cookie.
 * Called by the locale-selector UI control at the screen-name capture
 * step (moderator + participant) and any in-app locale switch action
 * thereafter.
 *
 * The cookie shape:
 *
 *   - **Name**: `aconversa_locale`
 *   - **Value**: the canonical tag (`en-US` / `pt-BR` / `es-419`)
 *   - **Path**: `/`
 *   - **Max-Age**: 31_536_000 (one year)
 *   - **SameSite**: `Lax`
 *   - **Secure**: present iff served over HTTPS
 *
 * No `HttpOnly` (the frontend reads it).
 * No `Domain` (host-only — narrowest scope possible).
 */
export function persistLocale(locale: SupportedLocale, options: PersistLocaleOptions = {}): void {
  if (typeof document === 'undefined') return;
  const maxAge = options.maxAgeSeconds ?? LOCALE_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  const path = options.path ?? '/';
  const sameSite = options.sameSite ?? 'Lax';
  const secure =
    options.secure ?? (typeof window !== 'undefined' && window.location?.protocol === 'https:');
  const parts = [
    `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    `SameSite=${sameSite}`,
  ];
  if (secure) parts.push('Secure');
  document.cookie = parts.join('; ');
}

/**
 * Clear the locale cookie. Useful for the locale-selector "use browser
 * default" affordance and for tests that need a clean slate.
 */
export function clearLocaleCookie(options: { readonly path?: string } = {}): void {
  if (typeof document === 'undefined') return;
  const path = options.path ?? '/';
  // RFC 6265: setting Max-Age=0 expires the cookie immediately.
  document.cookie = `${LOCALE_COOKIE_NAME}=; Path=${path}; Max-Age=0; SameSite=Lax`;
}

/**
 * Negotiate the active locale for authenticated surfaces (moderator,
 * participant, private audience).
 *
 * Resolution chain (first hit wins):
 *
 *   1. `aconversa_locale` cookie — the user's explicit choice from a
 *      prior session (set via the locale-selector control at
 *      screen-name capture).
 *   2. `navigator.languages` — the browser's preference list, mapped
 *      onto our supported set via `canonicalizeLocale`.
 *   3. `navigator.language` — single-value fallback for environments
 *      that don't expose `navigator.languages`.
 *   4. `defaultLocale()` — `en-US`.
 *
 * The implementation routes through `i18next-browser-languagedetector`
 * for the cookie + navigator reads (so we inherit its battle-tested
 * tag-normalization and the cookie path stays consistent with whatever
 * the detector caches if a consumer chooses to wire `caches: ['cookie']`
 * separately). Our `canonicalizeLocale` then maps the detector's
 * result onto the v1 supported set.
 */
export function negotiateAuthenticatedLocale(): SupportedLocale {
  // Cookie wins outright — it's the user's explicit choice.
  const fromCookie = readLocaleCookie();
  if (fromCookie !== undefined) return fromCookie;

  // Fall back to the browser detector for `navigator.languages` reads.
  // We instantiate per call so unit tests can mutate `navigator` state
  // between cases without carrying detector state across. The detector
  // is initialised with a stub `services.languageUtils.getBestMatchFromCodes`
  // so its `detect()` returns the full ordered candidate list rather
  // than collapsing to the first entry (the v19.5-compatibility code
  // path inside the detector). We then walk the list ourselves and
  // pick the first entry that canonicalizes onto our v1 supported set
  // — this is what gives us the "first supported preference wins"
  // behaviour `navigator.languages` is designed for.
  if (typeof navigator !== 'undefined') {
    try {
      const detector = new LanguageDetector(
        { languageUtils: { getBestMatchFromCodes: (codes: string[]) => codes[0] } },
        {
          order: ['navigator'],
          // Suppress the detector's own cookie write — we own cookie
          // persistence via `persistLocale` so the lifecycle is explicit.
          caches: [],
        },
      );
      const detected = detector.detect(['navigator']);
      const candidates = Array.isArray(detected)
        ? detected
        : detected === null || detected === undefined
          ? []
          : [detected];
      for (const candidate of candidates) {
        const canonical = canonicalizeLocale(candidate);
        if (canonical !== undefined) return canonical;
      }
    } catch {
      // Detector failure (e.g. an exotic test environment) falls
      // through to `defaultLocale()`. The intent is "never throw from
      // negotiation"; the worst case is "user sees en-US".
    }
  }

  return defaultLocale();
}

/**
 * Negotiate the active locale for unauthenticated surfaces (public
 * audience, replay).
 *
 * The leading path segment is the locale: `/pt-BR/sessions/abc123` →
 * `pt-BR`. Missing or unrecognized segments fall back to
 * `defaultLocale()`. No cookie read, no `navigator.languages` read —
 * the URL is the only signal. (The page may be loaded inside an OBS
 * browser source that does not represent a human user.)
 *
 * Accepts an optional `pathname` so the function is testable; the
 * default reads from `window.location.pathname`. Returns the canonical
 * locale tag plus the residual path with the locale prefix stripped,
 * so the consuming router can mount on the residual:
 *
 *   `/pt-BR/sessions/abc123` → `{ locale: 'pt-BR', residualPath: '/sessions/abc123' }`
 *   `/sessions/abc123`       → `{ locale: 'en-US', residualPath: '/sessions/abc123' }`
 *   `/`                      → `{ locale: 'en-US', residualPath: '/' }`
 */
export interface UrlLocaleResult {
  readonly locale: SupportedLocale;
  readonly residualPath: string;
}

export function negotiateUrlLocale(pathname?: string): UrlLocaleResult {
  const path =
    pathname ?? (typeof window !== 'undefined' && window.location ? window.location.pathname : '/');
  // Strip leading slash; split on `/`; the first segment is the locale candidate.
  const trimmed = path.startsWith('/') ? path.substring(1) : path;
  const firstSlash = trimmed.indexOf('/');
  const firstSegment = firstSlash === -1 ? trimmed : trimmed.substring(0, firstSlash);
  const remainder = firstSlash === -1 ? '' : trimmed.substring(firstSlash);

  // Match the first segment against the supported set with **exact
  // case** — URL prefixes are operator-controlled (a producer types
  // them into OBS), so we want the strict tag form. A case-insensitive
  // match would silently accept `/pt-br/` as equivalent to `/pt-BR/`,
  // which would then break any URL the platform generates back out.
  // The first segment IS canonicalized loosely via `canonicalizeLocale`
  // so language-only prefixes (`/pt/sessions/...`) still resolve to a
  // supported locale; tags that match a supported locale exactly hit
  // first.
  for (const supported of SUPPORTED_LOCALES) {
    if (supported === firstSegment) {
      return { locale: supported, residualPath: remainder === '' ? '/' : remainder };
    }
  }
  // Loose match (language-only or alternate casing): still consume
  // the segment because the producer clearly intended a locale prefix.
  if (firstSegment !== '' && canonicalizeLocale(firstSegment) !== undefined) {
    const canonical = canonicalizeLocale(firstSegment);
    if (canonical !== undefined) {
      return { locale: canonical, residualPath: remainder === '' ? '/' : remainder };
    }
  }
  // No locale prefix — the whole path is the residual.
  return { locale: defaultLocale(), residualPath: path === '' ? '/' : path };
}
