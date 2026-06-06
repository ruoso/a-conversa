// Audience-side selector hook — derive the most-recent snapshot for a
// session from the WS event log, for the live chapter-marker caption.
//
// Refinement: tasks/refinements/audience/aud_chapter_marker_render.md
//   (Decision §4 — latest-only, standalone selector NOT threaded through
//   the `useAudienceSession()` facade: the marker needs only the most
//   recent snapshot and only `<ChapterMarker>` consumes it today, so
//   this stays a standalone hook until a second consumer earns the
//   facade field. Mirrors the `useAudienceSessionRoster` shape.)
//
// ADRs:
//   - 0022 (no throwaway verifications — pinned by
//           `useAudienceLatestSnapshot.test.tsx`).

import { useMemo } from 'react';

import { useAudienceSessionEvents } from '../ws/index.js';
import { latestSnapshotFrom, type LatestSnapshot } from './latestSnapshot.js';

/**
 * `useMemo`-wrapped projection over `useAudienceSessionEvents(sessionId)`
 * calling `latestSnapshotFrom`. Returns `null` (the stable no-snapshot
 * sentinel) until the first `snapshot-created` event arrives, then the
 * latest snapshot's `{ snapshotId, label, logPosition }`, superseding to
 * a newer snapshot when one is applied.
 *
 * The `useMemo` keeps the result reference stable when the watched
 * session's events slice did not change, so the no-op `null` baseline
 * and an unchanged latest-snapshot do not re-render the consumer.
 */
export function useAudienceLatestSnapshot(sessionId: string): LatestSnapshot | null {
  const events = useAudienceSessionEvents(sessionId);
  return useMemo(() => latestSnapshotFrom(events), [events]);
}
