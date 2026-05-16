// Barrel for the shell's i18n subsystem.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md

export { createI18nInstance } from './createI18nInstance.js';
export { I18nProvider, type I18nProviderProps } from './I18nProvider.js';

// Re-export the canonical i18next instance type so the mount-contract
// module can widen its `I18n` placeholder to the real shape without the
// contract module taking a hard dependency on `i18next` itself.
export type { i18n as I18nInstance } from 'i18next';
