// `audienceWsStore` — audience-side WS-fed Zustand singleton.
//
// Refinement: tasks/refinements/audience/aud_ws_client.md +
//   tasks/refinements/shell-package/shell_diagnostic_highlights_extract.md
//   (Decision §3 / §4 — the audience returns to a one-line re-export of
//   the shell's `createDefaultWsStore()` now that `activeDiagnostics`
//   is canonical on `BaseWsSessionState`. The audience does not wire
//   `withDevtools` — read-only broadcast viewers don't surface the
//   dev-build redux-devtools session.)
//
// The selector hooks (`useAudienceActiveDiagnostics`,
// `useAudienceConnectionStatus`, `useAudienceSessionEvents`) read off
// the shell-canonical session shape; no audience-local widening.

import { createDefaultWsStore } from '@a-conversa/shell';

export type { WsConnectionStatus } from '@a-conversa/shell';

export const audienceWsStore = createDefaultWsStore();
