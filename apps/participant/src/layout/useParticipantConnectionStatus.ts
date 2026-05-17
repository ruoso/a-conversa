// `useParticipantConnectionStatus` — the seam between the participant
// status-indicator chip and the WS subsystem.
//
// Refinement: tasks/refinements/participant-ui/part_status_indicator.md
//   (Decision §2 — stubbed source today, one-line swap when
//   `part_ws_client` lands).
//
// Today: returns `'connecting'` (a sentinel "we know something is meant
// to happen here; it hasn't yet" value that matches what a real WS
// would report between mount and the first `'open'`). Decision §2
// explains why this is preferable to `'idle'` or `'open'` as a stub.
//
// Tomorrow (after `part_ws_client` lands and a participant-local
// `useWsStore` becomes callable): replace the body with
// `return useWsStore((s) => s.connectionStatus);`. The component above
// changes zero lines.

import type { WsConnectionStatus } from '@a-conversa/shell';

export function useParticipantConnectionStatus(): WsConnectionStatus {
  // Stubbed source — see Decision §2. The future implementation reads
  // from `useWsStore((s) => s.connectionStatus)`.
  return 'connecting';
}
