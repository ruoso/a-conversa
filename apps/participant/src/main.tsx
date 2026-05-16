// Participant surface entry point.
//
// Refinement: tasks/refinements/participant-ui/part_app_skeleton.md
// ADRs:        0026 (micro-frontend pivot — `mount(props): UnmountFn` is
//                    the host/surface contract; the surface owns its
//                    own React root + `<BrowserRouter basename={...}>`),
//              0003 (React),
//              0024 (react-i18next + ICU — the `i18n` instance is
//                    host-supplied via `MountProps.i18n` and bridged
//                    into shell context with `<I18nProvider>`).
//
// Mirrors `apps/moderator/src/main.tsx` save for: (a) the surface name
// in the `SurfaceModule` meta, and (b) the absence of the WS-store
// window-exposure trick — the participant skeleton has no Zustand store
// yet (lands with `part_state_management`) and the placeholder spec at
// `tests/e2e/participant-skeleton-smoke.spec.ts` does not seed WS
// events.

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

const participantSurface: SurfaceModule = {
  mount,
  meta: {
    displayName: 'Participant',
    requiredAuthLevel: 'authenticated',
  },
};

export default participantSurface;
