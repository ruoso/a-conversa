// Participant surface route tree (placeholder).
//
// Refinement: tasks/refinements/participant-ui/part_app_skeleton.md
//
// The skeleton wires a single wildcard route that absorbs every URL
// under `/p/*` (the participant surface's basename, set in the root
// host's `<SurfaceHost surfaceId="participant" routerBasePath="/p" />`
// route at `apps/root/src/App.tsx`). The placeholder testid
// `route-participant-placeholder` is the stable selector anchor for
// the Vitest mount-boundary case + the Playwright placeholder spec.
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

function PlaceholderRoute(): ReactElement {
  const { t } = useTranslation();
  return (
    <main data-testid="route-participant-placeholder" className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{t('participant.placeholder.title')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('participant.placeholder.body')}</p>
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
