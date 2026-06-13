// The authenticated My Sessions page (D2): a sign-in-gated route that mounts the
// shared `SessionList` fed by the credentialed my-sessions fetcher. It lists the
// caller's own sessions — host / moderator / debater, lobby + started + ended —
// paginated, topic-searchable, date-filterable, each row carrying a role badge.
//
// Refinement: tasks/refinements/session_discovery/sd_my_sessions_page.md
// TaskJuggler: session_discovery.sd_frontend.sd_my_sessions_page
// ADR:        0026 (micro-frontend root app), 0024 (i18n),
//             0017 (dev IdP / sign-in), 0040 (axe).
//
// The auth gate is INLINED here (D2), mirroring `SurfaceHost`: this is the first
// plain (non-surface) authenticated root route, so there is a single call site
// and extracting a `<RequireAuth>` wrapper is YAGNI until a second one appears.
// An unauthenticated visit remembers the deep link and bounces to `/login`; a
// `needs-screen-name` visit bounces to `/screen-name`; an in-flight `loading`
// status shows the shared checking state and never flashes the list.
//
// Role badge correlation (D3): `SessionListRow` carries no `role`, so the route
// holds a stable `roleById` ref, records each page's `id → role` pairing inside
// a `useCallback`-wrapped adapter (preserving `fetchPage`'s referential-
// stability contract), and renders `SessionRoleBadge` from `renderRowActions`.
// Roles are immutable per id, so accumulating across pages (set, never clear) is
// safe and sidesteps out-of-order-response races. `lobbyRowsPossible` is left at
// its default `true` (D6): My Sessions includes unstarted sessions, so the
// date-filter lobby-exclusion note is meaningful and must render.

import { useCallback, useRef, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@a-conversa/shell';

import { SessionList, type SessionListPage, type SessionListQuery } from '../discovery/SessionList';
import { fetchMySessions, type MySessionRole } from '../discovery/mySessionsFetcher';
import { SessionRoleBadge } from '../discovery/SessionRoleBadge';
import { JoinLiveLink } from '../discovery/JoinLiveLink';
import { SeeReplayLink } from '../discovery/SeeReplayLink';
import { rememberReturnTo } from '../surfaces/SurfaceHost';

/** Stable id linking the `<main>` landmark to its heading for `aria-labelledby`. */
const TITLE_ID = 'my-sessions-title';

export function MySessionsRoute(): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();
  const location = useLocation();

  // Stable across renders: roles are immutable per session id, so each fetched
  // page records into this map (set, never clear) and the badge reads from it.
  const roleById = useRef(new Map<string, MySessionRole>());

  // The `fetchPage` adapter (D3): credentialed fetch via `fetchMySessions`,
  // records the `id → role` correlation, returns the bare `{ rows, total }` the
  // component consumes. `useCallback` keeps its identity stable across renders,
  // honouring the component's `fetchPage` referential-stability contract.
  const fetchPage = useCallback(async (query: SessionListQuery): Promise<SessionListPage> => {
    const page = await fetchMySessions(query);
    for (const [id, role] of Object.entries(page.roles)) {
      roleById.current.set(id, role);
    }
    return { rows: page.rows, total: page.total };
  }, []);

  if (auth.status === 'loading') {
    return (
      <main data-testid="my-sessions-loading" className="mx-auto max-w-2xl p-6">
        <h1 data-testid="route-title" className="text-2xl font-semibold">
          {t('auth.login.title')}
        </h1>
        <p data-testid="auth-checking">{t('auth.login.checking')}</p>
      </main>
    );
  }

  if (auth.status === 'unauthenticated') {
    rememberReturnTo(location.pathname + location.search + location.hash);
    return <Navigate to="/login" replace />;
  }

  if (auth.status === 'needs-screen-name') {
    rememberReturnTo(location.pathname + location.search + location.hash);
    return <Navigate to="/screen-name" replace />;
  }

  return (
    // A full page of sessions (DEFAULT_PAGE_SIZE rows) is taller than the
    // viewport, so the list scrolls inside this landmark rather than the
    // document — `h-screen overflow-y-auto` bounds it and `data-allow-scroll`
    // marks the region as intentionally scrollable for the e2e no-scrollbars
    // guard (mirrors `LandingRoute` / the test-mode scrubber).
    <main
      data-testid="route-my-sessions"
      aria-labelledby={TITLE_ID}
      data-allow-scroll=""
      className="mx-auto h-screen max-w-5xl overflow-y-auto p-6"
    >
      <h1 id={TITLE_ID} data-testid="route-title" className="text-2xl font-semibold text-slate-900">
        {t('discovery.mySessions.title')}
      </h1>
      <p className="mt-2 text-slate-600">{t('discovery.mySessions.subtitle')}</p>
      <div className="mt-6">
        <SessionList
          fetchPage={fetchPage}
          renderRowActions={(row) => {
            // The role badge, the join-live link, and the see-replay link share
            // the one actions cell (D6); join-live (lobby/live) and see-replay
            // (ended) are non-null for disjoint lifecycle states, so a row shows
            // exactly one of them. All read the same accumulated role for this id.
            const role = roleById.current.get(row.id);
            return (
              <div className="flex items-center gap-2">
                <SessionRoleBadge role={role} />
                <JoinLiveLink row={row} role={role} />
                <SeeReplayLink row={row} />
              </div>
            );
          }}
        />
      </div>
    </main>
  );
}

export default MySessionsRoute;
