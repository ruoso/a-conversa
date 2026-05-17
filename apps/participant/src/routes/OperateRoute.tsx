// `<OperateRoute>` — the participant's read-mostly live-debate
// surface at `/sessions/:id` under the surface's `/p` basename.
//
// Refinement: tasks/refinements/participant-ui/part_graph_render.md
// Predecessor: tasks/refinements/participant-ui/part_lobby_view.md
//              (the lobby's per-session `client.trackSession(id)`
//              lifecycle is the canonical pattern this route mirrors;
//              the re-track on mount is idempotent per
//              `ws-client.test.ts:547`).
// ADRs:
//   - 0004 (Cytoscape.js for the read-mostly participant tablet — the
//           moderator's interactive-edit surface uses ReactFlow; the
//           read-mostly surfaces (participant tablet, audience, replay)
//           share the Cytoscape path);
//   - 0022 (no throwaway verifications — every testid below is pinned
//           by `OperateRoute.test.tsx` + `GraphView.test.tsx` + the
//           `participant-graph-render.spec.ts` Playwright scenario);
//   - 0024 (i18n via react-i18next — the not-authenticated guard
//           consumes the shared `participant.notAuthenticated.body`
//           key, same shape as the lobby's mid-mount guard);
//   - 0026 (host owns auth chrome; surface consumes `useAuth()` +
//           `useWsClient()` from the shell; no second auth fetch, no
//           surface-local WS client construction).
//
// Composition (per the refinement's "What this task is"):
//
//   - `<ParticipantLayout header={<ParticipantChrome />} main={<OperateRouteBody id={id} />}
//     footer={<ParticipantStatusIndicator />} />` — same shape every
//     other participant route uses (the chrome + footer are uniform
//     across routes per `part_landscape_layout` + `part_status_indicator`).
//   - The body owns the auth guard branch (belt-and-suspenders against
//     the mid-mount auth flip; mirrors the lobby + invite-acceptance
//     shape) and renders `<GraphView sessionId={id} />`.
//   - The route-level `useEffect` calls `void client.trackSession(id)`
//     on mount + `void client.untrackSession(id)` on cleanup.
//     Idempotent with the lobby's prior call (per ws-client.test.ts:547).

import { useEffect, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth, useWsClient } from '@a-conversa/shell';

import { ParticipantLayout } from '../layout/ParticipantLayout';
import { ParticipantChrome } from '../layout/ParticipantChrome';
import { ParticipantStatusIndicator } from '../layout/ParticipantStatusIndicator';
import { GraphView } from '../graph/GraphView';

export function OperateRoute(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const client = useWsClient();

  // Per-session subscription lifecycle. Idempotent with the lobby
  // route's prior `client.trackSession` call (per
  // `ws-client.test.ts:547`); the cleanup pairs trackSession with
  // untrackSession so the server's subscription registry stays clean.
  // Mirrors the lobby route's pattern at
  // `apps/participant/src/routes/LobbyRoute.tsx:207-213`.
  useEffect(() => {
    if (id === '') return;
    void client.trackSession(id);
    return () => {
      void client.untrackSession(id);
    };
  }, [client, id]);

  return (
    <ParticipantLayout
      header={<ParticipantChrome />}
      main={<OperateRouteBody id={id} />}
      footer={<ParticipantStatusIndicator />}
    />
  );
}

function OperateRouteBody({ id }: { id: string }): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();

  // Belt-and-suspenders mid-mount auth guard. The chrome's identity
  // row + the host's `SurfaceHost` cleanup are the primary defenses
  // against a status-flip; this branch keeps `.screenName` access safe
  // if React re-renders the body between the auth flip and the host's
  // tear-down (mirrors the lobby route's shape at
  // `apps/participant/src/routes/LobbyRoute.tsx:234-246`).
  if (auth.status !== 'authenticated' || auth.user === undefined) {
    return (
      <div
        data-testid="route-operate"
        data-state="not-authenticated"
        className="mx-auto max-w-2xl p-6"
      >
        <p data-testid="participant-not-authenticated" className="text-sm text-slate-600">
          {t('participant.notAuthenticated.body')}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="route-operate" className="h-full w-full">
      <GraphView sessionId={id} currentParticipantId={auth.user.userId} />
    </div>
  );
}
