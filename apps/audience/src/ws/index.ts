// Audience workspace's WS subsystem barrel.
//
// Refinement: tasks/refinements/audience/aud_ws_client.md
//   (Decision §6 — read-only enforcement via TypeScript surface
//   narrowing. The barrel re-exports ONLY the read-only audience-side
//   hooks + the store singleton; it does NOT re-export `useWsClient`
//   from `@a-conversa/shell`. Audience UI code that wants the
//   underlying client (e.g. the future `aud_session_url` route's
//   `trackSession` lifecycle) imports directly from
//   `@a-conversa/shell`, which is a visible diff-time signal that
//   "this is unusual for an audience component." Adding a `send`-side
//   re-export here is a visible diff-time signal that "we're adding a
//   publish path to the audience." The narrowing is enforced by what
//   is exported, not by runtime guards.)

export { audienceWsStore } from './wsStore.js';
export { useAudienceSessionEvents } from './useAudienceSessionEvents.js';
export { useAudienceConnectionStatus } from './useAudienceConnectionStatus.js';
