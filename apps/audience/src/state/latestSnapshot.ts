// `latestSnapshot.ts` — audience-side per-event-log projector returning
// the most-recent `snapshot-created` envelope as a flat
// `{ snapshotId, label, logPosition }` record (or `null` when the log
// carries no snapshot).
//
// Refinement: tasks/refinements/audience/aud_chapter_marker_render.md
//   (Decision §3 — derive from the event stream, not the serialized
//   projection or the replay HTTP history query; the live snapshot
//   arrives as an `event-applied` broadcast, so a pure projector over
//   the events slice is the consistent, already-reactive path.
//   Constraint §1 — latest-only: take the LAST `snapshot-created` by
//   stream order, not the full history the replay scrubber owns.)
//
// Mirrors the shape of `sessionRoster.ts`'s `sessionRosterFrom`: a pure
// single-pass walk over `readonly Event[]` consumed by a `useMemo`-
// wrapped selector hook (`useAudienceLatestSnapshot`).
//
// ADRs:
//   - 0021 (event-envelope discriminated union — payload-shape narrowing
//           follows `event.kind === 'snapshot-created'`).
//   - 0022 (no throwaway verifications — every behaviour below is
//           pinned by `latestSnapshot.test.ts`).

import type { Event } from '@a-conversa/shared-types';

/**
 * Flat projection of a `snapshot-created` envelope's payload. The
 * snake_case wire fields (`snapshot_id`, `log_position`) are mapped to
 * camelCase to match the server-side `SnapshotRecord` projection record
 * shape (`apps/server/src/projection/types.ts`); the moderator-typed
 * `label` is passed through verbatim (it is free text and is NOT
 * translated — only surrounding chrome is).
 */
export interface LatestSnapshot {
  readonly snapshotId: string;
  readonly label: string;
  readonly logPosition: number;
}

/**
 * Walk the per-session event log once, keeping the LAST
 * `snapshot-created` envelope by stream order. Returns `null` when the
 * walk surfaces no snapshot — `null` is the stable no-snapshot sentinel
 * (a primitive is always referentially equal, so a no-snapshot
 * projection does not churn the `useMemo` in `useAudienceLatestSnapshot`,
 * consistent with the `EMPTY_AUDIENCE_ROSTER` / `EMPTY_EVENTS`
 * frozen-sentinel discipline elsewhere on the audience surface).
 *
 * Semantics:
 *
 * - Each `snapshot-created` SUPERSEDES the prior one — the marker shows
 *   the current segment, so a newer snapshot replaces an older label
 *   (Decision §5 — persistent until superseded).
 * - All other event kinds are ignored — this projection is exclusively
 *   the latest-snapshot caption source.
 */
export function latestSnapshotFrom(events: readonly Event[]): LatestSnapshot | null {
  let latest: LatestSnapshot | null = null;
  for (const event of events) {
    if (event.kind === 'snapshot-created') {
      latest = {
        snapshotId: event.payload.snapshot_id,
        label: event.payload.label,
        logPosition: event.payload.log_position,
      };
    }
  }
  return latest;
}
