// Moderator surface entry point.
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
// The root host owns the top-level auth/i18n providers and passes their
// live values into `mount(props)`. Because the moderator mounts in a
// separate React root, it bridges those values back into shell context
// locally with `<AuthValueProvider>` and `<I18nProvider>`.

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import {
  AuthValueProvider,
  I18nProvider,
  type I18nInstance,
  type MountFn,
  type SurfaceModule,
} from '@a-conversa/shell';

import './index.css';
import { App } from './App';
import { useWsStore } from './ws/wsStore';

export const mount: MountFn = (props) => {
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

  const root = ReactDOM.createRoot(props.container);
  root.render(
    <React.StrictMode>
      <I18nProvider i18n={props.i18n as I18nInstance}>
        <AuthValueProvider value={props.auth}>
          <BrowserRouter basename={props.routerBasePath}>
            <App />
          </BrowserRouter>
        </AuthValueProvider>
      </I18nProvider>
    </React.StrictMode>,
  );

  return () => {
    root.unmount();
  };
};

const moderatorSurface: SurfaceModule = {
  mount,
  meta: {
    displayName: 'Moderator',
    requiredAuthLevel: 'authenticated',
  },
};

export default moderatorSurface;
