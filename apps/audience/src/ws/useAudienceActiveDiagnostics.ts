// Audience-side selector hook — read the per-session `activeDiagnostics`
// map from the audience WS store.
//
// Refinement: tasks/refinements/audience/aud_diagnostic_fire_animation.md
//   (Decision §3 — third-caller port of the participant's
//   `activeDiagnostics` slot; consumed by
//   `<AudienceDiagnosticFireOverlay>` for the one-shot fire animation.)
//
// ADRs: 0022 (no throwaway verifications — the hook is exercised
//             indirectly through `DiagnosticFireOverlay.test.tsx`).

import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { audienceWsStore } from './wsStore.js';

/**
 * Stable empty-map reference. Hands consumers a deterministic empty
 * value when the session has no active diagnostics — keeps the React /
 * Zustand selector identity stable for the no-diagnostic baseline.
 */
const EMPTY_ACTIVE_DIAGNOSTICS: ReadonlyMap<string, DiagnosticPayload> = new Map();

/**
 * Read the audience-side per-session `activeDiagnostics` map. Returns
 * the stable empty-map sentinel when the session is unknown OR when
 * `sessionId` is `null` (the URL has not yet resolved to a real
 * session) — callers can therefore consume the result unconditionally
 * without an `if (sessionId === null) return ...` branch.
 */
export function useAudienceActiveDiagnostics(
  sessionId: string | null,
): ReadonlyMap<string, DiagnosticPayload> {
  return audienceWsStore((s) => {
    if (sessionId === null) return EMPTY_ACTIVE_DIAGNOSTICS;
    return s.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_ACTIVE_DIAGNOSTICS;
  });
}
