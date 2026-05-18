// Audience workspace's state-derivation barrel.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//
// Single import point downstream audience UI leaves use to consume
// derived state. The `useAudienceSession()` facade is the canonical
// entry; the focused projectors + selectors are exported for the rare
// consumer that wants one slice without the others (e.g. a future
// producer-facing status chip that only needs `useAudienceConnectionStatus`).
//
// Separate from `apps/audience/src/ws/index.ts`'s read-only barrel
// (which intentionally narrows the WS-client surface per aud_ws_client
// Decision §6). The narrowing intent stays legible by keeping the two
// barrels separate — the WS barrel is about the wire seam, this barrel
// is about derived state over the wire.

export { sessionRosterFrom, EMPTY_AUDIENCE_ROSTER } from './sessionRoster.js';
export { sessionModeFrom } from './sessionMode.js';
export { sessionIdFromPathname, stripAudienceBasename } from './sessionId.js';
export { useAudienceSessionRoster } from './useAudienceSessionRoster.js';
export { useAudienceSessionMode } from './useAudienceSessionMode.js';
export { useAudienceSessionId } from './useAudienceSessionId.js';
export { useAudienceSession, type AudienceSessionView } from './useAudienceSession.js';
export type { SessionMode } from '@a-conversa/shared-types';
