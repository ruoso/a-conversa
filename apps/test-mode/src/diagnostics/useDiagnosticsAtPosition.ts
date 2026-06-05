// Position-keyed structural-diagnostics fetch hook for the test-mode scrubber.
//
// Refinement: tasks/refinements/replay_test/test_mode_diagnostic_inspector.md
// TaskJuggler: replay_test.test_mode.test_mode_diagnostic_inspector
// ADRs:        0044 (replay-position diagnostics are served by a backend
//                    endpoint, not recomputed client-side — this hook is the
//                    thin client of that endpoint),
//              0010 (pnpm-workspace package placement — single-consumer hook
//                    stays in the app, not promoted to shell; Decision §5),
//              0021 (event envelope — `position` is event-sequence space).
//
// Unlike the pure-client `EventInspector` / `ChangeHighlights` siblings, the
// diagnostics computation is server-only (the detectors read the server
// `Projection` class — ADR 0044), so the panel reaches it through a server
// round-trip. This hook fetches `GET /api/sessions/:id/diagnostics?position=N`
// and refetches whenever `(sessionId, position)` changes, modelled on the
// shell's `useSessionEventLog` (raw-`fetch` + `useState`, per-effect
// `cancelled` guard, `retryNonce` re-run).
//
// The per-effect `cancelled` flag is the stale-response guard (Constraint §3):
// when `position` changes React runs the prior effect's cleanup (setting
// `cancelled = true`) before the next effect, so a response that lands after a
// newer request was issued is dropped rather than painting diagnostics from a
// superseded position. No debounce in v1 (Decision §5).

import { useCallback, useEffect, useState } from 'react';
import type { WireDiagnostic } from '@a-conversa/shell';

export type DiagnosticsAtPositionStatus = 'loading' | 'ready' | 'error';

export interface DiagnosticsAtPosition {
  /** The current fetch-machine phase. */
  readonly status: DiagnosticsAtPositionStatus;
  /** The diagnostics at the current position, or `[]` until ready. A `ready`
   *  empty array is the clean / baseline state (Decision §3), not an error. */
  readonly diagnostics: readonly WireDiagnostic[];
  /** Re-run the fetch for the current `(sessionId, position)` (the error-state
   *  retry). */
  readonly retry: () => void;
}

const EMPTY_DIAGNOSTICS: readonly WireDiagnostic[] = Object.freeze([]);

/**
 * Defensive narrowing of one parsed array element off the wire. The endpoint
 * returns wire-shaped `DiagnosticEntry` objects; this only requires a string
 * `kind` discriminant so an unrecognized future kind still flows through (the
 * panel renders it as a generic fallback row, Constraint §4) while a malformed
 * non-object element is dropped.
 */
function isWireDiagnosticLike(raw: unknown): raw is WireDiagnostic {
  return (
    raw !== null && typeof raw === 'object' && typeof (raw as { kind?: unknown }).kind === 'string'
  );
}

/**
 * Fetch the structural diagnostics the methodology engine surfaces for the
 * projected state at `position` in `sessionId`'s log.
 *
 * @param sessionId The session whose diagnostics to load. An empty string
 *   short-circuits, leaving the hook in its `loading` initial phase.
 * @param position The event-sequence position (`0..head`) to read diagnostics
 *   at. `0` is the empty baseline — the endpoint returns an empty set, which
 *   the panel renders as the clean "no diagnostics" state.
 */
export function useDiagnosticsAtPosition(
  sessionId: string,
  position: number,
): DiagnosticsAtPosition {
  const [status, setStatus] = useState<DiagnosticsAtPositionStatus>('loading');
  const [diagnostics, setDiagnostics] = useState<readonly WireDiagnostic[]>(EMPTY_DIAGNOSTICS);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (sessionId === '') return;
    let cancelled = false;
    setStatus('loading');
    setDiagnostics(EMPTY_DIAGNOSTICS);
    void (async () => {
      try {
        const response = await fetch(
          `/api/sessions/${sessionId}/diagnostics?position=${String(position)}`,
          {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'application/json' },
          },
        );
        if (cancelled) return;
        // Any non-OK status (including a 404 while the backend endpoint is not
        // yet wired — ADR 0044's separate leaf) degrades to the retryable
        // error readout rather than a blank panel.
        if (!response.ok) {
          setStatus('error');
          return;
        }
        const body = (await response.json()) as unknown;
        if (cancelled) return;
        if (
          body === null ||
          typeof body !== 'object' ||
          !Array.isArray((body as { diagnostics?: unknown }).diagnostics)
        ) {
          setStatus('error');
          return;
        }
        const entries = (body as { diagnostics: readonly unknown[] }).diagnostics.filter(
          isWireDiagnosticLike,
        );
        setDiagnostics(entries);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, position, retryNonce]);

  const retry = useCallback(() => {
    setRetryNonce((nonce) => nonce + 1);
  }, []);

  return { status, diagnostics, retry };
}
