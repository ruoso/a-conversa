// Shell-supplied i18n bootstrap factory.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// ADR:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Hoisted from `apps/moderator/src/i18n.ts` — the moderator-local 26-line
// wrapper around `i18next.use(ICU).use(initReactI18next).init(...)` moves
// wholesale into the shell so every UI surface (moderator, participant,
// audience, replay-test, root) bootstraps i18n the same way. Renamed
// from `initI18n` to `createI18nInstance` to make the "this returns an
// instance, you bind it to a provider" semantics explicit.

import i18next, { type i18n as I18nInstance } from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';
import { buildInitOptions, type SupportedLocale } from '@a-conversa/i18n-catalogs';

/**
 * Boot the shared i18next instance for the given locale. Idempotent —
 * calling twice with the same locale resolves with the same singleton
 * instance, the second `init()` call is i18next's own no-op fast path.
 *
 * Consumer pairs the returned instance with `<I18nProvider>` from this
 * package to make `useTranslation()` resolve in the subtree.
 */
export async function createI18nInstance(locale: SupportedLocale): Promise<I18nInstance> {
  await i18next.use(ICU).use(initReactI18next).init(buildInitOptions(locale));
  return i18next;
}
