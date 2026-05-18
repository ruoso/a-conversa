// Audience-side selector hook — read the WS connection status.
//
// Refinement: tasks/refinements/audience/aud_ws_client.md
//   (Decision §6 — TypeScript-narrowed audience WS surface. The audience
//   has no status-indicator chip today per Out-of-scope §4, so no
//   consumer reads this hook yet; the hook lands so the next audience-
//   UI leaf that wants a producer-facing diagnostic affordance has a
//   stable seam.)

import type { WsConnectionStatus } from '@a-conversa/shell';

import { audienceWsStore } from './wsStore.js';

/**
 * Read the WS connection status maintained by the shell's WS client
 * inside the audience surface. Selector identity is the
 * `connectionStatus` slot directly — Zustand's shallow-equality check
 * keeps the hook stable across renders that do not change the status.
 */
export function useAudienceConnectionStatus(): WsConnectionStatus {
  return audienceWsStore((s) => s.connectionStatus);
}
