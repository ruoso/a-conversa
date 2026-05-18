// `sessionMode.ts` — audience-side per-event-log projector returning the
// session's current mode (`'lobby' | 'operate'`).
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §5 — `'lobby'` is the v0 default until the first
//   `session-mode-changed` envelope arrives. The audience needs the
//   persistent mode value because rendered chrome depends on it: lobby
//   = roster + waiting screen, operate = graph canvas. The participant's
//   single-event-triggered filter at LobbyRoute.tsx:469 is structurally
//   different — that's a navigation trigger, not a render switch. The
//   participant's `CONTENT_EVENT_KINDS` fallback heuristic exists for
//   ADR-0028 backward compatibility (replay-correctness for pre-ADR-0028
//   sessions); the audience is a forward-only consumer that ships well
//   after ADR 0028 landed, so the heuristic is deliberately NOT mirrored.)
//
// ADRs:
//   - 0028 (session-mode-changed dedicated event — canonical mode-
//           transition signal).
//   - 0021 (event-envelope discriminated union — `event.kind` discriminator).
//   - 0022 (no throwaway verifications — pinned by `sessionMode.test.ts`).

import type { Event, SessionMode } from '@a-conversa/shared-types';

/**
 * Default mode for a session whose event log has not yet surfaced a
 * `session-mode-changed` envelope. `'lobby'` matches the methodology —
 * a fresh session starts in lobby; the first `session-mode-changed`
 * lands when the moderator hits "Enter session." Showing the lobby
 * chrome briefly before the real mode arrives is benign; showing the
 * operate chrome briefly when the session is actually in lobby would
 * be a visible flicker (an empty canvas for a frame).
 */
const DEFAULT_MODE: SessionMode = 'lobby';

/**
 * Walk the per-session event log once, returning the latest
 * `session-mode-changed.new_mode` observed. Returns `'lobby'` when no
 * mode-transition envelope has arrived. Per ADR 0028 this is the only
 * event kind the projector consults — no content-event heuristic.
 */
export function sessionModeFrom(events: readonly Event[]): SessionMode {
  let mode: SessionMode = DEFAULT_MODE;
  for (const event of events) {
    if (event.kind === 'session-mode-changed') {
      mode = event.payload.new_mode;
    }
  }
  return mode;
}
