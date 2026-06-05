// Test-mode surface route tree.
//
// Refinement: tasks/refinements/replay_test/test_mode_app.md
// ADRs:        0022 (no throwaway verifications — the
//                    `route-test-mode-placeholder` testid is the pinned
//                    seam exercised by both the Vitest mount probe and
//                    the Playwright presence-smoke),
//              0026 (host owns auth chrome; the surface only reads the
//                    host-supplied i18n through `useTranslation()`).
//
// The `/sessions/:sessionId` route (`test_mode_load_session`) loads and
// displays a saved session's complete persisted event log. The root `/`
// (and any other URL inside `/t/*`) keeps rendering the placeholder until
// the remaining downstream `test_mode_*` leaves — the synthetic-session
// builder, the timeline scrubber driving a projected state into a graph
// viewport, and the inspectors — land and supersede it in place.

import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { SessionLogRoute } from './session-log/SessionLogRoute';

function PlaceholderRoute(): ReactElement {
  const { t } = useTranslation();
  return (
    <main data-testid="route-test-mode-placeholder" className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{t('testMode.placeholder.title')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('testMode.placeholder.body')}</p>
    </main>
  );
}

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/sessions/:sessionId" element={<SessionLogRoute />} />
      <Route path="*" element={<PlaceholderRoute />} />
    </Routes>
  );
}
