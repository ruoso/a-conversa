// `useWsStore` — participant-side WS-fed Zustand singleton.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md
//   (Decision §2 — delegates to the shell's `createDefaultWsStore()`
//   factory instead of extending `BaseWsStoreState` with a participant-
//   specific projection; the participant has no projection requirement
//   the base contract does not already satisfy).
//
// The actual WS client + provider wiring lives in `part_ws_client`
// (future leaf, 0.5d, depends `!part_state_management`). Until that
// lands, `useWsStore.getState().connectionStatus` stays at the factory
// default `'idle'` — no writer fires. This file's job is to export the
// singleton so the future leaf has a stable target to import.

import type { BaseWsSessionState, BaseWsStoreState } from '@a-conversa/shell';
import { createDefaultWsStore } from '@a-conversa/shell';

/**
 * Re-export the shell types under the participant's local names for
 * symmetry with the moderator's `apps/moderator/src/ws/wsStore.ts:35`
 * re-export pattern. Consumers can import either the local names or
 * the shell names; the moderator did the local re-export for source-
 * stability across the shell extraction (per `shell_substrate_extraction`
 * Decision §"WsStore extraction shape" path C).
 */
export type WsSessionState = BaseWsSessionState;
export type WsState = BaseWsStoreState;
export type { WsConnectionStatus } from '@a-conversa/shell';

/**
 * The participant's singleton WS store. The `createDefaultWsStore()`
 * factory call happens at module-load time (matching the moderator's
 * `useWsStore` shape) so the participant has exactly one store the
 * future `part_ws_client` plugs into via `createWsClient({ store: useWsStore, ... })`.
 */
export const useWsStore = createDefaultWsStore();
