// The per-row "join live" affordance (D1): a thin localized link component that
// renders a react-router `<Link>` to the surface the `joinLiveHref` matrix
// resolves — or nothing when that matrix yields `null`. Supplied through the
// shared `SessionList`'s `renderRowActions` slot by both discovery pages, sharing
// the actions cell with the role badge (and, later, the see-replay link — D4).
//
// Refinement: tasks/refinements/session_discovery/sd_join_live_link.md
// TaskJuggler: session_discovery.sd_frontend.sd_join_live_link
// ADR:        0026 (root router dispatches /m,/p,/a to SurfaceHost), 0024 (i18n),
//             0040 (axe).
//
// The cross-surface jump uses `<Link>` (D6), mirroring `CallToActionSection`: the
// root `BrowserRouter` resolves the surface route to `SurfaceHost`, which
// lazy-loads the bundle and runs the auth gate — an unauthenticated click on a
// `/m` or `/p` link is correctly bounced through `/login`. Auth enforcement is
// SurfaceHost's job, not this component's. The accessible name interpolates the
// row topic so each row's link carries a distinct, axe-friendly label.

import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import type { SessionListRow } from './SessionList';
import { joinLiveHref } from './joinLiveHref';
import type { MySessionRole } from './mySessionsFetcher';

export interface JoinLiveLinkProps {
  /** The discovery row — its id/topic/lifecycle timestamps drive the routing. */
  readonly row: Pick<SessionListRow, 'id' | 'topic' | 'startedAt' | 'endedAt'>;
  /**
   * The caller's role for the row, or `undefined` for the anonymous public list
   * (routes to the audience surface for started rows).
   */
  readonly role?: MySessionRole | undefined;
}

export function JoinLiveLink({ row, role }: JoinLiveLinkProps): ReactElement | null {
  const { t } = useTranslation();

  const href = joinLiveHref(row, role);
  if (href === null) {
    return null;
  }

  return (
    <Link
      to={href}
      data-testid="session-join-live-link"
      aria-label={t('discovery.joinLive.ariaLabel', { topic: row.topic })}
      className="inline-flex rounded-full bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800"
    >
      {t('discovery.joinLive.label')}
    </Link>
  );
}

export default JoinLiveLink;
