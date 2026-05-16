// Participant surface route tree (placeholder).
//
// Refinement: tasks/refinements/participant-ui/part_app_skeleton.md
//              tasks/refinements/participant-ui/part_auth_flow.md
// ADRs:        0002 (no profile data — only `screenName` reaches the DOM),
//              0022 (no throwaway verifications — the identity testid +
//                    not-authenticated testid are the pinned seams),
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
// consumed inside the placeholder body, and the authenticated user's
// `screenName` is surfaced under the stable `participant-identity`
// testid. A defensive `participant-not-authenticated` panel covers the
// sub-paint window where the host's auth value flips after mount but
// before the `SurfaceHost` cleanup tears the surface down (see Decision
// §3 of the `part_auth_flow` refinement).
//
// Future leaves replace this wildcard with the real participant route
// tree:
//
//   - `part_session_join.part_invite_acceptance` lands the
//     `/sessions/:id/invite?role=...` claim flow.
//   - `part_session_join.part_lobby_view` lands the pre-debate lobby.
//   - `part_landscape_layout` lands the operate view.
//
// When those routes ship, the placeholder testid disappears.

import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@a-conversa/shell';

function PlaceholderRoute(): ReactElement {
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
      <main data-testid="route-participant-placeholder" className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold">{t('participant.placeholder.title')}</h1>
        <p data-testid="participant-not-authenticated" className="mt-2 text-sm text-slate-600">
          {t('participant.notAuthenticated.body')}
        </p>
      </main>
    );
  }

  return (
    <main data-testid="route-participant-placeholder" className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{t('participant.placeholder.title')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('participant.placeholder.body')}</p>
      <p data-testid="participant-identity" className="mt-4 text-sm text-slate-700">
        {t('participant.identity.signedInAs', { name: auth.user.screenName })}
      </p>
    </main>
  );
}

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="*" element={<PlaceholderRoute />} />
    </Routes>
  );
}
