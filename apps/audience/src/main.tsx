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
// `requiredAuthLevel: 'public'` is the audience's policy: the host
// (`apps/root/src/surfaces/SurfaceHost.tsx`) reads this hint and skips
// the redirect-to-`/login` gate for anonymous visitors after
// `aud_no_auth_for_public` landed. The audience now consumes
// `useAuth()` inside its `<App>` and renders a `<LoginButton>` chrome
// for anonymous visitors so private-session viewers can sign in;
// per-session subscribe-rejection-aware messaging lives downstream in
// `aud_url_routing.aud_session_url`. `allowAnonymous` on the
// `<WsClientProvider>` is the audience's per-surface opt-in to the
// anonymous-WS-upgrade path per ADR 0029 + `aud_anonymous_ws_subscribe`:
// the provider's effect also opens the socket when
// `auth.status === 'unauthenticated'`. The server's
// `canSeeSessionAnonymously` predicate gates anonymous subscriptions
// at the data layer (public + not-ended only); anonymous writes are
// rejected with a wire `forbidden` envelope.

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
           * WS client. With `allowAnonymous` set, the provider's
           * effect opens the connection when
           * `auth.status === 'authenticated'` OR `'unauthenticated'`
           * — matching the server-side anonymous-WS-upgrade path
           * landed by `aud_anonymous_ws_subscribe` + ADR 0029. An
           * authenticated visitor's session cookie still attaches on
           * upgrade and the server resolves the real `AuthUser`; an
           * anonymous visitor's cookie-less upgrade succeeds and
           * `connection.user` stays `undefined` on the server. The
           * subscribe handler discriminates per-call (public-only
           * for anonymous via `canSeeSessionAnonymously`; the full
           * "public OR host OR participant" rule for authenticated).
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
            allowAnonymous
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
