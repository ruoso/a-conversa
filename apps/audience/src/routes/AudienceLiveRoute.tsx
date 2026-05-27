// `<AudienceLiveRoute>` — the audience surface's live broadcast route
// at `/sessions/:sessionId` (and its locale-prefixed sibling
// `/:locale/sessions/:sessionId`) under the surface's `/a` basename.
//
// Refinement: tasks/refinements/audience/aud_session_url.md
//   (Decision §1 — `useParams` for the session-id read inside the
//   route, NOT the parallel `useAudienceSessionId()` state-layer hook;
//   Decision §3 — `useWsClient` consumed directly from `@a-conversa/shell`
//   so the audience workspace barrel stays read-only per `aud_ws_client.md`
//   Decision §6; route lifecycle contract — `trackSession` on mount, no
//   `untrackSession` on cleanup because a session change means a
//   navigation to a new URL which remounts the route and the WS
//   provider's reset-on-unmount handles the cleanup at the surface
//   boundary.)
// ADRs:
//   - 0026 (host owns auth chrome; surface consumes `useWsClient()`
//           from the shell; no surface-local WS client construction);
//   - 0029 (anonymous-WS subscribe for public sessions — the
//           `trackSession` call this route emits is identical for
//           authenticated and anonymous visitors; the server-side
//           discrimination via `canSeeSessionAnonymously` gates the
//           subscribe outcome).
//
// Broadcast-clean: the route body is the graph component, nothing else.
// No roster overlay, no connection-status chip, no debug chrome — the
// audience is a broadcast surface (the moderator + participant own the
// lobby chrome).

import { useEffect, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { useWsClient } from '@a-conversa/shell';

import { AudienceGraphView } from '../graph/GraphView.js';

export function AudienceLiveRoute(): ReactElement {
  const { sessionId } = useParams<{ sessionId: string }>();
  const wsClient = useWsClient();

  useEffect(() => {
    if (sessionId === undefined || sessionId === '') return;
    void wsClient.trackSession(sessionId);
  }, [sessionId, wsClient]);

  // The host wraps every surface in `<div className="min-h-screen">`
  // (apps/root/src/surfaces/SurfaceHost.tsx). `min-height` does not
  // establish a definite parent height for the graph-root's `h-full`
  // percentage, so without an explicit-height wrapper the canvas
  // collapses to 0×0 and the OBS-tier viewport-fill assertion fails.
  // `h-screen w-screen` is safe against scrollbar-reserved space
  // because `apps/audience/src/index.css` pins `body { overflow: hidden }`
  // (`aud_obs_sizing_defaults`).
  return (
    <div className="h-screen w-screen">
      <AudienceGraphView />
    </div>
  );
}
