// `useWsStore` — moderator-side server-state Zustand slice fed by the
// shell's WebSocket client.
//
// Refinement: tasks/refinements/moderator-ui/mod_ws_client.md +
//   tasks/refinements/shell-package/shell_substrate_extraction.md +
//   tasks/refinements/shell-package/shell_diagnostic_highlights_extract.md
//   (Decision §3 — wraps the shell's bare `createDefaultWsStoreInitializer()`
//   with the moderator's per-app `withDevtools` middleware. Decision §4 —
//   `activeDiagnostics` is now canonical on `BaseWsSessionState`; the
//   moderator no longer carries its own widening + `applyDiagnostic`
//   override.)
//
// The store conforms to `BaseWsStoreState`; `WsSessionState` /
// `WsState` are kept as moderator-local type aliases so existing
// in-workspace imports (selectors, panes) keep resolving without
// touching call-sites.

import { create } from 'zustand';
import {
  createDefaultWsStoreInitializer,
  type BaseWsSessionState,
  type BaseWsStoreState,
} from '@a-conversa/shell';

import { withDevtools } from '../stores/devtools.js';

/**
 * Re-export the shell's `WsConnectionStatus` under the moderator's
 * historical name so internal imports continue to resolve.
 */
export type { WsConnectionStatus } from '@a-conversa/shell';

/**
 * Alias of `BaseWsSessionState` retained as a moderator-local name for
 * call-site stability. The shell's base now canonically carries
 * `activeDiagnostics`, so the moderator no longer widens.
 */
export type WsSessionState = BaseWsSessionState;

/**
 * Alias of `BaseWsStoreState` retained as a moderator-local name for
 * call-site stability.
 */
export type WsState = BaseWsStoreState;

export const useWsStore = create<BaseWsStoreState>()(
  withDevtools('moderator/ws', createDefaultWsStoreInitializer()),
);
