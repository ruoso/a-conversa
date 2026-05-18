// Audience-side composing facade — returns every common derivation
// downstream audience UI leaves need in one stable view object.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §2 — facade + focused exports; downstream `aud_graph_rendering.*`
//   reads `useAudienceSession()` and gets sessionId / connectionStatus /
//   events / roster / sessionMode in one import. Focused hooks remain
//   available for the rare consumer that wants one slice without the
//   others. Decision §9 — the returned object is freshly minted per
//   render; each inner field is individually stable across no-change
//   renders by virtue of Zustand selector identity or `useMemo`.)
//
// ADRs:
//   - 0022 (no throwaway verifications — pinned by
//           `useAudienceSession.test.tsx`).

import type { Event, SessionMode } from '@a-conversa/shared-types';
import type { WsConnectionStatus } from '@a-conversa/shell';

import { useAudienceConnectionStatus, useAudienceSessionEvents } from '../ws/index.js';
import { useAudienceSessionId } from './useAudienceSessionId.js';
import { useAudienceSessionMode } from './useAudienceSessionMode.js';
import { useAudienceSessionRoster } from './useAudienceSessionRoster.js';

/**
 * The canonical "everything the audience UI needs about the current
 * session" view. Returned by `useAudienceSession()` and consumed by
 * the downstream `aud_graph_rendering.*` family. Read-only by
 * convention (the audience never mutates derived state) and by
 * TypeScript declaration (`readonly` modifiers + `ReadonlyMap` /
 * `readonly Event[]`).
 */
export interface AudienceSessionView {
  /** The session id parsed from the URL (`null` until a `/sessions/<uuid>` URL is reached). */
  readonly sessionId: string | null;
  /** The WS connection status surfaced by the shell client. */
  readonly connectionStatus: WsConnectionStatus;
  /** The ordered event stream for the active session, or empty if no session id. */
  readonly events: readonly Event[];
  /** The currently-present-participants roster, or empty if no session id. */
  readonly roster: ReadonlyMap<string, string>;
  /** The current session mode, `'lobby'` by default until a `session-mode-changed` is observed. */
  readonly sessionMode: SessionMode;
}

/**
 * Sentinel id used when the URL has not yet resolved to a real
 * session id. React requires the same hooks to be called in the same
 * order on every render, so the facade always calls
 * `useAudienceSessionEvents` / `useAudienceSessionRoster` /
 * `useAudienceSessionMode` — passing this placeholder when no real
 * id is known. The underlying selectors return `EMPTY_EVENTS`
 * (and through them the empty roster / `'lobby'` default) for the
 * sentinel because no envelopes were ever applied to it.
 */
const NO_SESSION_PLACEHOLDER_ID = '__none__';

/**
 * The single-stop facade hook for the audience surface. Composes:
 *   - `useAudienceSessionId()` — URL → session id (`popstate`-subscribed),
 *   - `useAudienceConnectionStatus()` — WS connection status,
 *   - `useAudienceSessionEvents(id)` — ordered envelope log,
 *   - `useAudienceSessionRoster(id)` — `userId → screenName` map,
 *   - `useAudienceSessionMode(id)` — `'lobby' | 'operate'`.
 *
 * The returned object is freshly minted per render; consumers that
 * need stable identity for `useEffect` dep arrays destructure
 * individual fields, each of which is stable across no-change renders
 * (Zustand selector identity for `events`/`connectionStatus`,
 * `useMemo` identity for `roster`/`sessionMode`, primitive identity
 * for `sessionId`/`sessionMode`).
 */
export function useAudienceSession(): AudienceSessionView {
  const sessionId = useAudienceSessionId();
  const lookupKey = sessionId ?? NO_SESSION_PLACEHOLDER_ID;
  const connectionStatus = useAudienceConnectionStatus();
  const events = useAudienceSessionEvents(lookupKey);
  const roster = useAudienceSessionRoster(lookupKey);
  const sessionMode = useAudienceSessionMode(lookupKey);
  return {
    sessionId,
    connectionStatus,
    events,
    roster,
    sessionMode,
  };
}
