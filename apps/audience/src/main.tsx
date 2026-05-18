// Audience surface entry point.
//
// Refinement: tasks/refinements/audience/aud_app_skeleton.md
// ADRs:        0026 (micro-frontend pivot — `mount(props): UnmountFn` is
//                    the host/surface contract; the surface owns its
//                    own React root + `<BrowserRouter basename={...}>`),
//              0003 (React),
//              0024 (react-i18next + ICU — the `i18n` instance is
//                    host-supplied via `MountProps.i18n` and bridged
//                    into shell context with `<I18nProvider>`).
//
// Mirrors `apps/participant/src/main.tsx` (without the
// `<WsClientProvider>` mount and the `window.__aConversaWsStore`
// exposure — neither belongs in this skeleton; the read-only WS
// subscription wiring lands later under `aud_ws_client`, and the
// Zustand store under `aud_state_management`).
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
  type I18nInstance,
  type MountFn,
  type SurfaceModule,
} from '@a-conversa/shell';

import './index.css';
import { App } from './App';

export const mount: MountFn = (props) => {
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

const audienceSurface: SurfaceModule = {
  mount,
  meta: {
    displayName: 'Audience',
    requiredAuthLevel: 'public',
  },
};

export default audienceSurface;
