// Participant surface route tree (placeholder).
//
// Refinement: tasks/refinements/participant-ui/part_app_skeleton.md
//              tasks/refinements/participant-ui/part_auth_flow.md
//              tasks/refinements/participant-ui/part_landscape_layout.md
// ADRs:        0002 (no profile data — only `screenName` reaches the DOM),
//              0022 (no throwaway verifications — the identity testid +
//                    not-authenticated testid + four layout-region
//                    testids are the pinned seams),
//              0026 (host owns auth chrome; surface only reads the
//                    host-supplied `useAuth()`).
//
// The skeleton wires a single wildcard route that absorbs every URL
// under `/p/*` (the participant surface's basename, set in the root
// host's `<SurfaceHost surfaceId="participant" routerBasePath="/p" />`
// route at `apps/root/src/App.tsx`). The placeholder testid
// `route-participant-placeholder` is the stable selector anchor for
// the Vitest mount-boundary case + the Playwright placeholder spec.
//
// On top of the placeholder, `part_auth_flow` adds the participant's
// first useful read of the host-supplied auth state: `useAuth()` is
// consumed inside the surface, and the authenticated user's
// `screenName` is surfaced under the stable `participant-identity`
// testid. A defensive `participant-not-authenticated` panel covers the
// sub-paint window where the host's auth value flips after mount but
// before the `SurfaceHost` cleanup tears the surface down (see Decision
// §3 of the `part_auth_flow` refinement).
//
// `part_landscape_layout` wraps the placeholder body inside a
// landscape-grid scaffold (`<ParticipantLayout>`): a slim header on
// top + the placeholder body in the main region + an empty footer
// reserved for `part_status_indicator`'s chip. The identity row that
// `part_auth_flow` landed inside the body migrates up into the
// chrome header (`<ParticipantChrome>`) so it persists across every
// URL once downstream leaves replace the wildcard body.
//
// Future leaves replace this wildcard with the real participant route
// tree:
//
//   - `part_session_join.part_invite_acceptance` lands the
//     `/sessions/:id/invite?role=...` claim flow.
//   - `part_session_join.part_lobby_view` lands the pre-debate lobby.
//   - `part_graph_view` + `part_voting` land the operate view.
//
// When those routes ship, the placeholder testid disappears, but the
// chrome (`<ParticipantLayout>` with `<ParticipantChrome>` in the
// header + `<StatusIndicator />` in the footer) persists.

import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@a-conversa/shell';

import { ParticipantLayout } from './layout/ParticipantLayout';

function ParticipantChrome(): ReactElement {
  // Chrome content for the header row: left-aligned product label +
  // right-aligned identity affordance. Mirrors the `part_auth_flow`
  // `useAuth()` consumption shape exactly (status switch first, then
  // `.user !== undefined` belt-and-suspenders, then `.screenName`
  // access). Reuses the existing `participant.identity.signedInAs` ICU
  // key — no new key for the identity row.
  //
  // When unauthenticated, the chrome renders the product label only
  // (no identity row). The "not authenticated" body panel still lives
  // inside `<PlaceholderRouteBody>` (route content), not the chrome
  // — auth-state messaging belongs in the content region per
  // `part_auth_flow` Decision §3.
  const { t } = useTranslation();
  const auth = useAuth();
  return (
    <>
      <span className="text-sm font-semibold text-slate-800">
        {t('participant.chrome.productLabel')}
      </span>
      {auth.status === 'authenticated' && auth.user !== undefined ? (
        <span data-testid="participant-identity" className="text-sm text-slate-700">
          {t('participant.identity.signedInAs', { name: auth.user.screenName })}
        </span>
      ) : null}
    </>
  );
}

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
      footer={null}
    />
  );
}

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="*" element={<PlaceholderRoute />} />
    </Routes>
  );
}
