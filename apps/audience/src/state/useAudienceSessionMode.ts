// Audience-side selector hook — derive the current session mode from
// the WS event log.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §5 — mode derives ONLY from `session-mode-changed`
//   envelopes, defaulting to `'lobby'`; no `CONTENT_EVENT_KINDS`
//   fallback heuristic — the audience is a forward-only consumer that
//   ships well after ADR 0028 landed.)
//
// ADRs:
//   - 0028 (session-mode-changed dedicated event).
//   - 0022 (no throwaway verifications — pinned by
//           `useAudienceSessionMode.test.tsx`).

import { useMemo } from 'react';

import type { SessionMode } from '@a-conversa/shared-types';

import { useAudienceSessionEvents } from '../ws/index.js';
import { sessionModeFrom } from './sessionMode.js';

/**
 * `useMemo`-wrapped projection over `useAudienceSessionEvents(sessionId)`
 * calling `sessionModeFrom`. Returns the literal `'lobby'` / `'operate'`
 * primitive; primitive equality keeps downstream `useMemo` deps stable
 * across renders that did not change the latest observed mode.
 */
export function useAudienceSessionMode(sessionId: string): SessionMode {
  const events = useAudienceSessionEvents(sessionId);
  return useMemo(() => sessionModeFrom(events), [events]);
}
