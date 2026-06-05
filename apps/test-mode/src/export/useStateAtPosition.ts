// On-demand fetch hook for the server-authoritative projected state at a
// scrubber position — the data the test-mode export panel pulls out.
//
// Refinement: tasks/refinements/replay_test/test_mode_export_position.md
// TaskJuggler: replay_test.test_mode.test_mode_export_position
// ADRs:        0043 (the client position-navigation contract — the read
//                    position obeys the same `0..head` sequence space the
//                    endpoint accepts),
//              0010 (single-consumer hook stays app-local, not promoted to
//                    shell — the `useDiagnosticsAtPosition` precedent),
//              0021 (event envelope — `position` is event-sequence space).
//
// Mirrors the shipped `useDiagnosticsAtPosition` skeleton (raw `fetch` +
// `useState`, a per-effect `cancelled` stale guard, a request nonce that
// re-runs the effect) with two deliberate differences (Decision §2):
//
//   1. It fires only on an explicit `requestExport()` — never eagerly on
//      every `position` change. The full server projection is potentially
//      large; the scrubber designs away per-step round-trips, so export is
//      a lazy, occasional action rather than a per-drag fetch.
//   2. When the lifted `position` changes after a request, the hook resets
//      to `idle` (readout cleared) so the exported state never disagrees
//      with the position label — the "never show a stale projection"
//      invariant (Constraint §4).
//
// The per-effect `cancelled` flag is the stale-response guard: a newer
// request or a position-reset sets `request` to a new value (or `null`),
// React runs the prior effect's cleanup (`cancelled = true`) before the
// next, and a response that lands after a supersession is dropped rather
// than painting a `ready` projection for a position the operator already
// left.

import { useCallback, useEffect, useState } from 'react';

export type StateAtPositionStatus = 'idle' | 'loading' | 'ready' | 'error';

/** The server-authoritative envelope the export reads — byte-identical in
 *  field names to the WS `snapshot` payload. `projection` is deliberately
 *  opaque: the export serializes the envelope verbatim and never narrows
 *  into its facet fields (Constraint §6). */
export interface StateAtPosition {
  readonly sessionId: string;
  readonly sequence: number;
  readonly projection: unknown;
}

export interface UseStateAtPositionResult {
  /** The current fetch-machine phase. The clean initial / post-reset phase
   *  is `idle` (no request issued yet). */
  readonly status: StateAtPositionStatus;
  /** The fetched envelope once `ready`, or `null` before the first
   *  successful export and after a position-change reset. */
  readonly state: StateAtPosition | null;
  /** Capture the current `position` and issue the export fetch for it. */
  readonly requestExport: () => void;
  /** Re-issue the fetch for the captured position (the error-state retry). */
  readonly retry: () => void;
}

interface ExportRequest {
  readonly position: number;
  readonly nonce: number;
}

/**
 * Defensive narrowing of the parsed response body. The endpoint returns
 * `{ sessionId, sequence, projection }`; this requires a string `sessionId`,
 * a numeric `sequence`, and the presence of `projection` (opaque, any shape)
 * so a malformed body degrades to the retryable `error` readout rather than
 * painting a broken envelope.
 */
function isStateAtPositionLike(raw: unknown): raw is StateAtPosition {
  return (
    raw !== null &&
    typeof raw === 'object' &&
    typeof (raw as { sessionId?: unknown }).sessionId === 'string' &&
    typeof (raw as { sequence?: unknown }).sequence === 'number' &&
    'projection' in (raw as Record<string, unknown>)
  );
}

/**
 * Fetch the server-authoritative projected state at `position` in
 * `sessionId`'s log, on demand.
 *
 * @param sessionId The session whose state to export — the fetch key. An
 *   empty string short-circuits (no fetch is issued).
 * @param position The event-sequence position (`0..head`) the next
 *   `requestExport()` captures. A change here after a request resets the
 *   hook to `idle`.
 */
export function useStateAtPosition(sessionId: string, position: number): UseStateAtPositionResult {
  const [status, setStatus] = useState<StateAtPositionStatus>('idle');
  const [state, setState] = useState<StateAtPosition | null>(null);
  const [request, setRequest] = useState<ExportRequest | null>(null);

  // The export fetch fires only when a request is present (an explicit
  // Export click or a retry); it never runs for the initial `null` request,
  // so there is no eager per-step round-trip (Decision §2).
  useEffect(() => {
    if (request === null) return;
    if (sessionId === '') return;
    let cancelled = false;
    setStatus('loading');
    setState(null);
    void (async () => {
      try {
        const response = await fetch(
          `/api/sessions/${sessionId}/state?position=${String(request.position)}`,
          {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'application/json' },
          },
        );
        if (cancelled) return;
        // Any non-OK status (a 400 out-of-range, a 404 invisible session)
        // degrades to the retryable error readout rather than a blank panel.
        if (!response.ok) {
          setStatus('error');
          return;
        }
        const body = (await response.json()) as unknown;
        if (cancelled) return;
        if (!isStateAtPositionLike(body)) {
          setStatus('error');
          return;
        }
        setState(body);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, request]);

  // Position-change reset: whenever the lifted position moves, clear back to
  // the clean idle state so the readout never shows a projection that
  // disagrees with the live position (Constraint §4). Clearing `request`
  // also trips the fetch effect's cleanup, dropping any in-flight response.
  useEffect(() => {
    setStatus('idle');
    setState(null);
    setRequest(null);
  }, [position]);

  const requestExport = useCallback(() => {
    setRequest((prev) => ({ position, nonce: (prev?.nonce ?? 0) + 1 }));
  }, [position]);

  const retry = useCallback(() => {
    setRequest((prev) =>
      prev === null ? null : { position: prev.position, nonce: prev.nonce + 1 },
    );
  }, []);

  return { status, state, requestExport, retry };
}
