// `useSessionEventLogPrefetch` — paginates the REST replay endpoint to
// completion so the change-history pane has the *complete* session log.
//
// Refinement: tasks/refinements/moderator-ui/mod_history_scroller.md
//
// The change-history pane must reflect the complete history (Constraints
// §1). The WS `events` array is not guaranteed complete — catch-up may
// take the `snapshot-state` fallback path, in which case
// `sessionState.events` holds a projected snapshot rather than the full
// event list. So the pane prefetches `GET /api/sessions/:id/events`,
// paging `after` → `nextCursor` until `nextCursor` is `null`, then the
// pane overlays the live WS events on top (the established "REST
// prefetch + WS overlay" pattern, precedent
// `mod_invite_participants_rest_prefetch`).
//
// **REST idiom** (precedent `InviteParticipants.tsx`): no central
// `apiClient`; routes call `fetch` directly under the `/api` dev-proxy
// prefix with `credentials: 'include'` + `Accept: application/json`,
// then a status check + a defensive `await response.json()` parse.
//
// **Unmount-safe** (Constraints §10, precedent
// `InviteParticipants.tsx:187,274-275`): a `cancelled` guard so the
// pagination loop never `setState`s a torn-down component. A `retry`
// callback bumps a nonce that re-runs the effect (the error surface's
// retry button calls it).

import { useCallback, useEffect, useState } from 'react';
import type { Event } from '@a-conversa/shared-types';

/** The REST page size. The endpoint caps `limit` at 1000; 100 matches
 *  the endpoint default and keeps each page bounded. */
const PAGE_LIMIT = 100;

/** The prefetch lifecycle. `ready` means the full log has been paged in
 *  (the pane then overlays live WS events on top). */
export type SessionEventLogPrefetchStatus = 'loading' | 'ready' | 'error';

export interface SessionEventLogPrefetch {
  /** The current prefetch lifecycle phase. */
  readonly status: SessionEventLogPrefetchStatus;
  /** The full prefetched log (ascending by `sequence`), or `[]` until ready. */
  readonly events: readonly Event[];
  /** Re-run the prefetch from the start of the log (the retry button). */
  readonly retry: () => void;
}

/**
 * Narrow an unknown REST array element to the fields the change-history
 * pane reads off the envelope. The endpoint validates the full
 * `EventEnvelope` shape server-side; this is a defensive client-side
 * guard mirroring `InviteParticipants`'s per-row narrowing so a
 * malformed element is dropped rather than crashing the render.
 */
function isEventLike(raw: unknown): raw is Event {
  if (raw === null || typeof raw !== 'object') return false;
  const candidate = raw as {
    id?: unknown;
    sequence?: unknown;
    kind?: unknown;
    actor?: unknown;
    createdAt?: unknown;
  };
  if (typeof candidate.id !== 'string') return false;
  if (typeof candidate.sequence !== 'number') return false;
  if (typeof candidate.kind !== 'string') return false;
  if (candidate.actor !== null && typeof candidate.actor !== 'string') return false;
  if (typeof candidate.createdAt !== 'string') return false;
  return true;
}

/**
 * Prefetch the complete session event log via the REST replay endpoint.
 *
 * @param sessionId The session whose log to fetch. An empty string
 *   short-circuits (the route param has a `''` default before it
 *   resolves), leaving the hook in its `loading` initial phase.
 */
export function useSessionEventLogPrefetch(sessionId: string): SessionEventLogPrefetch {
  const [status, setStatus] = useState<SessionEventLogPrefetchStatus>('loading');
  const [events, setEvents] = useState<readonly Event[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (sessionId === '') return;
    let cancelled = false;
    setStatus('loading');
    setEvents([]);
    void (async () => {
      try {
        const collected: Event[] = [];
        let after = 0;
        // Page forward until the endpoint reports the head of the log
        // (`nextCursor === null`). A non-numeric / missing cursor also
        // terminates the loop defensively.
        for (;;) {
          const response = await fetch(
            `/api/sessions/${sessionId}/events?after=${String(after)}&limit=${String(PAGE_LIMIT)}`,
            {
              method: 'GET',
              credentials: 'include',
              headers: { Accept: 'application/json' },
            },
          );
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
            !Array.isArray((body as { events?: unknown }).events)
          ) {
            setStatus('error');
            return;
          }
          const page = body as { events: readonly unknown[]; nextCursor?: unknown };
          for (const raw of page.events) {
            if (isEventLike(raw)) collected.push(raw);
          }
          if (typeof page.nextCursor === 'number') {
            after = page.nextCursor;
          } else {
            break;
          }
        }
        if (cancelled) return;
        setEvents(collected);
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

  return { status, events, retry };
}
