// REST-sourced full-event-log fetch hook for the replay / test-mode surfaces.
//
// Refinement: tasks/refinements/replay_test/test_mode_load_session.md
// ADRs:        0010 (pnpm-workspace package placement),
//              0021 (event envelope — the wire `Event` shape this reuses).
//
// Pages `GET /api/sessions/:id/events` to completion (following
// `nextCursor` until `null`) so the replay / test-mode surfaces hold the
// *complete* session log in ascending `sequence` order. Modeled on the
// shell's `useSessionSnapshots` (same raw-`fetch` + `useState` idiom,
// `cancelled` guard, `retryNonce` re-run) plus the moderator's
// `useSessionEventLogPrefetch` paging loop (`PAGE_LIMIT = 100`, `for (;;)`
// advancing `after = nextCursor`, defensive `isEventLike()` element guard).
//
// It adds a fourth `'not-found'` state the snapshot hook never needed:
// test-mode is entered by pasting a raw session id into the URL, so a 404
// (unknown OR invisible session — the backend deliberately returns the
// same 404 for both) is a frequent, distinct outcome that earns its own
// affordance rather than a generic, pointless retry.

import { useCallback, useEffect, useState } from 'react';
import type { Event } from '@a-conversa/shared-types';

/** The REST page size. The endpoint caps `limit` at 1000; 100 matches the
 *  endpoint default and the moderator prefetch's established constant. */
const PAGE_LIMIT = 100;

export type SessionEventLogStatus = 'loading' | 'ready' | 'not-found' | 'error';

export interface SessionEventLog {
  /** The current load-machine phase. */
  readonly status: SessionEventLogStatus;
  /** The full assembled log (ascending by `sequence`), or `[]` until ready. */
  readonly events: readonly Event[];
  /** Re-run the load from the head of the log (the error-state retry). */
  readonly retry: () => void;
}

const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

/**
 * Defensive narrowing of one parsed array element off the wire. The
 * endpoint validates the full `EventEnvelope` server-side; this mirrors
 * the moderator prefetch's per-row guard so a malformed element is
 * dropped rather than crashing the render — well-formed siblings survive.
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
 * Load the complete session event log via the REST replay endpoint.
 *
 * @param sessionId The session whose log to load. An empty string
 *   short-circuits (the route param resolves to `''` before it is
 *   populated), leaving the hook in its `loading` initial phase.
 */
export function useSessionEventLog(sessionId: string): SessionEventLog {
  const [status, setStatus] = useState<SessionEventLogStatus>('loading');
  const [events, setEvents] = useState<readonly Event[]>(EMPTY_EVENTS);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (sessionId === '') return;
    let cancelled = false;
    setStatus('loading');
    setEvents(EMPTY_EVENTS);
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
          // The operator typed/pasted the id; an unknown-or-invisible
          // session is a distinct, expected outcome — not a retry-able error.
          if (response.status === 404) {
            setStatus('not-found');
            return;
          }
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
        // Assembled in endpoint order (ascending `sequence`); no re-sort.
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
