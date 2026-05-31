// Top-left overlay strip listing snapshot labels in reverse-chronological
// order. Mounted as a sibling of `<ReactFlow>` inside `<GraphCanvasPane>`.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_visual_marker.md
//
// Reads `session.events` from `useWsStore` (per-session, scoped by
// `sessionId` from the route param) and derives the visible snapshot
// list via `projectSnapshots(events)`. Returns `null` when the list is
// empty so the call site can mount unconditionally (Decision §4).

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { Event } from '@a-conversa/shared-types';

import { projectSnapshots, type Snapshot } from './selectors.js';
import { useWsStore } from '../ws/wsStore.js';

// Frozen empty fallback so the Zustand selector returns a stable
// reference when the session has no events yet — same rationale as
// `EMPTY_EVENTS` in `GraphCanvasPane.tsx`.
const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

// UI-only visible cap; lives here (not in `limits.ts`) because the
// constraint is UI-layer-only and has no wire correlate (Decision §7).
export const MAX_VISIBLE_SNAPSHOTS = 5;

export interface SnapshotMarkerStripProps {
  /**
   * Session id used as the routing key for the per-session events
   * selector. Mirrors `<GraphCanvasPane>`'s `sessionId` prop — the
   * canvas already has it from `Operate.tsx`; passing it through
   * avoids a redundant `useParams` call that would only complicate
   * the moderator's existing direct-render test harness.
   */
  readonly sessionId: string;
}

export function SnapshotMarkerStrip(props: SnapshotMarkerStripProps): ReactElement | null {
  const { sessionId } = props;
  const { t } = useTranslation();
  const events = useWsStore((state) => state.sessionState[sessionId]?.events ?? EMPTY_EVENTS);

  const snapshots = projectSnapshots(events);
  if (snapshots.length === 0) return null;

  // Reverse for newest-first display (Decision §3). `.slice().reverse()`
  // is non-mutating; the selector's return is fresh per call so a
  // mutating reverse would be harmless, but the non-mutating form
  // keeps the projection contract explicit.
  const newestFirst = snapshots.slice().reverse();
  const visible = newestFirst.slice(0, MAX_VISIBLE_SNAPSHOTS);
  const hiddenCount = Math.max(0, snapshots.length - MAX_VISIBLE_SNAPSHOTS);

  return (
    <div
      data-testid="snapshot-marker-strip"
      role="region"
      aria-label={t('moderator.snapshotMarker.stripAriaLabel')}
      className="pointer-events-none absolute left-4 top-4 z-10 flex max-w-[16rem] flex-col gap-1 rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-900 shadow-md"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t('moderator.snapshotMarker.header', { n: snapshots.length })}
      </h3>
      <ol className="flex flex-col gap-1">
        {visible.map((snapshot: Snapshot) => (
          <li
            key={snapshot.snapshotId}
            data-testid={`snapshot-marker-${snapshot.snapshotId}`}
            data-log-position={snapshot.logPosition}
            data-snapshot-label={snapshot.label}
            title={snapshot.label}
            className="flex items-baseline gap-2 truncate rounded border border-slate-100 bg-slate-50 px-2 py-1"
          >
            <span className="truncate font-medium">{snapshot.label}</span>
            <span className="shrink-0 text-xs text-slate-500">#{snapshot.logPosition}</span>
          </li>
        ))}
        {hiddenCount > 0 ? (
          <li
            data-testid="snapshot-marker-overflow"
            data-hidden-count={hiddenCount}
            className="px-2 py-1 text-xs italic text-slate-500"
          >
            {t('moderator.snapshotMarker.overflowLabel', { n: hiddenCount })}
          </li>
        ) : null}
      </ol>
    </div>
  );
}

export default SnapshotMarkerStrip;
