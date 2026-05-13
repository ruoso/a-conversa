// Tests for the locale-negotiation helpers.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_locale_negotiation.md
// ADRs:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: frontend_i18n.i18n_locale_negotiation
//
// Pure-logic + happy-dom layer (no network, no real server) — Vitest
// unit tests per ADR 0022's layer routing. Covers:
//
//   - `canonicalizeLocale` maps exact / case-variant / language-only /
//     unsupported tags onto the v1 supported set.
//   - `defaultLocale` returns `en-US` (the FALLBACK_LNG default).
//   - The cookie round-trip: `persistLocale` writes a cookie that
//     `readLocaleCookie` reads back.
//   - `negotiateAuthenticatedLocale` precedence:
//       cookie > navigator.languages > navigator.language > en-US.
//   - `negotiateUrlLocale` parses the leading URL segment with both
//     exact and loose (language-only / mixed case) matching, and
//     strips the prefix from the residual path.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LOCALE_COOKIE_NAME,
  canonicalizeLocale,
  clearLocaleCookie,
  defaultLocale,
  negotiateAuthenticatedLocale,
  negotiateUrlLocale,
  persistLocale,
  readLocaleCookie,
} from './negotiation.js';

describe('canonicalizeLocale', () => {
  it('returns undefined for nullish / empty input', () => {
    expect(canonicalizeLocale(undefined)).toBeUndefined();
    expect(canonicalizeLocale(null)).toBeUndefined();
    expect(canonicalizeLocale('')).toBeUndefined();
  });

  it('maps an exact supported tag to itself', () => {
    expect(canonicalizeLocale('en-US')).toBe('en-US');
    expect(canonicalizeLocale('pt-BR')).toBe('pt-BR');
    expect(canonicalizeLocale('es-419')).toBe('es-419');
  });

  it('is case-insensitive on the exact match', () => {
    expect(canonicalizeLocale('pt-br')).toBe('pt-BR');
    expect(canonicalizeLocale('PT-BR')).toBe('pt-BR');
    expect(canonicalizeLocale('Es-419')).toBe('es-419');
  });

  it('maps a language-only tag to the v1 supported region', () => {
    expect(canonicalizeLocale('en')).toBe('en-US');
    expect(canonicalizeLocale('pt')).toBe('pt-BR');
    expect(canonicalizeLocale('es')).toBe('es-419');
  });

  it('maps a non-shipped region of a supported language to the shipped region', () => {
    // pt-PT speakers see pt-BR; es-MX speakers see es-419. Strictly
    // better than serving en-US silently.
    expect(canonicalizeLocale('pt-PT')).toBe('pt-BR');
    expect(canonicalizeLocale('es-MX')).toBe('es-419');
    expect(canonicalizeLocale('es-ES')).toBe('es-419');
    expect(canonicalizeLocale('en-GB')).toBe('en-US');
  });

  it('returns undefined for an unsupported language', () => {
    expect(canonicalizeLocale('fr')).toBeUndefined();
    expect(canonicalizeLocale('fr-FR')).toBeUndefined();
    expect(canonicalizeLocale('zz')).toBeUndefined();
  });
});

describe('defaultLocale', () => {
  it('returns en-US (the FALLBACK_LNG default)', () => {
    expect(defaultLocale()).toBe('en-US');
  });
});

describe('locale cookie round-trip', () => {
  beforeEach(() => {
    clearLocaleCookie();
  });

  afterEach(() => {
    clearLocaleCookie();
  });

  it('persistLocale writes a cookie that readLocaleCookie reads back', () => {
    persistLocale('pt-BR');
    expect(readLocaleCookie()).toBe('pt-BR');
  });

  it('persistLocale uses the documented cookie name', () => {
    persistLocale('es-419');
    expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=es-419`);
  });

  it('clearLocaleCookie removes the cookie', () => {
    persistLocale('pt-BR');
    expect(readLocaleCookie()).toBe('pt-BR');
    clearLocaleCookie();
    expect(readLocaleCookie()).toBeUndefined();
  });

  it('readLocaleCookie returns undefined when the cookie is unset', () => {
    expect(readLocaleCookie()).toBeUndefined();
  });

  it('readLocaleCookie returns undefined when the cookie value is unsupported', () => {
    // Set a raw cookie with a value outside the supported set; the
    // canonicalizer must reject it so the negotiation chain moves on
    // rather than booting i18next with a tag it can't resolve.
    document.cookie = `${LOCALE_COOKIE_NAME}=fr-FR; Path=/; SameSite=Lax`;
    expect(readLocaleCookie()).toBeUndefined();
  });

  it('readLocaleCookie canonicalizes a language-only cookie value', () => {
    document.cookie = `${LOCALE_COOKIE_NAME}=pt; Path=/; SameSite=Lax`;
    expect(readLocaleCookie()).toBe('pt-BR');
  });
});

describe('negotiateAuthenticatedLocale', () => {
  beforeEach(() => {
    clearLocaleCookie();
  });

  afterEach(() => {
    clearLocaleCookie();
    vi.unstubAllGlobals();
  });

  it('returns the cookie value when set (cookie wins over navigator)', () => {
    persistLocale('pt-BR');
    // Stub navigator.languages to prefer es-419 — cookie still wins.
    vi.stubGlobal('navigator', {
      ...navigator,
      languages: ['es-419', 'es'],
      language: 'es-419',
    });
    expect(negotiateAuthenticatedLocale()).toBe('pt-BR');
  });

  it('falls back to navigator.languages when no cookie is set', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      languages: ['pt-BR', 'en-US'],
      language: 'pt-BR',
    });
    expect(negotiateAuthenticatedLocale()).toBe('pt-BR');
  });

  it('picks the first navigator.languages entry that canonicalizes to a supported locale', () => {
    // First entry is an unsupported language; second is supported.
    vi.stubGlobal('navigator', {
      ...navigator,
      languages: ['fr-FR', 'es-MX', 'en-US'],
      language: 'fr-FR',
    });
    expect(negotiateAuthenticatedLocale()).toBe('es-419');
  });

  it('falls back to en-US when no navigator languages canonicalize', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      languages: ['fr-FR', 'de-DE'],
      language: 'fr-FR',
    });
    expect(negotiateAuthenticatedLocale()).toBe('en-US');
  });

  it('falls back to en-US when navigator.languages is empty', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      languages: [],
      language: '',
    });
    expect(negotiateAuthenticatedLocale()).toBe('en-US');
  });
});

describe('negotiateUrlLocale', () => {
  it('parses an exact supported tag from the leading URL segment', () => {
    expect(negotiateUrlLocale('/pt-BR/sessions/abc123')).toEqual({
      locale: 'pt-BR',
      residualPath: '/sessions/abc123',
    });
    expect(negotiateUrlLocale('/es-419/replay/xyz')).toEqual({
      locale: 'es-419',
      residualPath: '/replay/xyz',
    });
    expect(negotiateUrlLocale('/en-US/')).toEqual({
      locale: 'en-US',
      residualPath: '/',
    });
  });

  it('falls back to en-US when no locale prefix is present', () => {
    expect(negotiateUrlLocale('/sessions/abc123')).toEqual({
      locale: 'en-US',
      residualPath: '/sessions/abc123',
    });
  });

  it('falls back to en-US for the root path', () => {
    expect(negotiateUrlLocale('/')).toEqual({
      locale: 'en-US',
      residualPath: '/',
    });
  });

  it('falls back to en-US for an unrecognized leading segment', () => {
    expect(negotiateUrlLocale('/foo/sessions/abc123')).toEqual({
      locale: 'en-US',
      residualPath: '/foo/sessions/abc123',
    });
  });

  it('accepts loose-match language-only prefixes', () => {
    // `/pt/sessions/...` resolves to pt-BR — producers who use the
    // shorter form get the v1 region. Refinement note: producers are
    // expected to use the full tag, but loose matching keeps the
    // surface forgiving when v1 ships.
    expect(negotiateUrlLocale('/pt/sessions/abc123')).toEqual({
      locale: 'pt-BR',
      residualPath: '/sessions/abc123',
    });
  });

  it('accepts mixed-case prefixes via loose match', () => {
    expect(negotiateUrlLocale('/pt-br/sessions/abc')).toEqual({
      locale: 'pt-BR',
      residualPath: '/sessions/abc',
    });
  });

  it('strips the locale prefix when no residual path remains', () => {
    expect(negotiateUrlLocale('/pt-BR')).toEqual({
      locale: 'pt-BR',
      residualPath: '/',
    });
  });
});
