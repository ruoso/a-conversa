// `useParticipantConnectionStatus` — the seam between the participant
// status-indicator chip and the WS subsystem.
//
// Refinement: tasks/refinements/participant-ui/part_status_indicator.md
//   (Decision §2 — the swap from the stubbed `'connecting'` to the
//   real `useWsStore` source was pre-committed as part_ws_client's
//   closer).
//              tasks/refinements/participant-ui/part_ws_client.md
//   (this swap landed; the chip now reflects real connection state).
//
// Reads `connectionStatus` off the participant's `useWsStore`
// singleton. The store is fed by the shell's `<WsClientProvider>`
// mounted at the surface boundary in `apps/participant/src/main.tsx`;
// the provider's `useEffect` calls `client.connect()` when
// `auth.status === 'authenticated'` at first hand-off, and
// `client.close()` on surface unmount.
//
// History: this file initially shipped under `part_status_indicator`
// returning the literal `'connecting'` so the chip rendered the
// honest sentinel between page-load and the (then-pending) WS wiring.
// `part_ws_client` made the singleton store-fed; the body below is
// the one-line swap to the real reader.

import type { WsConnectionStatus } from '@a-conversa/shell';

import { useWsStore } from '../ws/wsStore.js';

export function useParticipantConnectionStatus(): WsConnectionStatus {
  return useWsStore((s) => s.connectionStatus);
}
