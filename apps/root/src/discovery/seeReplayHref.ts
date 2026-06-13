// The load-bearing routing logic (Constraint 1, D1/D2) for the per-row
// "see replay" affordance: a pure function mapping a discovery row to the
// cross-surface audience-replay href — or `null` when no replay affordance
// applies. Kept free of React so the lifecycle matrix is unit-testable
// exhaustively, and free of `role`: replay visibility is enforced at the
// audience route / data layer by session privacy (ADR 0045, D3), not by the
// caller's role, so the helper takes only the row.
//
// Refinement: tasks/refinements/session_discovery/sd_see_replay_link.md
// TaskJuggler: session_discovery.sd_frontend.sd_see_replay_link
// ADR:        0026 (root router dispatches /a to SurfaceHost),
//             0043/0045 (audience replay surface + visibility gating).
//
// Status is recomputed from `startedAt`/`endedAt` via the shared
// `deriveLifecycleStatus` (D2) rather than threaded in, keeping the helper a
// self-contained function over the wire shape already on the row. The
// affordance is shown when, and only when, the row is **ended** — disjoint from
// join-live (lobby/live), so the shared actions cell never offers two competing
// "enter the session" links:
//
//   lifecycle status | href
//   lobby            | — (null; no log to replay)
//   live             | — (null; join-live already lands the live feed)
//   ended            | /a/replay/:id

import { deriveLifecycleStatus, type SessionListRow } from './SessionList';

/** The row fields the routing decision reads — id plus the lifecycle timestamps. */
export type SeeReplayRow = Pick<SessionListRow, 'id' | 'startedAt' | 'endedAt'>;

/**
 * Resolve the audience-replay destination for `row`, or `null` when the row is
 * not ended (lobby/live rows have no see-replay affordance — D2). Locale is
 * unprefixed (D4); the audience surface negotiates its own locale.
 */
export function seeReplayHref(row: SeeReplayRow): string | null {
  if (deriveLifecycleStatus(row) !== 'ended') {
    return null;
  }

  return `/a/replay/${row.id}`;
}
