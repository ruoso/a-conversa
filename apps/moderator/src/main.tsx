// Moderator app entry point. Initialises i18n (ADR 0024) before
// mounting the React tree so the first paint already has the active
// locale resolved.
//
// Refinement: tasks/refinements/moderator-ui/mod_app_skeleton.md
// ADRs:       0003 (React), 0024 (react-i18next + ICU)
//
// Locale resolution today is a thin browser-language read; the full
// negotiation (cookie + Accept-Language + admin override) lands with
// `frontend_i18n.i18n_locale_negotiation`. Until then this entrypoint
// picks an `en-US` / `pt-BR` / `es-419` value off `navigator.language`
// so the chain is exercisable end-to-end.

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@a-conversa/i18n-catalogs';

import { App } from './App';
import { initI18n } from './i18n';

function pickLocale(): SupportedLocale {
  const candidate = (navigator.language || 'en-US').toLowerCase();
  if (candidate.startsWith('pt')) return 'pt-BR';
  if (candidate.startsWith('es')) return 'es-419';
  // Default to the first supported locale (`en-US` by SUPPORTED_LOCALES ordering).
  return SUPPORTED_LOCALES[0];
}

async function bootstrap(): Promise<void> {
  await initI18n(pickLocale());

  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element #root not found in index.html');
  }
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
}

void bootstrap();
