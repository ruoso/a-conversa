// Moderator app entry point. Initialises i18n (ADR 0024) before
// mounting the React tree so the first paint already has the active
// locale resolved.
//
// Refinement: tasks/refinements/moderator-ui/mod_app_skeleton.md
// ADRs:       0003 (React), 0024 (react-i18next + ICU)
//
// Locale resolution goes through `negotiateAuthenticatedLocale()` from
// `@a-conversa/i18n-catalogs` (see refinement
// `tasks/refinements/frontend-i18n/i18n_locale_negotiation.md`):
// the `aconversa_locale` cookie wins outright; otherwise the chain
// walks `navigator.languages` (canonicalizing onto the v1 supported
// set) and finally falls back to `en-US`.

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { negotiateAuthenticatedLocale } from '@a-conversa/i18n-catalogs';

import './index.css';
import { App } from './App';
import { initI18n } from './i18n';

async function bootstrap(): Promise<void> {
  await initI18n(negotiateAuthenticatedLocale());

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
