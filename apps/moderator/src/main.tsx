// Moderator app entry point. Initialises i18n (ADR 0024) before
// mounting the React tree so the first paint already has the active
// locale resolved.
//
// Refinement: tasks/refinements/moderator-ui/mod_app_skeleton.md +
//   tasks/refinements/shell-package/shell_substrate_extraction.md
//   (the i18n bootstrap + auth provider now come from @a-conversa/shell).
// ADRs:       0003 (React), 0024 (react-i18next + ICU), 0026 (root app).
//
// Locale resolution goes through `negotiateAuthenticatedLocale()` from
// `@a-conversa/i18n-catalogs` (see refinement
// `tasks/refinements/frontend-i18n/i18n_locale_negotiation.md`):
// the `aconversa_locale` cookie wins outright; otherwise the chain
// walks `navigator.languages` (canonicalizing onto the v1 supported
// set) and finally falls back to `en-US`.
//
// Provider order rationale (per shell_substrate_extraction.md Decisions):
// i18n outermost (auth error messages localize off `t`; the auth
// provider's children — including RequireAuth's loading-frame DOM —
// render localized strings); then auth (the WS connection's open-or-
// not gate is driven by `auth.status === 'authenticated'`); then
// BrowserRouter (route components consume both providers). The WS
// provider stays per-route (Operate + InviteParticipants) per the
// explicit rationale at `routes/Operate.tsx` lines 38–46.

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { negotiateAuthenticatedLocale } from '@a-conversa/i18n-catalogs';
import { AuthProvider, createI18nInstance, I18nProvider } from '@a-conversa/shell';

import './index.css';
import { App } from './App';
import { useWsStore } from './ws/wsStore';

async function bootstrap(): Promise<void> {
  const i18n = await createI18nInstance(negotiateAuthenticatedLocale());

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
      <I18nProvider i18n={i18n}>
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </I18nProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
