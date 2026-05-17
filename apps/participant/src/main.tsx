// Participant surface entry point.
//
// Refinement: tasks/refinements/participant-ui/part_app_skeleton.md
//              tasks/refinements/participant-ui/part_ws_client.md
// ADRs:        0026 (micro-frontend pivot — `mount(props): UnmountFn` is
//                    the host/surface contract; the surface owns its
//                    own React root + `<BrowserRouter basename={...}>`),
//              0003 (React),
//              0024 (react-i18next + ICU — the `i18n` instance is
//                    host-supplied via `MountProps.i18n` and bridged
//                    into shell context with `<I18nProvider>`).
//
// Mirrors `apps/moderator/src/main.tsx` save for the surface name in
// the `SurfaceModule` meta. `part_ws_client` brings the moderator-side
// `<WsClientProvider>` mount + the `window.__aConversaWsStore`
// exposure to the participant surface so the participant's
// `useWsStore` becomes a live, server-fed slice (Decision §1 of that
// refinement — single provider at the surface boundary, not per-route).

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import {
  AuthValueProvider,
  I18nProvider,
  WsClientProvider,
  type I18nInstance,
  type MountFn,
  type SurfaceModule,
} from '@a-conversa/shell';

import './index.css';
import { App } from './App';
import { useWsStore } from './ws/wsStore';

export const mount: MountFn = (props) => {
  // Expose the WS store on `window` so the Playwright e2e specs in
  // `tests/e2e/` can drive store state (e.g. `setConnectionStatus`)
  // into the participant chip without standing up a server-side
  // wire-tear path. Mirrors the moderator's
  // `apps/moderator/src/main.tsx:35-55` pattern — same security
  // argument (the store reference is already reachable through the
  // module graph; window-exposure is plumbing convenience, not new
  // capability) and the same unconditional assignment (the compose
  // stack's production build mode tree-shakes DEV-gated branches,
  // so a `import.meta.env.DEV` guard would silently strip the seed
  // entry point in CI).
  //
  // Refinement: tasks/refinements/participant-ui/part_ws_client.md
  (window as unknown as { __aConversaWsStore?: typeof useWsStore }).__aConversaWsStore = useWsStore;

  const root = ReactDOM.createRoot(props.container);
  root.render(
    <React.StrictMode>
      <I18nProvider i18n={props.i18n as I18nInstance}>
        <AuthValueProvider value={props.auth}>
          {/*
           * `<WsClientProvider>` mounts the surface's single WS
           * client. The provider's internal effect opens the
           * connection iff `auth.status === 'authenticated'` (the
           * surface's mount contract guarantees this at first
           * hand-off via `SurfaceModule.meta.requiredAuthLevel:
           * 'authenticated'`).
           *
           * The participant's `useWsStore` is passed as both
           * `clientOptions.store` (for envelope dispatch) and
           * `store` (for the on-unmount `reset()`). The two slots
           * serve different purposes inside the provider — see
           * Decision §2 of the part_ws_client refinement for the
           * double-pass rationale.
           *
           * Mounted at the surface boundary (Decision §1) so every
           * participant route inherits the live WS without per-route
           * provider boilerplate; the participant has no
           * non-WS-driving routes today.
           */}
          <WsClientProvider
            auth={{ status: props.auth.status }}
            clientOptions={{ store: useWsStore }}
            store={useWsStore}
          >
            <BrowserRouter basename={props.routerBasePath}>
              <App />
            </BrowserRouter>
          </WsClientProvider>
        </AuthValueProvider>
      </I18nProvider>
    </React.StrictMode>,
  );

  return () => {
    root.unmount();
  };
};

const participantSurface: SurfaceModule = {
  mount,
  meta: {
    displayName: 'Participant',
    requiredAuthLevel: 'authenticated',
  },
};

export default participantSurface;
