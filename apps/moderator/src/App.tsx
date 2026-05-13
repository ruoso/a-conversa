// Moderator app shell — wires the React Router routes.
//
// Routes:
//
//   /login                       — Authelia redirect target + welcome
//                                  after auth (owned by `mod_auth_flow`).
//   /screen-name                 — first-login screen-name capture
//                                  (owned by `mod_auth_flow`; UX polish
//                                  lands in `mod_screen_name_setup`).
//   /sessions/:id/lobby          — pre-debate lobby.
//   /sessions/:id/operate        — three-pane operator console.
//
// Unmatched paths redirect to `/login` so an unauthenticated visitor
// always lands on the auth entry point. The route-level auth gate (a
// redirect from protected routes back to `/login` when unauthed) lands
// with `mod_state_management` once the auth state is store-driven.

import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { LobbyRoute } from './routes/Lobby';
import { LoginRoute } from './routes/Login';
import { OperateRoute } from './routes/Operate';
import { ScreenNameRoute } from './routes/ScreenName';

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/screen-name" element={<ScreenNameRoute />} />
      <Route path="/sessions/:id/lobby" element={<LobbyRoute />} />
      <Route path="/sessions/:id/operate" element={<OperateRoute />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
