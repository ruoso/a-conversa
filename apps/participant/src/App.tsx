// Participant surface route tree.
//
// Refinement: tasks/refinements/participant-ui/part_app_skeleton.md
//              tasks/refinements/participant-ui/part_auth_flow.md
//              tasks/refinements/participant-ui/part_landscape_layout.md
//              tasks/refinements/participant-ui/part_invite_acceptance.md
//              tasks/refinements/participant-ui/part_lobby_view.md
// ADRs:        0002 (no profile data — only `screenName` reaches the DOM),
//              0022 (no throwaway verifications — the identity testid +
//                    not-authenticated testid + four layout-region
//                    testids + the route-invite-acceptance / route-lobby
//                    testids are the pinned seams),
//              0026 (host owns auth chrome; surface only reads the
//                    host-supplied `useAuth()`).
//
// `part_invite_acceptance` extends the wildcard-only route tree with
// two new entries above the catch-all:
//
//   - `<Route path="/sessions/:id/invite" element={<InviteAcceptanceRoute />} />`
//     — the claim route that turns the moderator's invite URL into a
//     `session_participants` row + a `participant-joined` event.
//   - `<Route path="/sessions/:id/lobby" element={<LobbyRoute />} />`
//     — the participant's pre-debate lobby. The post-claim
//     navigation in `<InviteAcceptanceRoute>` lands here; the route
//     reads the path's `:id`, prefetches `GET /api/sessions/:id` +
//     `GET /api/sessions/:id/participants`, and subscribes to the
//     per-session WS for live `participant-joined` /
//     `participant-left` overlays. New keys under the
//     `participant.lobby.*` namespace.
//
// The wildcard `<Route path="*">` stays as the catch-all so any other
// URL under `/p/*` still renders the existing placeholder chrome +
// body. The placeholder route's chrome is composed from the extracted
// `<ParticipantChrome>` (Decision §9 of part_invite_acceptance) so
// every route in the tree consumes the same header markup.
//
// Future leaves replace the wildcard with the real participant route
// tree:
//
//   - `part_graph_view` + `part_voting` land the operate view.

import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@a-conversa/shell';

import { ParticipantLayout } from './layout/ParticipantLayout';
import { ParticipantChrome } from './layout/ParticipantChrome';
import { ParticipantStatusIndicator } from './layout/ParticipantStatusIndicator';
import { InviteAcceptanceRoute } from './routes/InviteAcceptanceRoute';
import { LobbyRoute } from './routes/LobbyRoute';

function PlaceholderRouteBody(): ReactElement {
  // Existing body from `part_auth_flow`: the placeholder title, the
  // body caption, and the not-authenticated guard branch. The identity
  // row that `part_auth_flow` landed inside this body has migrated up
  // into `<ParticipantChrome>` (Decision §2 of `part_landscape_layout`);
  // the body keeps the title + body caption + the not-authenticated
  // guard branch only.
  //
  // The outer wrapper is `<div>` (not `<main>`): the layout's
  // `<section data-testid="participant-main">` is the page's main
  // content region, and only one `<main>` per page is semantically
  // correct. The `route-participant-placeholder` testid stays on the
  // wrapper so the predecessor's Playwright + Vitest pins keep
  // matching (`getByTestId` is element-tag-agnostic).
  const { t } = useTranslation();
  const auth = useAuth();

  // Mid-mount defensive guard. `SurfaceHost`'s effect-level gate is the
  // primary defense (it tears the surface down and bounces to `/login`
  // on a status change), but between the auth value flipping and the
  // host's cleanup callback firing there is a sub-paint interval where
  // the surface re-renders with the stale provider value. Returning an
  // explicit not-authenticated surface (rather than rendering with
  // `auth.user === undefined` and crashing on `.screenName`) keeps the
  // window safe. The `auth.user === undefined` half of the check is
  // belt-and-suspenders against a malformed-provider edge.
  if (auth.status !== 'authenticated' || auth.user === undefined) {
    return (
      <div data-testid="route-participant-placeholder" className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold">{t('participant.placeholder.title')}</h1>
        <p data-testid="participant-not-authenticated" className="mt-2 text-sm text-slate-600">
          {t('participant.notAuthenticated.body')}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="route-participant-placeholder" className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{t('participant.placeholder.title')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('participant.placeholder.body')}</p>
    </div>
  );
}

function PlaceholderRoute(): ReactElement {
  return (
    <ParticipantLayout
      header={<ParticipantChrome />}
      main={<PlaceholderRouteBody />}
      footer={<ParticipantStatusIndicator />}
    />
  );
}

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/sessions/:id/invite" element={<InviteAcceptanceRoute />} />
      <Route path="/sessions/:id/lobby" element={<LobbyRoute />} />
      <Route path="*" element={<PlaceholderRoute />} />
    </Routes>
  );
}
