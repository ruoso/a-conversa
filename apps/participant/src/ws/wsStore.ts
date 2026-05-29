// `useWsStore` — participant-side WS-fed Zustand singleton.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md +
//   tasks/refinements/participant-ui/part_diagnostic_highlights.md +
//   tasks/refinements/shell-package/shell_diagnostic_highlights_extract.md
//   (Decision §3 — wraps the shell's bare
//   `createDefaultWsStoreInitializer()` with the participant's per-app
//   `withDevtools` middleware. Decision §4 — `activeDiagnostics` is now
//   canonical on `BaseWsSessionState`; the participant no longer carries
//   its own widening + `applyDiagnostic` override.)
//
// The store conforms to `BaseWsStoreState`; `WsSessionState` /
// `WsState` are kept as participant-local type aliases so existing
// in-workspace imports keep resolving without touching call-sites.

import { create } from 'zustand';
import {
  createDefaultWsStoreInitializer,
  type BaseWsSessionState,
  type BaseWsStoreState,
} from '@a-conversa/shell';

import { withDevtools } from '../stores/devtools';

/**
 * Re-export the shell's `WsConnectionStatus` under the participant's
 * historical name so internal imports continue to resolve.
 */
export type { WsConnectionStatus } from '@a-conversa/shell';

/**
 * Alias of `BaseWsSessionState` retained as a participant-local name
 * for call-site stability. The shell's base now canonically carries
 * `activeDiagnostics`, so the participant no longer widens.
 */
export type WsSessionState = BaseWsSessionState;

/**
 * Alias of `BaseWsStoreState` retained as a participant-local name for
 * call-site stability.
 */
export type WsState = BaseWsStoreState;

/**
 * The participant's singleton WS store.
 */
export const useWsStore = create<BaseWsStoreState>()(
  withDevtools('participant/ws', createDefaultWsStoreInitializer()),
);
