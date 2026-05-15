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
import { useWsStore } from './ws/wsStore';

async function bootstrap(): Promise<void> {
  await initI18n(negotiateAuthenticatedLocale());

  // Expose the WS store on `window` so the Playwright e2e specs in
  // `tests/e2e/` can seed synthetic events into the moderator canvas
  // without spinning up the full server-side capture flow.
  // Refinement: `tasks/refinements/moderator-ui/mod_hover_details.md`.
  //
  // **Not security-sensitive.** The store reference is the same one
  // the SPA already has in scope; exposing it on `window` does not
  // grant any capability that wasn't already reachable through the
  // module graph. The named global makes the test plumbing reusable
  // across future graph-rendering e2e specs (pan/zoom, layout, capture
  // flow).
  //
  // **Not gated on `import.meta.env.DEV`.** The compose stack's
  // production-mode build (used by `make up-prod-mode` for CI parity
  // and by the runtime image's default Vite `production` build mode
  // even when `NODE_ENV=development` is set on the container) would
  // tree-shake away a DEV-gated branch, leaving the e2e spec without
  // its seed entry point. The exposure stays unconditional; the cost
  // is one extra property assignment on `window` per page load.
  (window as unknown as { __aConversaWsStore?: typeof useWsStore }).__aConversaWsStore = useWsStore;

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
