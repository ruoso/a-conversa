// The load-bearing routing logic (Constraint 1, D1/D2): a pure function mapping
// a discovery row plus the caller's role to the cross-surface "join live" href —
// or `null` when no join-live affordance applies. Kept free of React so the full
// (role × lifecycle-status) matrix can be unit-tested exhaustively.
//
// Refinement: tasks/refinements/session_discovery/sd_join_live_link.md
// TaskJuggler: session_discovery.sd_frontend.sd_join_live_link
// ADR:        0026 (micro-frontend root app dispatches /m,/p,/a by URL prefix).
//
// Status is recomputed from `startedAt`/`endedAt` via the shared
// `deriveLifecycleStatus` (D2) rather than threaded in, keeping the helper a
// self-contained function over the wire shape already on the row. Routing matrix:
//
//   role (from /mine)     | lobby                    | live                  | ended
//   host / moderator      | /m/sessions/:id/lobby    | /m/sessions/:id/operate | — (null)
//   debater-A / debater-B | /p/sessions/:id/lobby    | /p/sessions/:id       | — (null)
//   undefined (anon)      | — (null, unreachable¹)   | /a/sessions/:id       | — (null)
//
// ¹ The public list is started-only and My Sessions rows always carry a role, so
//   the undefined-role-on-lobby cell never occurs; the helper returns `null`
//   defensively. Ended rows are `sd_see_replay_link`'s territory, never ours.

import { deriveLifecycleStatus, type SessionListRow } from './SessionList';
import type { MySessionRole } from './mySessionsFetcher';

/** The row fields the routing decision reads — id plus the lifecycle timestamps. */
export type JoinLiveRow = Pick<SessionListRow, 'id' | 'startedAt' | 'endedAt'>;

/**
 * Resolve the join-live destination for `row` given the caller's `role`, or
 * `null` when the row has no join-live affordance (ended session, or the
 * defensive lobby/anonymous cell).
 */
export function joinLiveHref(row: JoinLiveRow, role: MySessionRole | undefined): string | null {
  const status = deriveLifecycleStatus(row);
  if (status === 'ended') {
    return null;
  }

  const { id } = row;

  if (role === 'host' || role === 'moderator') {
    return status === 'lobby' ? `/m/sessions/${id}/lobby` : `/m/sessions/${id}/operate`;
  }

  if (role === 'debater-A' || role === 'debater-B') {
    // The role already implies a held slot (D3) — route to the slot, not invite.
    return status === 'lobby' ? `/p/sessions/${id}/lobby` : `/p/sessions/${id}`;
  }

  // No role: anonymous/public caller. Only started (live) sessions get the
  // audience link; the lobby cell is unreachable and falls through to null.
  if (status === 'live') {
    return `/a/sessions/${id}`;
  }

  return null;
}
