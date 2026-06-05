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
// is the synthetic-session gallery (`test_mode_synthetic_session`,
// Decision §5) — the first natural landing for a test-mode operator
// ("what do you want to look at?"): it lists the generator's scenarios
// and, on generate, hands off to the load route above. The gallery
// supersedes the former root placeholder in place; the timeline scrubber
// and inspectors land in the remaining downstream `test_mode_*` leaves.

import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';

import { SessionLogRoute } from './session-log/SessionLogRoute';
import { SyntheticGallery } from './synthetic/SyntheticGallery';

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/sessions/:sessionId" element={<SessionLogRoute />} />
      <Route path="*" element={<SyntheticGallery />} />
    </Routes>
  );
}
