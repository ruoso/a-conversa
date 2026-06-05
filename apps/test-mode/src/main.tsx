// Test-mode surface entry point.
//
// Refinement: tasks/refinements/replay_test/test_mode_app.md
// ADRs:        0026 (micro-frontend pivot — `mount(props): UnmountFn` is
//                    the host/surface contract; the surface owns its
//                    own React root + `<BrowserRouter basename={...}>`),
//              0003 (React),
//              0024 (react-i18next + ICU — the `i18n` instance is
//                    host-supplied via `MountProps.i18n` and bridged
//                    into shell context with `<I18nProvider>`).
//
// Mirrors `apps/moderator/src/main.tsx` save for the surface name in
// the `SurfaceModule` meta. Test-mode is an authenticated operator tool
// (`meta.requiredAuthLevel: 'authenticated'`); the host's `SurfaceHost`
// gates unauthenticated visitors to `/login` before `mount()` ever
// runs. Unlike the moderator/participant surfaces, the skeleton mounts
// no `<WsClientProvider>` and exposes no WS store — the scrubber and
// the projected-state viewport that consume the replay endpoints land
// in the downstream `test_mode_*` leaves.
//
// Locale comes from the host-supplied `i18n` instance (cookie /
// `navigator.languages` negotiated upstream by the root host). The
// surface does NOT parse a `/{locale}/…` URL segment the way the
// audience surface does — Decision §3 of the refinement.

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

const testModeSurface: SurfaceModule = {
  mount,
  meta: {
    displayName: 'Test mode',
    requiredAuthLevel: 'authenticated',
  },
};

export default testModeSurface;
