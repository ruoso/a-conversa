// `<OperateRoute>` — the participant's read-mostly live-debate
// surface at `/sessions/:id` under the surface's `/p` basename.
//
// Refinement: tasks/refinements/participant-ui/part_graph_render.md
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel.md
//              (Decisions §1 + §2 — two-column flex layout hosting
//              `<GraphView>` (left, flex-1) + `<EntityDetailPanel>`
//              (right, fixed `w-80`); projection chain HOISTED from
//              `<GraphView>` to this route so BOTH children share the
//              memo outputs. The projection helpers stay where they
//              live in `apps/participant/src/graph/`; only the call
//              sites move to this route. The route reads `events` +
//              `activeDiagnostics` once and runs each projection ONCE
//              per WS frame.)
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
//     shape) and renders the two-column main: `<GraphView>` on the
//     left, `<EntityDetailPanel>` on the right.
//   - The route-level `useEffect` calls `void client.trackSession(id)`
//     on mount + `void client.untrackSession(id)` on cleanup.
//     Idempotent with the lobby's prior call (per ws-client.test.ts:547).

import { useEffect, useMemo, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { DiagnosticPayload, Event } from '@a-conversa/shared-types';

import { useAuth, useWsClient } from '@a-conversa/shell';

import { ParticipantLayout } from '../layout/ParticipantLayout';
import { ParticipantChrome } from '../layout/ParticipantChrome';
import { ParticipantStatusIndicator } from '../layout/ParticipantStatusIndicator';
import { GraphView } from '../graph/GraphView';
import { EntityDetailPanel } from '../detail';
import { ParticipantVoteButtons } from '../detail/ParticipantVoteButtons';
import { useSelectionStore } from '../stores/selectionStore';
import {
  groupAnnotationsByEdge,
  groupAnnotationsByNode,
  projectAnnotations,
} from '../graph/annotations';
import { groupAxiomMarksByNode, projectAxiomMarks } from '../graph/axiomMarks';
import { projectDiagnosticHighlights } from '../graph/diagnosticHighlights';
import { computeFacetStatuses } from '../graph/facetStatus';
import { projectOwnVotes } from '../graph/ownVotes';
import { projectOtherVotes } from '../graph/otherVotes';
import { projectGraph } from '../graph/projectGraph';
import { useWsStore } from '../ws/wsStore';

/**
 * Stable empty-events reference for the per-session selector. Zustand
 * bails out of re-renders when the selector return value is
 * referentially equal; minting a fresh `[]` inside the selector would
 * defeat the bailout and force a re-render on every store mutation.
 * Same idiom the moderator's `GraphCanvasPane` uses; moved up from
 * `<GraphView>` to the route per Decision §2 of
 * `part_entity_detail_panel` (the projection chain owns its inputs).
 */
const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

/**
 * Stable empty-`activeDiagnostics` reference for the per-session
 * selector. Mirrors the moderator's `EMPTY_*` idiom so the diagnostic-
 * highlight memo stays reference-stable when the per-session slice does
 * not yet exist. Moved up from `<GraphView>` with the projection-chain
 * hoist.
 */
const EMPTY_DIAGNOSTICS_MAP: ReadonlyMap<string, DiagnosticPayload> = Object.freeze(new Map());

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

  return <OperateRouteAuthenticatedBody id={id} currentParticipantId={auth.user.userId} />;
}

/**
 * The route's authenticated body. Hosts the projection chain + the
 * two-column flex layout per Decision §1 + §2 of
 * `part_entity_detail_panel`. Split out from the auth-guard branch so
 * the projection memos only run when the canvas + panel are actually
 * mounted (the guard branch is a sibling render path that does NOT
 * touch the event log).
 */
function OperateRouteAuthenticatedBody({
  id,
  currentParticipantId,
}: {
  id: string;
  currentParticipantId: string;
}): ReactElement {
  // Per-session WS event log. The selector's frozen empty-events
  // fallback keeps Zustand's reference-equality bailout stable when
  // the per-session slice has not yet landed.
  const events = useWsStore((state) => state.sessionState[id]?.events ?? EMPTY_EVENTS);
  const activeDiagnostics = useWsStore(
    (state) => state.sessionState[id]?.activeDiagnostics ?? EMPTY_DIAGNOSTICS_MAP,
  );

  // -----------------------------------------------------------------
  // Projection chain — hoisted from `<GraphView>` per Decision §2 of
  // `part_entity_detail_panel`. The eight memos below run once per
  // `events` (or `activeDiagnostics` / `currentParticipantId`) change;
  // both `<GraphView>` and `<EntityDetailPanel>` consume the SAME memo
  // outputs via prop-thread so the projector cost is paid ONCE per WS
  // frame, not twice. Each memo's purpose + mapping rationale is
  // documented in the relevant projection module's docstring; the
  // hoist preserves the per-memo identity by retaining the same
  // ordering + dep arrays the predecessor leaves established inside
  // `<GraphView>`.
  // -----------------------------------------------------------------

  const facetStatusIndex = useMemo(() => computeFacetStatuses(events), [events]);

  const axiomMarkIndex = useMemo(() => groupAxiomMarksByNode(projectAxiomMarks(events)), [events]);

  const annotations = useMemo(() => projectAnnotations(events), [events]);
  const nodeAnnotationIndex = useMemo(() => groupAnnotationsByNode(annotations), [annotations]);
  const edgeAnnotationIndex = useMemo(() => groupAnnotationsByEdge(annotations), [annotations]);

  const diagnosticHighlightIndex = useMemo(
    () => projectDiagnosticHighlights(activeDiagnostics),
    [activeDiagnostics],
  );

  const ownVoteIndex = useMemo(
    () => projectOwnVotes(events, currentParticipantId),
    [events, currentParticipantId],
  );

  const othersVoteIndex = useMemo(
    () => projectOtherVotes(events, currentParticipantId),
    [events, currentParticipantId],
  );

  // Final element projection — both children consume `nodes` + `edges`
  // verbatim from this output. `<GraphView>` re-wraps them as Cytoscape
  // `ElementDefinition`s; `<EntityDetailPanel>` reads the per-element
  // data objects directly via `lookupEntity`.
  const projected = useMemo(
    () =>
      projectGraph(
        events,
        facetStatusIndex,
        axiomMarkIndex,
        nodeAnnotationIndex,
        edgeAnnotationIndex,
        diagnosticHighlightIndex,
        ownVoteIndex,
        othersVoteIndex,
      ),
    [
      events,
      facetStatusIndex,
      axiomMarkIndex,
      nodeAnnotationIndex,
      edgeAnnotationIndex,
      diagnosticHighlightIndex,
      ownVoteIndex,
      othersVoteIndex,
    ],
  );

  // Pre-derived per-data lists for the panel — keeps the panel's prop
  // surface in terms of plain `ParticipantNodeData[]` / `ParticipantEdgeData[]`
  // (not the Cytoscape `ElementDefinition` wrapper), so the panel
  // stays decoupled from Cytoscape's element-descriptor shape.
  const panelNodes = useMemo(() => projected.nodes.map((node) => node.data), [projected]);
  const panelEdges = useMemo(() => projected.edges.map((edge) => edge.data), [projected]);

  // Selection drives the vote-buttons component's `(entityKind,
  // entityId)` bindings. Read here (not inside the slot factory) so
  // the slot rebinds only when the selection flips. The vote-buttons
  // component is responsible for the empty-state branch (no pending
  // proposals → renders nothing); we always pass it down when there's
  // a node/edge selection so the slot reservation stays alive.
  const selected = useSelectionStore((s) => s.selected);
  const voteSlot =
    selected !== null && (selected.kind === 'node' || selected.kind === 'edge') ? (
      <ParticipantVoteButtons events={events} entityKind={selected.kind} entityId={selected.id} />
    ) : undefined;

  return (
    <div data-testid="route-operate" className="flex h-full w-full">
      <div data-testid="route-operate-graph-region" className="flex-1 min-w-0">
        <GraphView
          sessionId={id}
          currentParticipantId={currentParticipantId}
          projectedNodes={projected.nodes}
          projectedEdges={projected.edges}
          facetStatusIndex={facetStatusIndex}
          axiomMarkIndex={axiomMarkIndex}
          nodeAnnotationIndex={nodeAnnotationIndex}
          edgeAnnotationIndex={edgeAnnotationIndex}
          diagnosticHighlightIndex={diagnosticHighlightIndex}
          ownVoteIndex={ownVoteIndex}
          othersVoteIndex={othersVoteIndex}
        />
      </div>
      <EntityDetailPanel
        projectedNodes={panelNodes}
        projectedEdges={panelEdges}
        events={events}
        currentParticipantId={currentParticipantId}
        nodeAxiomMarkIndex={axiomMarkIndex}
        nodeAnnotationIndex={nodeAnnotationIndex}
        edgeAnnotationIndex={edgeAnnotationIndex}
        ownVoteIndex={ownVoteIndex}
        othersVoteIndex={othersVoteIndex}
        actionSlot={voteSlot}
      />
    </div>
  );
}
