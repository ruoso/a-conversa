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
// The single wildcard route absorbs every URL inside `/t/*` (e.g.
// `/t/sessions/:id`, `/t/foo`). The real test-mode routes — the
// session loader, the synthetic-session builder, the timeline scrubber
// driving a projected state into a graph viewport, and the inspectors —
// land in the downstream `test_mode_*` leaves, at which point this
// wildcard is replaced with the real route table and the placeholder
// testid disappears.

import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

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
      <Route path="*" element={<PlaceholderRoute />} />
    </Routes>
  );
}
