// Locale-aware date / time / number formatting helpers.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_date_time_formatting.md
// ADR:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
// TaskJuggler: frontend_i18n.i18n_date_time_formatting
//
// Every UI surface formats timestamps (event log, change history, snapshot
// labels, replay seek-bar) and occasional numbers (pending-count badges,
// playback-speed multipliers). The browser's `Intl` APIs handle this
// natively — no bespoke catalog is needed — but the active locale tag has
// to thread through to each call site. This module is the single
// resolution point: helpers accept an optional `locale` parameter and
// otherwise read from `i18next.language`, so call sites never re-read
// `i18next.language` directly and the wiring does not drift.
//
// Formatter instances are memoized per (locale, options) pair —
// `Intl.DateTimeFormat` / `Intl.NumberFormat` / `Intl.RelativeTimeFormat`
// constructors are non-trivial in cost and the same formatters are
// reused on every render.
//
// No polyfill is wired: modern Chromium / Firefox / Safari and Node 20+
// support `Intl.RelativeTimeFormat` natively. The OBS browser-source
// target uses a recent Chromium; if a supported browser surface ever
// lacks it, revisit per the refinement Open question.

import i18next from 'i18next';

import { defaultLocale } from './negotiation.js';

/**
 * Read the active locale: explicit argument wins; otherwise read
 * `i18next.language`; otherwise fall back to `defaultLocale()` (`en-US`).
 *
 * `i18next.language` is `undefined` until `i18next.init(...)` has
 * resolved. That window is narrow in practice (the apps init i18next
 * synchronously at boot before mounting React) but is still observable
 * in tests, so the fallback is explicit rather than depending on init
 * timing.
 */
function resolveLocale(locale: string | undefined): string {
  if (locale !== undefined && locale !== '') return locale;
  const fromI18next = i18next.language;
  if (typeof fromI18next === 'string' && fromI18next !== '') return fromI18next;
  return defaultLocale();
}

/**
 * Stable JSON-style stringification of `Intl` options objects for use as
 * a memoization key. The options surface is small (a handful of string
 * enums + booleans + numbers) so `JSON.stringify` with sorted keys is
 * adequate; we do not need to handle cyclic structures or function
 * values.
 *
 * Sorting the keys means `{ year: 'numeric', month: 'long' }` and
 * `{ month: 'long', year: 'numeric' }` collapse to the same cache entry
 * — without this, equivalent option bags would each spawn their own
 * formatter instance and the memoization payoff would be lost.
 */
function stableKey(options: Record<string, unknown> | undefined): string {
  if (options === undefined) return '';
  const keys = Object.keys(options).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const value = options[key];
    if (value === undefined) continue;
    parts.push(`${key}:${JSON.stringify(value)}`);
  }
  return parts.join('|');
}

/**
 * Memoization caches. Each cache is keyed by `${locale}\x1f${stableKey}`
 * — `\x1f` (ASCII unit separator) is a character that cannot appear in
 * a locale tag or in a JSON-encoded string, so it is a safe delimiter.
 *
 * The caches are module-level — they live as long as the JS realm
 * does. For a long-lived single-page app that is the desired lifetime;
 * for tests that mutate the active locale across cases the cache key
 * still discriminates by locale so no cross-contamination occurs.
 *
 * Exposed (via `__resetFormatterCache`) so tests can verify memoization
 * behaviour without relying on internal state shape.
 */
const dateTimeCache = new Map<string, Intl.DateTimeFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();
const relativeTimeCache = new Map<string, Intl.RelativeTimeFormat>();

/**
 * Reset every memoization cache. Test-only — production code has no
 * reason to invalidate the caches because (locale, options) is the
 * complete key surface and a hit is always correct.
 */
export function __resetFormatterCache(): void {
  dateTimeCache.clear();
  numberCache.clear();
  relativeTimeCache.clear();
}

/**
 * Return the cached `Intl.DateTimeFormat` for a (locale, options) pair,
 * constructing it on first use.
 *
 * Exported so callers that want to format many timestamps with the same
 * options can grab the formatter once and call `.format()` directly in
 * a hot loop — the memoization makes the per-call cost negligible
 * either way, but the explicit-formatter path is the documented
 * recommendation for tight inner loops.
 */
export function getDateTimeFormatter(
  locale?: string,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const resolved = resolveLocale(locale);
  const key = `${resolved}\x1f${stableKey(options as Record<string, unknown> | undefined)}`;
  let formatter = dateTimeCache.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(resolved, options);
    dateTimeCache.set(key, formatter);
  }
  return formatter;
}

/**
 * Return the cached `Intl.NumberFormat` for a (locale, options) pair.
 * Construction is memoized; see `getDateTimeFormatter` for the
 * rationale.
 */
export function getNumberFormatter(
  locale?: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const resolved = resolveLocale(locale);
  const key = `${resolved}\x1f${stableKey(options as Record<string, unknown> | undefined)}`;
  let formatter = numberCache.get(key);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(resolved, options);
    numberCache.set(key, formatter);
  }
  return formatter;
}

/**
 * Return the cached `Intl.RelativeTimeFormat` for a (locale, options)
 * pair. Construction is memoized; see `getDateTimeFormatter`.
 */
export function getRelativeTimeFormatter(
  locale?: string,
  options?: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  const resolved = resolveLocale(locale);
  const key = `${resolved}\x1f${stableKey(options as Record<string, unknown> | undefined)}`;
  let formatter = relativeTimeCache.get(key);
  if (formatter === undefined) {
    formatter = new Intl.RelativeTimeFormat(resolved, options);
    relativeTimeCache.set(key, formatter);
  }
  return formatter;
}

/**
 * Format a date in date-only form (no time component) for the active
 * locale. Accepts an explicit locale tag; otherwise reads
 * `i18next.language`; otherwise falls back to `defaultLocale()`.
 *
 * Default options follow the `Intl.DateTimeFormat` runtime default
 * (locale-dependent short date), but callers will typically pass
 * `{ dateStyle: 'long' }` or similar to match the surface they render
 * into.
 */
export function formatDate(
  date: Date | number,
  options?: Intl.DateTimeFormatOptions & { readonly locale?: string },
): string {
  const { locale, ...rest } = options ?? {};
  // `dateStyle` is the canonical "date-only" hint; if the caller did
  // not pass any options at all we default to `{ dateStyle: 'medium' }`
  // so the formatter does not emit a time component (the runtime
  // default for `Intl.DateTimeFormat` with no options is a short
  // date-only form anyway, but being explicit keeps the contract
  // predictable across runtimes).
  const formatterOptions: Intl.DateTimeFormatOptions =
    Object.keys(rest).length === 0 ? { dateStyle: 'medium' } : rest;
  return getDateTimeFormatter(locale, formatterOptions).format(date);
}

/**
 * Format a date in time-only form (no date component) for the active
 * locale. Default options use `{ timeStyle: 'short' }` — a
 * locale-appropriate hours:minutes rendering, which is the common case
 * for event-log timestamps within a single session.
 */
export function formatTime(
  date: Date | number,
  options?: Intl.DateTimeFormatOptions & { readonly locale?: string },
): string {
  const { locale, ...rest } = options ?? {};
  const formatterOptions: Intl.DateTimeFormatOptions =
    Object.keys(rest).length === 0 ? { timeStyle: 'short' } : rest;
  return getDateTimeFormatter(locale, formatterOptions).format(date);
}

/**
 * Format a combined date + time for the active locale. Default options
 * use `{ dateStyle: 'medium', timeStyle: 'short' }` — a compact form
 * suitable for replay seek-bar tooltips and snapshot labels.
 */
export function formatDateTime(
  date: Date | number,
  options?: Intl.DateTimeFormatOptions & { readonly locale?: string },
): string {
  const { locale, ...rest } = options ?? {};
  const formatterOptions: Intl.DateTimeFormatOptions =
    Object.keys(rest).length === 0 ? { dateStyle: 'medium', timeStyle: 'short' } : rest;
  return getDateTimeFormatter(locale, formatterOptions).format(date);
}

/**
 * Format a number for the active locale. Pass `Intl.NumberFormat`
 * options on the same argument (`{ minimumFractionDigits: 2 }`,
 * `{ style: 'percent' }`, etc.).
 */
export function formatNumber(
  value: number | bigint,
  options?: Intl.NumberFormatOptions & { readonly locale?: string },
): string {
  const { locale, ...rest } = options ?? {};
  return getNumberFormatter(locale, rest).format(value);
}

/**
 * Format a relative time value (`-5, 'minute'` → "5 minutes ago" /
 * "hace 5 minutos" / "há 5 minutos") for the active locale. Used by the
 * change-history pane and any "N seconds ago" prose.
 *
 * The sign convention is the `Intl.RelativeTimeFormat` native one:
 * **negative values are in the past**, positive values are in the
 * future. The default `numeric: 'auto'` lets the formatter use
 * locale-appropriate words ("yesterday" / "ayer" / "ontem") when
 * the value matches a canonical unit.
 */
export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options?: Intl.RelativeTimeFormatOptions & { readonly locale?: string },
): string {
  const { locale, ...rest } = options ?? {};
  const formatterOptions: Intl.RelativeTimeFormatOptions =
    Object.keys(rest).length === 0 ? { numeric: 'auto' } : rest;
  return getRelativeTimeFormatter(locale, formatterOptions).format(value, unit);
}
