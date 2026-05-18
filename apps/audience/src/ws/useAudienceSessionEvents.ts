// Audience-side selector hook — read events for a given session.
//
// Refinement: tasks/refinements/audience/aud_ws_client.md
//   (Decision §6 — TypeScript-narrowed audience WS surface. This hook
//   is one of two read-only selectors re-exported from
//   `apps/audience/src/ws/index.ts` — the `send`-side surface from
//   `useWsClient()` is deliberately NOT exposed through the barrel.)
//
// The `EMPTY_EVENTS` frozen-array trick is load-bearing for React
// render-loop avoidance: a `?? []` literal would mint a fresh array on
// every render and trigger Zustand to re-render every consumer on every
// render of any consumer. The frozen-empty pattern matches similar
// selector hooks across the participant + moderator workspaces.

import type { Event } from '@a-conversa/shared-types';

import { audienceWsStore } from './wsStore.js';

const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

/**
 * Read the ordered event stream the audience has received for
 * `sessionId` via the WS `event-applied` broadcast. Returns a stable
 * empty-array reference when no events have arrived for that session
 * (so consumers do not re-render on every store change).
 */
export function useAudienceSessionEvents(sessionId: string): readonly Event[] {
  return audienceWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS);
}
