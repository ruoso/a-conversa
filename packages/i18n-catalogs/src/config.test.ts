// Tests for the `@a-conversa/i18n-catalogs` config + catalog wiring.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_catalog_workflow.md
// ADRs:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: frontend_i18n.i18n_catalog_workflow
//
// Pure-logic layer (no DOM, no network) — Vitest unit tests per
// ADR 0022's layer routing. Covers:
//
//   - The acceptance-criteria example key (`chrome.hello`) resolves to
//     the locale-appropriate string in en-US / pt-BR / es-419.
//   - The fallback chain (`pt-BR` → `en-US`) returns the en-US string
//     when a key exists only in en-US (sanity: ICU + i18next is wired
//     correctly, not just our catalogs).
//   - `buildInitOptions(locale)` returns the contract the consumers
//     depend on (lng, fallbackLng, supportedLngs, defaultNS).
//   - The namespace constants and supported-locale list are the
//     committed source of truth.
//
// The parity check (every en-US key present in pt-BR and es-419) is a
// separate Node script (`scripts/check-parity.ts`) and is wired into
// CI rather than vitest, but the same invariant is exercised here
// indirectly: a regression that drops a key from one of the locale
// catalogs fails the `t('chrome.hello')` resolution test below.

import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import ICU from 'i18next-icu';

import {
  buildInitOptions,
  buildResources,
  FALLBACK_LNG,
  NAMESPACES,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from './config.js';

/**
 * Stand up an `i18next` instance with the canonical options for a
 * given locale. Returns the bound `t` function. Each test gets its own
 * instance (via `i18next.createInstance()`) so locale state is not
 * shared across cases.
 */
async function makeT(locale: SupportedLocale): Promise<(key: string) => string> {
  const instance = i18next.createInstance();
  await instance.use(ICU).init(buildInitOptions(locale));
  return (key: string) => instance.t(key);
}

describe('@a-conversa/i18n-catalogs config', () => {
  describe('SUPPORTED_LOCALES', () => {
    it('lists the three v1 locales in display order', () => {
      expect([...SUPPORTED_LOCALES]).toEqual(['en-US', 'pt-BR', 'es-419']);
    });
  });

  describe('NAMESPACES', () => {
    it('lists the four v1 namespaces', () => {
      expect([...NAMESPACES]).toEqual(['chrome', 'methodology', 'diagnostics', 'errors']);
    });
  });

  describe('FALLBACK_LNG', () => {
    it('routes pt-BR through pt → en-US', () => {
      expect(FALLBACK_LNG['pt-BR']).toEqual(['pt', 'en-US']);
    });

    it('routes es-419 through es → en-US', () => {
      expect(FALLBACK_LNG['es-419']).toEqual(['es', 'en-US']);
    });

    it('terminates en-US at en (no further fallback)', () => {
      expect(FALLBACK_LNG['en-US']).toEqual(['en']);
    });

    it('defaults to en-US for unknown tags', () => {
      expect(FALLBACK_LNG['default']).toEqual(['en-US']);
    });
  });

  describe('buildResources', () => {
    it('returns one entry per supported locale, each with a translation namespace', () => {
      const resources = buildResources();
      for (const locale of SUPPORTED_LOCALES) {
        expect(resources[locale]).toBeDefined();
        expect(resources[locale]?.translation).toBeDefined();
      }
    });
  });

  describe('buildInitOptions', () => {
    it('echoes the requested locale as lng', () => {
      const opts = buildInitOptions('pt-BR');
      expect(opts.lng).toBe('pt-BR');
    });

    it('sets fallbackLng to the canonical chain', () => {
      const opts = buildInitOptions('en-US');
      expect(opts.fallbackLng).toBe(FALLBACK_LNG);
    });

    it('declares the supportedLngs union', () => {
      const opts = buildInitOptions('en-US');
      expect([...opts.supportedLngs]).toEqual(['en-US', 'pt-BR', 'es-419']);
    });

    it('uses translation as the default namespace', () => {
      const opts = buildInitOptions('en-US');
      expect(opts.defaultNS).toBe('translation');
    });
  });
});

describe('catalog round-trip via i18next', () => {
  it('resolves chrome.hello in en-US', async () => {
    const t = await makeT('en-US');
    expect(t('chrome.hello')).toBe('hello, world');
  });

  it('resolves chrome.hello in pt-BR', async () => {
    const t = await makeT('pt-BR');
    expect(t('chrome.hello')).toBe('olá, mundo');
  });

  it('resolves chrome.hello in es-419', async () => {
    const t = await makeT('es-419');
    expect(t('chrome.hello')).toBe('hola, mundo');
  });

  it('falls back to en-US when a key is absent from the active locale', async () => {
    // Stand up a custom resource set: en-US has `chrome.only_en`, pt-BR
    // does not. With the canonical fallback chain, t('chrome.only_en')
    // in pt-BR must return the en-US value, not the raw key. This
    // sanity-checks that i18next's fallbackLng wiring works end-to-end
    // through `buildInitOptions`.
    const instance = i18next.createInstance();
    await instance.use(ICU).init({
      ...buildInitOptions('pt-BR'),
      resources: {
        'en-US': { translation: { chrome: { only_en: 'english-only' } } },
        'pt-BR': { translation: { chrome: {} } },
        'es-419': { translation: { chrome: {} } },
      },
    });
    expect(instance.t('chrome.only_en')).toBe('english-only');
  });
});
