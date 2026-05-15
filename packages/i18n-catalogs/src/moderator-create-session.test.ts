// Round-trip parity tests for the `moderator.createSession.*` catalog
// namespace.
//
// Refinement: tasks/refinements/moderator-ui/mod_create_session_form.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
// TaskJuggler: moderator_ui.mod_session_setup.mod_create_session_form
//
// Acceptance criterion from the refinement:
//
//   "The parity-check script (`pnpm --filter @a-conversa/i18n-catalogs
//    run check`) enforces that every en-US key has pt-BR and es-419
//    counterparts; the catalog edits MUST land all three locales
//    together."
//
// This file is the round-trip probe per ADR 0022: every dotted key
// under `moderator.createSession.*` resolves to a non-empty,
// locale-distinct string in every supported locale. Symmetric with
// `methodology.test.ts`'s structure.

import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import ICU from 'i18next-icu';

import { buildInitOptions, SUPPORTED_LOCALES, type SupportedLocale } from './config.js';

/**
 * The 15 dotted keys this task introduces. Mirrors the table in the
 * refinement's Constraints → i18n catalog keys section. Adding a key
 * here is the structural probe that the catalog edits landed in all
 * three locales.
 */
const CREATE_SESSION_KEYS = [
  'moderator.createSession.title',
  'moderator.createSession.topic.label',
  'moderator.createSession.topic.placeholder',
  'moderator.createSession.privacy.label',
  'moderator.createSession.privacy.public',
  'moderator.createSession.privacy.private',
  'moderator.createSession.submit',
  'moderator.createSession.errors.topicRequired',
  'moderator.createSession.errors.topicTooLong',
  'moderator.createSession.errors.privacyInvalid',
  'moderator.createSession.errors.validation',
  'moderator.createSession.errors.unauthenticated',
  'moderator.createSession.errors.network',
  'moderator.createSession.errors.generic',
] as const;

/**
 * ICU-template key — checked separately because it requires
 * substitution arguments to render.
 */
const HELPER_KEY = 'moderator.createSession.helper' as const;

async function makeT(
  locale: SupportedLocale,
): Promise<(key: string, vars?: Record<string, unknown>) => string> {
  const instance = i18next.createInstance();
  await instance.use(ICU).init(buildInitOptions(locale));
  return (key: string, vars?: Record<string, unknown>) => instance.t(key, vars ?? {});
}

describe('moderator.createSession.* round-trip', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const key of CREATE_SESSION_KEYS) {
        it(`resolves ${key} to a non-empty string`, async () => {
          const t = await makeT(locale);
          const value = t(key);
          expect(value).toBeTruthy();
          expect(value.length).toBeGreaterThan(0);
          // i18next returns the key when missing (returnNull: false).
          expect(value).not.toBe(key);
        });
      }

      it(`resolves ${HELPER_KEY} as an ICU template substituting {used}/{max}`, async () => {
        const t = await makeT(locale);
        const rendered = t(HELPER_KEY, { used: 12, max: 256 });
        expect(rendered).toBeTruthy();
        expect(rendered).not.toBe(HELPER_KEY);
        expect(rendered).toContain('12');
        expect(rendered).toContain('256');
      });
    });
  }
});

describe('moderator.createSession.* non-en-US locales translate (not copy) en-US', () => {
  it('every key resolves to a locale-distinct string in pt-BR and es-419', async () => {
    const tEn = await makeT('en-US');
    const tPt = await makeT('pt-BR');
    const tEs = await makeT('es-419');
    for (const key of CREATE_SESSION_KEYS) {
      const en = tEn(key);
      expect(tPt(key), `pt-BR.${key} should differ from en-US`).not.toBe(en);
      expect(tEs(key), `es-419.${key} should differ from en-US`).not.toBe(en);
    }
  });
});

describe('moderator.createSession.* canonical en-US strings', () => {
  // Pins the canonical authoritative en-US text. If the canonical
  // table in the refinement is edited, this test moves with it.
  it('en-US title = "Create a session"', async () => {
    const t = await makeT('en-US');
    expect(t('moderator.createSession.title')).toBe('Create a session');
  });

  it('en-US submit = "Create session"', async () => {
    const t = await makeT('en-US');
    expect(t('moderator.createSession.submit')).toBe('Create session');
  });

  it('en-US topic.label = "Debate topic"', async () => {
    const t = await makeT('en-US');
    expect(t('moderator.createSession.topic.label')).toBe('Debate topic');
  });

  it('en-US helper template renders "{used}/{max} characters" with substitutions', async () => {
    const t = await makeT('en-US');
    expect(t('moderator.createSession.helper', { used: 0, max: 256 })).toBe('0/256 characters');
    expect(t('moderator.createSession.helper', { used: 5, max: 256 })).toBe('5/256 characters');
  });
});
