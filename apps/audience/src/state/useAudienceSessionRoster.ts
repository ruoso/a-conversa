// Audience-side selector hook — derive the per-session participant
// roster from the WS event log.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §8 — hooks consume the narrowed `ws/` barrel, not
//   `audienceWsStore` directly; the indirection preserves the read-only
//   posture from `aud_ws_client` Decision §6.)
//
// ADRs:
//   - 0022 (no throwaway verifications — pinned by
//           `useAudienceSessionRoster.test.tsx`).

import { useMemo } from 'react';

import { useAudienceSessionEvents } from '../ws/index.js';
import { sessionRosterFrom } from './sessionRoster.js';

/**
 * `useMemo`-wrapped projection over `useAudienceSessionEvents(sessionId)`
 * calling `sessionRosterFrom`. Returns the stable `EMPTY_AUDIENCE_ROSTER`
 * reference (via the projector's early-return) when no participants
 * have joined; otherwise returns a fresh `Map` cached across renders
 * whose events slice did not change.
 *
 * The `useMemo` discipline is load-bearing: the projector mints a fresh
 * `Map` on every non-empty walk, so without the memo every render whose
 * `events` reference is stable would still hand consumers a fresh map
 * and re-render their downstream `useMemo`s by reference inequality.
 */
export function useAudienceSessionRoster(sessionId: string): ReadonlyMap<string, string> {
  const events = useAudienceSessionEvents(sessionId);
  return useMemo(() => sessionRosterFrom(events), [events]);
}
