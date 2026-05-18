// `audienceWsStore` — audience-side WS-fed Zustand singleton.
//
// Refinement: tasks/refinements/audience/aud_ws_client.md
//   (Decision §2 — use the shell's `createDefaultWsStore()` factory
//   output verbatim; no audience-specific projection requirement exists
//   yet. The future `aud_state_management` leaf may extend the store
//   with audience-specific projections if needed.)
// Refinement: tasks/refinements/participant-ui/part_state_management.md
//   (canonical precedent for a surface-local WS store; participant
//   extends `BaseWsStoreState` with `activeDiagnostics` per its own
//   diagnostic-highlight needs. The participant explicitly noted the
//   third caller — the audience — as the eventual extract trigger;
//   this file is that trigger, and it triggers by USING the shell's
//   default factory rather than re-extending.)
//
// The shell client (`createWsClient`) dispatches inbound envelopes into
// this store via the `WsStoreLike<BaseWsStoreState>` handle. Audience
// consumers read via the narrowed hooks `useAudienceSessionEvents` and
// `useAudienceConnectionStatus` from `./useAudienceSessionEvents.js`
// and `./useAudienceConnectionStatus.js`.

import { createDefaultWsStore } from '@a-conversa/shell';

/**
 * The audience's singleton WS store. Thin re-export of the shell's
 * `createDefaultWsStore()` factory — no per-surface extension today.
 * The future `aud_state_management` leaf may extend this slot if it
 * needs an audience-specific projection (mirroring the moderator's
 * `activeDiagnostics` map).
 */
export const audienceWsStore = createDefaultWsStore();
