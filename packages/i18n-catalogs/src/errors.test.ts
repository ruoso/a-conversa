// Coverage test for the `errors` namespace.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_error_code_catalog.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
// TaskJuggler: frontend_i18n.i18n_error_code_catalog
//
// Acceptance from the refinement:
//
//   "Vitest test: given a synthetic ApiError for each code, the
//    frontend's error-renderer produces a non-empty localized string in
//    each locale."
//
// This file is that test (the renderer surface lands later; here we
// drive `t('errors.<code>')` directly through an i18next instance, which
// is the same lookup the future helper will perform).
//
// Three code sets must be covered in every v1 locale:
//
//   1. HTTP `ApiError` factory codes from `apps/server/src/errors.ts`.
//      These are class statics — no runtime list exists; the literal
//      below mirrors the seven canonical factories. Adding a factory
//      in `errors.ts` (which is rare; status classes are mostly
//      stable) MUST be matched by an entry here so this test stays
//      the catalog's authoritative source. Same pattern
//      `protocol-docs.test.ts` uses for the doc-coverage check.
//
//   2. Methodology `RejectionReason` codes from
//      `apps/server/src/methodology/types.ts`. Hard-coded as a
//      record-of-true so adding a code in the server is a compile-time
//      pressure on this catalog (when the catalog test moves into the
//      server package's vitest project). For the catalog-package
//      surface we duplicate the literal — kept in sync via the same
//      audit method `protocol-docs.test.ts` uses.
//
//   3. WS-specific transport codes that are not in either of the above
//      sets: `unknown-message-type`, `malformed-envelope`,
//      `too-many-subscriptions`, `too-many-catch-up-requests`.
//
// Plus the runtime fallback key `errors.unknown` (per the refinement
// Decisions block — "Surfaced only when the parity-check would have
// caught the gap; defense-in-depth").
//
// Per ADR 0022, this is a committed regression test. The first run
// answers "does the catalog cover every error code" and pins the
// answer for every future CI run.

import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import ICU from 'i18next-icu';

import { buildInitOptions, SUPPORTED_LOCALES, type SupportedLocale } from './config.js';

/**
 * HTTP `ApiError` factory codes (kebab-case) from
 * `apps/server/src/errors.ts`. Mirrors the literal in
 * `apps/server/src/ws/protocol-docs.test.ts` (deliberate duplication
 * — each test owns its own source-of-truth literal so a rename of
 * the server-side factory breaks both tests in lockstep rather than
 * silently passing under the new name).
 */
const HTTP_API_ERROR_CODES: readonly string[] = [
  'bad-request',
  'unauthorized',
  'forbidden',
  'not-found',
  'conflict',
  'unprocessable-entity',
  'internal-error',
] as const;

/**
 * `RejectionReason` union from
 * `apps/server/src/methodology/types.ts`. Mirrors the literal in
 * `apps/server/src/ws/protocol-docs.test.ts` so the two tests track
 * the union by the same audit method. Adding a `RejectionReason` in
 * the server source requires extending both literals — failure mode
 * is a loud test failure here rather than a silently-missing catalog
 * entry in production.
 */
const REJECTION_REASONS: readonly string[] = [
  // Universal.
  'not-a-participant',
  'sequence-mismatch',
  'session-mismatch',
  // Role-gated.
  'not-a-moderator',
  // Proposal-reference.
  'proposal-not-found',
  'proposal-not-pending',
  'proposal-already-committed',
  'proposal-already-meta-disagreement',
  // Entity-reference.
  'target-entity-not-found',
  // Vote-specific.
  'already-voted',
  'no-prior-agree',
  'self-vote-not-allowed',
  'unanimous-agree-required',
  // Propose-axiom-mark.
  'axiom-mark-not-self',
  // Methodology-flow.
  'inapplicable-to-facet',
  'illegal-state-transition',
  'methodology-not-exhausted',
  // Participant-assignment.
  'role-already-filled',
  'user-already-joined',
  'user-not-found',
  'cannot-remove-moderator',
  // Entity-inclusion.
  'entity-not-referenceable',
  'entity-already-included',
] as const;

/**
 * WS-specific transport codes. Mirrors `WS_SPECIFIC_CODES` in
 * `apps/server/src/ws/protocol-docs.test.ts`.
 *
 *   - `unknown-message-type` — dispatcher's `onUnknownType` seam.
 *   - `malformed-envelope` — connection-level parse failure.
 *   - `too-many-subscriptions` — subscription cap (F-001).
 *   - `too-many-catch-up-requests` — catch-up rate limit (F-004).
 */
const WS_SPECIFIC_CODES: readonly string[] = [
  'unknown-message-type',
  'malformed-envelope',
  'too-many-subscriptions',
  'too-many-catch-up-requests',
] as const;

/**
 * Runtime-fallback key surfaced only when the parity check would have
 * caught the gap (per the refinement Decisions). The catalog ships an
 * entry per locale and the renderer treats it as the safe default
 * when an unknown `code` arrives on the wire.
 */
const FALLBACK_KEY = 'unknown';

const ALL_CODES: readonly string[] = [
  ...HTTP_API_ERROR_CODES,
  ...WS_SPECIFIC_CODES,
  ...REJECTION_REASONS,
  FALLBACK_KEY,
];

async function makeT(locale: SupportedLocale): Promise<(key: string) => string> {
  const instance = i18next.createInstance();
  await instance.use(ICU).init(buildInitOptions(locale));
  return (key: string) => instance.t(key);
}

describe('errors namespace — per-code coverage', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const code of ALL_CODES) {
        const key = `errors.${code}`;
        it(`resolves ${key} to a non-empty string`, async () => {
          const t = await makeT(locale);
          const value = t(key);
          // Non-empty.
          expect(value).toBeTruthy();
          expect(value.length).toBeGreaterThan(0);
          // Not the key itself (i18next returns the key when missing
          // because `returnNull: false` is set in `buildInitOptions`).
          expect(value).not.toBe(key);
        });
      }
    });
  }
});

describe('errors namespace — set coverage by source', () => {
  it('every HTTP ApiError factory code has an entry in en-US', async () => {
    const t = await makeT('en-US');
    const missing: string[] = [];
    for (const code of HTTP_API_ERROR_CODES) {
      const key = `errors.${code}`;
      const value = t(key);
      if (!value || value === key) {
        missing.push(code);
      }
    }
    expect(missing, `missing HTTP ApiError codes in en-US: ${missing.join(', ')}`).toEqual([]);
  });

  it('every RejectionReason has an entry in en-US', async () => {
    const t = await makeT('en-US');
    const missing: string[] = [];
    for (const code of REJECTION_REASONS) {
      const key = `errors.${code}`;
      const value = t(key);
      if (!value || value === key) {
        missing.push(code);
      }
    }
    expect(missing, `missing RejectionReason codes in en-US: ${missing.join(', ')}`).toEqual([]);
  });

  it('every WS-specific code has an entry in en-US', async () => {
    const t = await makeT('en-US');
    const missing: string[] = [];
    for (const code of WS_SPECIFIC_CODES) {
      const key = `errors.${code}`;
      const value = t(key);
      if (!value || value === key) {
        missing.push(code);
      }
    }
    expect(missing, `missing WS-specific codes in en-US: ${missing.join(', ')}`).toEqual([]);
  });

  it('the fallback errors.unknown key resolves in every locale', async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const t = await makeT(locale);
      const value = t('errors.unknown');
      expect(value).toBeTruthy();
      expect(value).not.toBe('errors.unknown');
    }
  });
});

describe('errors namespace — non-en-US locales translate (not copy) en-US', () => {
  it('every errors.<code> resolves to a locale-distinct string', async () => {
    const tEn = await makeT('en-US');
    const tPt = await makeT('pt-BR');
    const tEs = await makeT('es-419');

    for (const code of ALL_CODES) {
      const key = `errors.${code}`;
      const en = tEn(key);
      const pt = tPt(key);
      const es = tEs(key);

      // pt-BR and es-419 strings must differ from the English. The
      // error vocabulary is prose (full sentences, not vocabulary
      // tokens); cognate collisions are far less likely than in the
      // methodology glossary, so we apply the check uniformly without
      // an exception allow-list. If a legitimate cross-locale
      // collision lands, the test failure will surface it and we can
      // extend with a `STRUCTURALLY_IDENTICAL`-style allow-list at
      // that point.
      expect(pt, `pt-BR.${key} should differ from en-US`).not.toBe(en);
      expect(es, `es-419.${key} should differ from en-US`).not.toBe(en);
    }
  });
});
