// The anonymous Public Sessions page (D2): a public, signed-out-reachable route
// that mounts the shared `SessionList` fed by the public-endpoint fetcher. It
// lists already-started public sessions (paginated, topic-searchable,
// date-filterable) with no auth gate.
//
// Refinement: tasks/refinements/session_discovery/sd_public_sessions_page.md
// TaskJuggler: session_discovery.sd_frontend.sd_public_sessions_page
// ADR:        0026 (micro-frontend root app), 0024 (i18n),
//             0029 (anonymous public-session access), 0040 (axe).
//
// The page is pure wiring: it owns only its chrome (heading + intro) and the
// two `SessionList` props that distinguish the public list. Lobby-secrecy is
// preserved by construction — the endpoint gates on
// `started_at IS NOT NULL`, and this page adds no client-side fetch of its own
// (Constraint 2). Per-row "join live" / "see replay" affordances are out of
// scope here (D4): the list mounts WITHOUT `renderRowActions`; the dedicated
// link tasks (`sd_join_live_link`, `sd_see_replay_link`) wire that slot in
// later. `lobbyRowsPossible={false}` (D5) suppresses the date-filter
// lobby-exclusion note, which is meaningless for a started-only list.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { SessionList } from '../discovery/SessionList';
import { fetchPublicSessions } from '../discovery/publicSessionsFetcher';

/** Stable id linking the `<main>` landmark to its heading for `aria-labelledby`. */
const TITLE_ID = 'public-sessions-title';

export function PublicSessionsRoute(): ReactElement {
  const { t } = useTranslation();

  return (
    <main
      data-testid="route-public-sessions"
      aria-labelledby={TITLE_ID}
      className="mx-auto max-w-5xl p-6"
    >
      <h1 id={TITLE_ID} data-testid="route-title" className="text-2xl font-semibold text-slate-900">
        {t('discovery.publicSessions.title')}
      </h1>
      <p className="mt-2 text-slate-600">{t('discovery.publicSessions.subtitle')}</p>
      <div className="mt-6">
        {/*
          `fetchPublicSessions` is a module-level constant, so its identity is
          stable across renders — the component's `fetchPage` referential-
          stability contract holds without a `useCallback` wrapper.
        */}
        <SessionList fetchPage={fetchPublicSessions} lobbyRowsPossible={false} />
      </div>
    </main>
  );
}

export default PublicSessionsRoute;
