// Presentational, surface-agnostic snapshot list.
//
// Refinement: tasks/refinements/replay_test/snapshot_list_ui.md
// ADRs:        0003 (React); 0024 (react-i18next).
//
// The read-only consumption counterpart to the moderator's snapshot
// creation surface: given a list of REST-sourced snapshot records plus a
// load state, renders one navigable row per snapshot (label, `#logPosition`,
// `createdAt`) and exposes `onSelect(snapshotId)` so a host surface
// (replay viewer, test-mode scrubber) can wire navigation. It is
// route-agnostic and surface-agnostic — props in, callbacks out, no store
// reads, no fetch.
//
// This is deliberately NOT the moderator's `SnapshotMarkerStrip`
// (`apps/moderator/src/graph/SnapshotMarkerStrip.tsx`): that reads the live
// in-memory WS event log, caps at 5 newest-first markers, and is bound to
// the operate console. This list is REST-sourced (works for any recorded
// session), unbounded, and rendered in ascending `logPosition` chapter
// order exactly as given — a navigable index, not a recency ticker.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { SnapshotRecord } from './types.js';

export type SnapshotListStatus = 'loading' | 'ready' | 'error';

export interface SnapshotListProps {
  readonly status: SnapshotListStatus;
  readonly snapshots: readonly SnapshotRecord[];
  /** Fired with the row's `snapshotId` when a snapshot row is activated. */
  readonly onSelect: (snapshotId: string) => void;
  /** Re-issue the fetch; wired to the error-state retry affordance. */
  readonly onRetry?: () => void;
}

export function SnapshotList(props: SnapshotListProps): ReactElement {
  const { status, snapshots, onSelect, onRetry } = props;
  const { t } = useTranslation();

  if (status === 'loading') {
    return (
      <div
        data-testid="snapshot-list-loading"
        role="status"
        aria-live="polite"
        className="px-3 py-2 text-sm italic text-slate-500"
      >
        {t('snapshotList.loading')}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        data-testid="snapshot-list-error"
        role="alert"
        className="flex flex-col gap-2 px-3 py-2 text-sm text-slate-900"
      >
        <span>{t('snapshotList.error')}</span>
        <button
          type="button"
          data-testid="snapshot-list-retry"
          onClick={() => onRetry?.()}
          className="self-start rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {t('snapshotList.retry')}
        </button>
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div
        data-testid="snapshot-list-empty"
        role="status"
        className="px-3 py-2 text-sm italic text-slate-500"
      >
        {t('snapshotList.empty')}
      </div>
    );
  }

  return (
    <nav
      data-testid="snapshot-list"
      aria-label={t('snapshotList.regionAriaLabel')}
      className="flex flex-col text-sm text-slate-900"
    >
      <ol className="flex flex-col">
        {snapshots.map((snapshot: SnapshotRecord) => (
          <li key={snapshot.snapshotId}>
            <button
              type="button"
              data-testid={`snapshot-list-row-${snapshot.snapshotId}`}
              data-snapshot-id={snapshot.snapshotId}
              data-log-position={snapshot.logPosition}
              aria-label={t('snapshotList.rowAriaLabel', {
                label: snapshot.label,
                position: snapshot.logPosition,
              })}
              onClick={() => {
                onSelect(snapshot.snapshotId);
              }}
              className="flex w-full items-baseline gap-2 border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
            >
              <span className="truncate font-medium">{snapshot.label}</span>
              <span className="shrink-0 text-xs text-slate-500">#{snapshot.logPosition}</span>
              <time
                dateTime={snapshot.createdAt}
                data-testid={`snapshot-list-row-${snapshot.snapshotId}-created-at`}
                className="ml-auto shrink-0 text-xs text-slate-400"
              >
                {snapshot.createdAt}
              </time>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default SnapshotList;
