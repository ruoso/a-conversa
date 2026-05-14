// Tests for the locale-aware Intl-backed formatting helpers.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_date_time_formatting.md
// ADRs:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: frontend_i18n.i18n_date_time_formatting
//
// Pure-logic layer (no DOM, no network) — Vitest unit tests per ADR 0022.
// Covers each exported helper in each of the three v1 locales, plus the
// locale-resolution chain (explicit arg > `i18next.language` > fallback)
// and formatter-instance memoization.
//
// Assertions match against the live `Intl` runtime output rather than
// hard-coded strings — the goal is to verify *that* each helper threads
// the locale into `Intl` correctly, not to pin a particular runtime's
// exact rendering (CLDR output can shift between Node minor versions).
// The locale-distinguishing assertions check that e.g. en-US and pt-BR
// produce different outputs for the same input, which is what we
// actually care about.

import { afterEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';

import {
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

const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

const SAMPLE_DATE = new Date(Date.UTC(2026, 4, 10, 14, 30, 0));

/**
 * Directly assign `i18next.language`. The real `changeLanguage(...)`
 * runs the full init / resource-load lifecycle which requires
 * `i18next.init(...)` to have completed first — overkill for tests
 * whose only purpose is to verify the format helpers' fallback chain.
 * The `language` field is a public readable property on the i18next
 * instance; writing to it directly is the minimal stub.
 */
function setI18nextLanguage(lng: string | undefined): void {
  (i18next as unknown as { language: string | undefined }).language = lng;
}

afterEach(() => {
  __resetFormatterCache();
  // The format helpers fall back to `i18next.language` when no explicit
  // locale is supplied; clear it between tests so accidental cross-test
  // state does not leak.
  setI18nextLanguage(undefined);
});

describe('formatDate', () => {
  for (const locale of LOCALES) {
    it(`renders a long date for ${locale} that matches Intl.DateTimeFormat`, () => {
      const expected = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(SAMPLE_DATE);
      expect(formatDate(SAMPLE_DATE, { locale, dateStyle: 'long' })).toBe(expected);
    });
  }

  it('produces different output for different locales (sanity)', () => {
    const enUS = formatDate(SAMPLE_DATE, { locale: 'en-US', dateStyle: 'long' });
    const ptBR = formatDate(SAMPLE_DATE, { locale: 'pt-BR', dateStyle: 'long' });
    const es419 = formatDate(SAMPLE_DATE, { locale: 'es-419', dateStyle: 'long' });
    expect(enUS).not.toBe(ptBR);
    expect(enUS).not.toBe(es419);
  });

  it('defaults to dateStyle: medium when no options are supplied', () => {
    const expected = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(SAMPLE_DATE);
    expect(formatDate(SAMPLE_DATE, { locale: 'en-US' })).toBe(expected);
  });

  it('accepts a number (epoch millis) as the date argument', () => {
    const millis = SAMPLE_DATE.getTime();
    expect(formatDate(millis, { locale: 'en-US', dateStyle: 'long' })).toBe(
      formatDate(SAMPLE_DATE, { locale: 'en-US', dateStyle: 'long' }),
    );
  });
});

describe('formatTime', () => {
  for (const locale of LOCALES) {
    it(`renders a short time for ${locale} that matches Intl.DateTimeFormat`, () => {
      const expected = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(SAMPLE_DATE);
      expect(formatTime(SAMPLE_DATE, { locale })).toBe(expected);
    });
  }

  it('accepts an explicit timeStyle override', () => {
    const expected = new Intl.DateTimeFormat('en-US', { timeStyle: 'medium' }).format(SAMPLE_DATE);
    expect(formatTime(SAMPLE_DATE, { locale: 'en-US', timeStyle: 'medium' })).toBe(expected);
  });
});

describe('formatDateTime', () => {
  for (const locale of LOCALES) {
    it(`renders combined date + time for ${locale} that matches Intl.DateTimeFormat`, () => {
      const expected = new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(SAMPLE_DATE);
      expect(formatDateTime(SAMPLE_DATE, { locale })).toBe(expected);
    });
  }

  it('accepts an explicit dateStyle / timeStyle override', () => {
    const expected = new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'full',
      timeStyle: 'medium',
    }).format(SAMPLE_DATE);
    expect(
      formatDateTime(SAMPLE_DATE, {
        locale: 'pt-BR',
        dateStyle: 'full',
        timeStyle: 'medium',
      }),
    ).toBe(expected);
  });
});

describe('formatNumber', () => {
  for (const locale of LOCALES) {
    it(`renders an integer for ${locale} that matches Intl.NumberFormat`, () => {
      const expected = new Intl.NumberFormat(locale).format(1234567);
      expect(formatNumber(1234567, { locale })).toBe(expected);
    });

    it(`renders a fractional value for ${locale}`, () => {
      const expected = new Intl.NumberFormat(locale, { minimumFractionDigits: 2 }).format(3.5);
      expect(formatNumber(3.5, { locale, minimumFractionDigits: 2 })).toBe(expected);
    });
  }

  it('produces locale-distinct grouping separators (sanity)', () => {
    // en-US uses ',' for groups; pt-BR uses '.'. The two outputs for the
    // same input must therefore differ.
    expect(formatNumber(1234567, { locale: 'en-US' })).not.toBe(
      formatNumber(1234567, { locale: 'pt-BR' }),
    );
  });

  it('accepts a percent style', () => {
    const expected = new Intl.NumberFormat('en-US', { style: 'percent' }).format(0.42);
    expect(formatNumber(0.42, { locale: 'en-US', style: 'percent' })).toBe(expected);
  });
});

describe('formatRelativeTime', () => {
  for (const locale of LOCALES) {
    it(`renders "5 minutes ago" for ${locale} that matches Intl.RelativeTimeFormat`, () => {
      const expected = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
        -5,
        'minute',
      );
      expect(formatRelativeTime(-5, 'minute', { locale })).toBe(expected);
    });
  }

  it('uses numeric: "auto" by default so canonical units get locale words', () => {
    // numeric: 'auto' renders -1 day as "yesterday" / "ayer" / "ontem"
    // rather than "1 day ago". Verify that auto is the active default.
    const auto = formatRelativeTime(-1, 'day', { locale: 'en-US' });
    const always = formatRelativeTime(-1, 'day', { locale: 'en-US', numeric: 'always' });
    expect(auto).not.toBe(always);
  });

  it('produces locale-distinct output for the same value', () => {
    const enUS = formatRelativeTime(-3, 'hour', { locale: 'en-US' });
    const ptBR = formatRelativeTime(-3, 'hour', { locale: 'pt-BR' });
    expect(enUS).not.toBe(ptBR);
  });
});

describe('locale resolution chain', () => {
  it('falls back to defaultLocale (en-US) when no locale + i18next.language is unset', () => {
    setI18nextLanguage(undefined);
    expect(formatDate(SAMPLE_DATE, { dateStyle: 'long' })).toBe(
      new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(SAMPLE_DATE),
    );
  });

  it('reads i18next.language when no explicit locale is supplied', () => {
    setI18nextLanguage('pt-BR');
    expect(formatDate(SAMPLE_DATE, { dateStyle: 'long' })).toBe(
      new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(SAMPLE_DATE),
    );
  });

  it('explicit locale wins over i18next.language', () => {
    setI18nextLanguage('pt-BR');
    expect(formatDate(SAMPLE_DATE, { locale: 'es-419', dateStyle: 'long' })).toBe(
      new Intl.DateTimeFormat('es-419', { dateStyle: 'long' }).format(SAMPLE_DATE),
    );
  });
});

describe('memoization', () => {
  it('returns the same Intl.DateTimeFormat instance for repeated (locale, options) calls', () => {
    const a = getDateTimeFormatter('en-US', { dateStyle: 'long' });
    const b = getDateTimeFormatter('en-US', { dateStyle: 'long' });
    expect(a).toBe(b);
  });

  it('treats option-key order as equivalent (stable cache key)', () => {
    const a = getDateTimeFormatter('en-US', { dateStyle: 'long', timeStyle: 'short' });
    const b = getDateTimeFormatter('en-US', { timeStyle: 'short', dateStyle: 'long' });
    expect(a).toBe(b);
  });

  it('returns distinct formatter instances for different locales', () => {
    const a = getDateTimeFormatter('en-US', { dateStyle: 'long' });
    const b = getDateTimeFormatter('pt-BR', { dateStyle: 'long' });
    expect(a).not.toBe(b);
  });

  it('returns distinct formatter instances for different options', () => {
    const a = getDateTimeFormatter('en-US', { dateStyle: 'long' });
    const b = getDateTimeFormatter('en-US', { dateStyle: 'short' });
    expect(a).not.toBe(b);
  });

  it('memoizes Intl.NumberFormat instances per (locale, options) pair', () => {
    const a = getNumberFormatter('en-US', { style: 'percent' });
    const b = getNumberFormatter('en-US', { style: 'percent' });
    expect(a).toBe(b);
  });

  it('memoizes Intl.RelativeTimeFormat instances per (locale, options) pair', () => {
    const a = getRelativeTimeFormatter('pt-BR', { numeric: 'auto' });
    const b = getRelativeTimeFormatter('pt-BR', { numeric: 'auto' });
    expect(a).toBe(b);
  });

  it('rebuilds a formatter after __resetFormatterCache', () => {
    const a = getDateTimeFormatter('en-US', { dateStyle: 'long' });
    __resetFormatterCache();
    const b = getDateTimeFormatter('en-US', { dateStyle: 'long' });
    expect(a).not.toBe(b);
  });
});
