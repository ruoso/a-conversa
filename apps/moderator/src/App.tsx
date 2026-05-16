// Moderator app shell — wires the React Router routes.
//
// Routes:
//
//   /sessions/new                — create-session form (topic + privacy);
//                                  owned by `mod_create_session_form`. The
//                                  backend lives under `/api/*` (see
//                                  `apps/server/src/server.ts`), so the
//                                  SPA can safely own any non-`/api/*`
//                                  shape under `/sessions/*` without
//                                  colliding with a params validator.
//   /sessions/:id/invite         — post-create invite view; renders the
//                                  three role slots (moderator + two
//                                  debaters) with per-debater shareable
//                                  links. Owned by `mod_invite_participants`.
//                                  After `POST /api/sessions` returns 201,
//                                  the create-session form lands the
//                                  moderator here (not on `/operate`) so
//                                  the invite step is the visible next
//                                  thing.
//   /sessions/:id/lobby          — pre-debate lobby.
//   /sessions/:id/operate        — three-pane operator console.
//
// Unmatched paths redirect to `/sessions/new` inside the mounted region.
// The four protected routes are
// wrapped with `<RequireAuth>` (see `auth/RequireAuth.tsx`), which
// consumes `useAuth()` and redirects per the discriminated status:
// `'authenticated-only'` for every moderator-owned route. The root host
// owns `/login` and `/screen-name`; the gate redirects there with
// absolute paths so the basename-scoped router can hand control back to
// the public auth chrome.

import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { RequireAuth } from './auth/RequireAuth';
import { CreateSessionRoute } from './routes/CreateSession';
import { InviteParticipantsRoute } from './routes/InviteParticipants';
import { LobbyRoute } from './routes/Lobby';
import { OperateRoute } from './routes/Operate';

export function App(): ReactElement {
  return (
    <Routes>
      <Route
        path="/sessions/new"
        element={
          <RequireAuth mode="authenticated-only">
            <CreateSessionRoute />
          </RequireAuth>
        }
      />
      <Route
        path="/sessions/:id/invite"
        element={
          <RequireAuth mode="authenticated-only">
            <InviteParticipantsRoute />
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
      <Route path="*" element={<Navigate to="/sessions/new" replace />} />
    </Routes>
  );
}
