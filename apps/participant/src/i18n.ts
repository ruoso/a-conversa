// Participant-surface i18next bootstrap.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_catalog_workflow.md
// ADR:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Initializes a single shared `i18next` instance for the participant
// tablet using the canonical config from `@a-conversa/i18n-catalogs`.
// The locale parameter is resolved upstream by
// `frontend_i18n.i18n_locale_negotiation` (browser-detector +
// `aconversa_locale` cookie on the participant surface); this module
// only owns the i18next plugin chain (`i18next-icu` for ICU
// MessageFormat per ADR 0024, plus `initReactI18next` so React
// components consume the bound `t`).
//
// `part_app_skeleton` calls `initI18n(locale)` from its `main.tsx`
// before mounting the React root.

import i18next, { type i18n as I18nInstance } from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';
import { buildInitOptions, type SupportedLocale } from '@a-conversa/i18n-catalogs';

export async function initI18n(locale: SupportedLocale): Promise<I18nInstance> {
  await i18next.use(ICU).use(initReactI18next).init(buildInitOptions(locale));
  return i18next;
}
