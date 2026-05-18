// Audience surface entry point.
//
// Refinement: tasks/refinements/audience/aud_app_skeleton.md
//              tasks/refinements/audience/aud_ws_client.md
// ADRs:        0026 (micro-frontend pivot — `mount(props): UnmountFn` is
//                    the host/surface contract; the surface owns its
//                    own React root + `<BrowserRouter basename={...}>`),
//              0003 (React),
//              0024 (react-i18next + ICU — the `i18n` instance is
//                    host-supplied via `MountProps.i18n` and bridged
//                    into shell context with `<I18nProvider>`).
//
// Mirrors `apps/participant/src/main.tsx`. `aud_ws_client` lands the
// `<WsClientProvider>` mount at the surface boundary so the audience
// gets a single, read-only WS connection feeding the
// `audienceWsStore` singleton — every audience route that grows under
// this surface inherits the live connection without per-route provider
// boilerplate (Decision §3). The audience deliberately does NOT mirror
// the participant's `window.__aConversaWsStore` exposure (no Playwright
// spec consumes it at this tier — Decision §9; the audience-WS
// Playwright assertion is deferred to `aud_graph_rendering.aud_cytoscape_init`
// per Decision §10).
//
// `requiredAuthLevel: 'public'` declares the audience's eventual policy
// (most audience views render for public-session viewers without auth),
// even though `SurfaceHost` does not yet read the meta hint. Encoding
// the intent at the contract layer makes the `aud_no_auth_for_public`
// widening a one-place change (host reads `meta.requiredAuthLevel`)
// instead of a contract change. See Decision §5 of the refinement.

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
import { audienceWsStore } from './ws/wsStore';

export const mount: MountFn = (props) => {
  const root = ReactDOM.createRoot(props.container);
  root.render(
    <React.StrictMode>
      <I18nProvider i18n={props.i18n as I18nInstance}>
        <AuthValueProvider value={props.auth}>
          {/*
           * `<WsClientProvider>` mounts the audience surface's single
           * WS client. The provider's internal effect opens the
           * connection iff `auth.status === 'authenticated'` — today's
           * `SurfaceHost` still hard-gates on authenticated at first
           * hand-off; `aud_no_auth_for_public` will widen that path
           * for public-session anonymous viewers, at which point this
           * mount's auth-prop semantics need to be reconsidered (see
           * Decision §5 of the refinement).
           *
           * `audienceWsStore` is passed in both `clientOptions.store`
           * (for inbound envelope dispatch by the auto-constructed
           * client) and `store` (for the on-unmount `reset()`) per the
           * double-pass pattern Decision §2 inherits from
           * `part_ws_client`. The audience uses the shell's
           * `createDefaultWsStore()` factory output verbatim — no
           * per-surface extension today.
           */}
          <WsClientProvider
            auth={{ status: props.auth.status }}
            clientOptions={{ store: audienceWsStore }}
            store={audienceWsStore}
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

const audienceSurface: SurfaceModule = {
  mount,
  meta: {
    displayName: 'Audience',
    requiredAuthLevel: 'public',
  },
};

export default audienceSurface;
