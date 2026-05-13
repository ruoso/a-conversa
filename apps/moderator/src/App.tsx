// Moderator app shell — wires the React Router routes defined in
// `tasks/refinements/moderator-ui/mod_app_skeleton.md`:
//
//   /login                       — Authelia redirect target
//   /sessions/:id/lobby          — pre-debate lobby
//   /sessions/:id/operate        — three-pane operator console
//
// Unmatched paths redirect to `/login` so an unauthenticated visitor
// always lands on the auth entry point (the real auth check + redirect
// arrives with `mod_auth_flow`; for now `/login` simply renders).

import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { LobbyRoute } from './routes/Lobby';
import { LoginRoute } from './routes/Login';
import { OperateRoute } from './routes/Operate';

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/sessions/:id/lobby" element={<LobbyRoute />} />
      <Route path="/sessions/:id/operate" element={<OperateRoute />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
