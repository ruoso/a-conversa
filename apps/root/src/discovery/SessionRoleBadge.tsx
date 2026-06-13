// The per-row role badge (D5) the My Sessions page renders through the shared
// `SessionList`'s `renderRowActions` slot. A small, non-interactive
// presentational element mapping the endpoint's role annotation to a localized,
// accessibly-labelled badge.
//
// Refinement: tasks/refinements/session_discovery/sd_my_sessions_page.md
// TaskJuggler: session_discovery.sd_frontend.sd_my_sessions_page
// ADR:        0024 (i18n), 0040 (axe).
//
// `debater-A` and `debater-B` collapse to a single "debater" label (D5): the A/B
// slot distinction is not meaningful to a user browsing their own sessions — it
// matters only to the live surface. Kept separate from the route so the
// role → label mapping is unit-testable in isolation.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { MySessionRole } from './mySessionsFetcher';

/** The three localized badge buckets. Both debater slots collapse to `debater`. */
export type RoleBadgeKey = 'host' | 'moderator' | 'debater';

/** Collapse the endpoint role annotation into the displayed badge bucket. */
export function roleBadgeKey(role: MySessionRole): RoleBadgeKey {
  if (role === 'host') {
    return 'host';
  }
  if (role === 'moderator') {
    return 'moderator';
  }
  return 'debater';
}

export interface SessionRoleBadgeProps {
  /**
   * The caller's role for the row. `undefined` when the correlation has not
   * resolved for this id (renders nothing rather than an empty badge).
   */
  readonly role?: MySessionRole | undefined;
}

export function SessionRoleBadge({ role }: SessionRoleBadgeProps): ReactElement | null {
  const { t } = useTranslation();

  if (role === undefined) {
    return null;
  }

  const key = roleBadgeKey(role);
  const label = t(`discovery.mySessions.role.${key}`);

  return (
    <span
      data-testid="session-role-badge"
      data-role={key}
      aria-label={t('discovery.mySessions.role.ariaLabel', { role: label })}
      className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
    >
      {label}
    </span>
  );
}

export default SessionRoleBadge;
