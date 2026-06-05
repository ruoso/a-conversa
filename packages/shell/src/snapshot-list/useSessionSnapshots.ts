// REST-sourced snapshot fetch hook for the cross-surface snapshot list.
//
// Refinement: tasks/refinements/replay_test/snapshot_list_ui.md
// ADRs:        0010 (pnpm-workspace package placement).
//
// Fetches `GET /api/sessions/:id/snapshots` following the project's
// established raw-`fetch` + `useState` idiom
// (`apps/moderator/src/layout/useSessionEventLogPrefetch.ts`): no React
// Query / SWR, `credentials: 'include'`, status-check-before-parse, and a
// defensive narrowing guard on every parsed record. The endpoint already
// returns chapter order (ascending `logPosition`); this hook preserves it
// verbatim — no client re-sort or reversal.

import { useCallback, useEffect, useState } from 'react';

import type { SnapshotRecord } from './types.js';

export type SessionSnapshotsStatus = 'loading' | 'ready' | 'error';

export interface SessionSnapshots {
  readonly status: SessionSnapshotsStatus;
  readonly snapshots: readonly SnapshotRecord[];
  readonly retry: () => void;
}

const EMPTY_SNAPSHOTS: readonly SnapshotRecord[] = Object.freeze([]);

/**
 * Defensive narrowing of one parsed record off the wire. The endpoint is
 * trusted, but the hook must not assume the JSON body's shape — a
 * malformed payload becomes an `error` state, never a throw or a partial
 * render.
 */
function isSnapshotRecord(raw: unknown): raw is SnapshotRecord {
  if (raw === null || typeof raw !== 'object') return false;
  const candidate = raw as {
    snapshotId?: unknown;
    label?: unknown;
    logPosition?: unknown;
    createdAt?: unknown;
  };
  if (typeof candidate.snapshotId !== 'string') return false;
  if (typeof candidate.label !== 'string') return false;
  if (typeof candidate.logPosition !== 'number') return false;
  if (typeof candidate.createdAt !== 'string') return false;
  return true;
}

export function useSessionSnapshots(sessionId: string): SessionSnapshots {
  const [status, setStatus] = useState<SessionSnapshotsStatus>('loading');
  const [snapshots, setSnapshots] = useState<readonly SnapshotRecord[]>(EMPTY_SNAPSHOTS);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (sessionId === '') return;
    let cancelled = false;
    setStatus('loading');
    setSnapshots(EMPTY_SNAPSHOTS);
    void (async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/snapshots`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (cancelled) return;
        if (response.status !== 200) {
          setStatus('error');
          return;
        }
        const body = (await response.json()) as unknown;
        if (cancelled) return;
        if (
          body === null ||
          typeof body !== 'object' ||
          !Array.isArray((body as { snapshots?: unknown }).snapshots)
        ) {
          setStatus('error');
          return;
        }
        const raw = (body as { snapshots: readonly unknown[] }).snapshots;
        const narrowed: SnapshotRecord[] = [];
        for (const item of raw) {
          // A single malformed record rejects the whole payload — the
          // list must not render a partial, possibly-misordered index.
          if (!isSnapshotRecord(item)) {
            setStatus('error');
            return;
          }
          narrowed.push(item);
        }
        // Rendered in endpoint order (ascending `logPosition`); no re-sort.
        setSnapshots(narrowed);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, retryNonce]);

  const retry = useCallback(() => {
    setRetryNonce((nonce) => nonce + 1);
  }, []);

  return { status, snapshots, retry };
}
