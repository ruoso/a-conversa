// The per-row "see replay" affordance (D1): a thin localized link component that
// renders a react-router `<Link>` to the audience-replay route the
// `seeReplayHref` helper resolves — or nothing when that helper yields `null`
// (non-ended rows). Supplied through the shared `SessionList`'s
// `renderRowActions` slot by both discovery pages, sharing the actions cell with
// the role badge and the join-live link (D6). Because join-live (lobby/live) and
// see-replay (ended) are non-null for disjoint lifecycle states, a row shows
// exactly one of them.
//
// Refinement: tasks/refinements/session_discovery/sd_see_replay_link.md
// TaskJuggler: session_discovery.sd_frontend.sd_see_replay_link
// ADR:        0026 (root router dispatches /a to SurfaceHost), 0024 (i18n),
//             0040 (axe), 0043/0045 (audience replay surface + gating).
//
// The cross-surface jump uses `<Link>` (Constraint 6), mirroring `JoinLiveLink`:
// the root `BrowserRouter` resolves `/a/*` to `SurfaceHost`, which lazy-loads
// the audience bundle — no full-page reload. Replay-data visibility is the
// audience route's job (ADR 0045), so this link is role-agnostic and identical
// for every viewer of an ended row. The accessible name interpolates the row
// topic so each row's link carries a distinct, axe-friendly label.

import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import type { SessionListRow } from './SessionList';
import { seeReplayHref } from './seeReplayHref';

export interface SeeReplayLinkProps {
  /** The discovery row — its id/topic/lifecycle timestamps drive the routing. */
  readonly row: Pick<SessionListRow, 'id' | 'topic' | 'startedAt' | 'endedAt'>;
}

export function SeeReplayLink({ row }: SeeReplayLinkProps): ReactElement | null {
  const { t } = useTranslation();

  const href = seeReplayHref(row);
  if (href === null) {
    return null;
  }

  return (
    <Link
      to={href}
      data-testid="session-see-replay-link"
      aria-label={t('discovery.seeReplay.ariaLabel', { topic: row.topic })}
      className="inline-flex rounded-full bg-slate-700 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
    >
      {t('discovery.seeReplay.label')}
    </Link>
  );
}

export default SeeReplayLink;
