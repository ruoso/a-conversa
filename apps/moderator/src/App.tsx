// Moderator app shell — wires the React Router routes.
//
// Routes:
//
//   /login                       — Authelia redirect target + welcome
//                                  after auth (owned by `mod_auth_flow`).
//   /screen-name                 — first-login screen-name capture
//                                  (owned by `mod_auth_flow`; UX polish
//                                  lands in `mod_screen_name_setup`).
//   /sessions/new/setup          — create-session form (topic + privacy);
//                                  owned by `mod_create_session_form`. The
//                                  3-segment path side-steps the Fastify
//                                  `GET /sessions/:id` route which would
//                                  otherwise match `/sessions/new` and
//                                  return 400 validation-failed before the
//                                  static-frontends SPA fallback fires.
//   /sessions/:id/lobby          — pre-debate lobby.
//   /sessions/:id/operate        — three-pane operator console.
//
// Unmatched paths redirect to `/login` so an unauthenticated visitor
// always lands on the auth entry point. The four protected routes are
// wrapped with `<RequireAuth>` (see `auth/RequireAuth.tsx`), which
// consumes `useAuth()` and redirects per the discriminated status:
// `'needs-screen-name-only'` for `/screen-name` and `'authenticated-only'`
// for `/sessions/new` plus the two `/sessions/:id/...` routes. `/login`
// stays unwrapped — it runs its own four-state switch in-component and
// is the universal redirect sink.

import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { RequireAuth } from './auth/RequireAuth';
import { CreateSessionRoute } from './routes/CreateSession';
import { LobbyRoute } from './routes/Lobby';
import { LoginRoute } from './routes/Login';
import { OperateRoute } from './routes/Operate';
import { ScreenNameRoute } from './routes/ScreenName';

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        path="/screen-name"
        element={
          <RequireAuth mode="needs-screen-name-only">
            <ScreenNameRoute />
          </RequireAuth>
        }
      />
      <Route
        path="/sessions/new/setup"
        element={
          <RequireAuth mode="authenticated-only">
            <CreateSessionRoute />
          </RequireAuth>
        }
      />
      <Route
        path="/sessions/:id/lobby"
        element={
          <RequireAuth mode="authenticated-only">
            <LobbyRoute />
          </RequireAuth>
        }
      />
      <Route
        path="/sessions/:id/operate"
        element={
          <RequireAuth mode="authenticated-only">
            <OperateRoute />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
