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

import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { DiagnosticPayload, Event } from '@a-conversa/shared-types';

import { useAuth, useWsClient } from '@a-conversa/shell';

import { ParticipantLayout } from '../layout/ParticipantLayout';
import { ParticipantChrome } from '../layout/ParticipantChrome';
import { ParticipantStatusIndicator } from '../layout/ParticipantStatusIndicator';
import { GraphView } from '../graph/GraphView';
import { EntityDetailPanel } from '../detail';
import { ParticipantAxiomMarkButton } from '../detail/ParticipantAxiomMarkButton';
import {
  MyAgreementsPane,
  PendingProposalsPane,
  PendingProposalsTabBar,
  useNewProposalArrival,
} from '../proposals';
import { useSelectionStore } from '../stores/selectionStore';
import { useUiStore } from '../stores/uiStore';
import { autoSelectionFromEvent } from '../graph/autoSelect';
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
import { projectGraph, EMPTY_FLASH_INDEX } from '../graph/projectGraph';
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

/**
 * Auto-select the entity that the latest proposal envelope is talking
 * about. Tracks the highest event `sequence` already processed in a
 * ref, walks any strictly-newer events on each `events` change, and
 * applies the most-recent proposal target (per `autoSelectionFromEvent`)
 * by writing into `useSelectionStore`.
 *
 * On the initial mount, the ref starts at `-Infinity` so the entire
 * event history is considered — the participant lands on the
 * conversation's most recent proposal target rather than on a blank
 * panel. Subsequent re-renders only walk the events newly appended to
 * the log; the ref bumps to the highest sequence seen so far.
 */
function useAutoSelectFromEvents(events: readonly Event[]): void {
  const select = useSelectionStore((s) => s.select);
  const lastSeenSequenceRef = useRef<number>(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    const lastSeen = lastSeenSequenceRef.current;
    let nextTarget: ReturnType<typeof autoSelectionFromEvent> = null;
    let maxSequence = lastSeen;
    for (const event of events) {
      if (event.sequence <= lastSeen) continue;
      const target = autoSelectionFromEvent(event);
      if (target !== null) nextTarget = target;
      if (event.sequence > maxSequence) maxSequence = event.sequence;
    }
    lastSeenSequenceRef.current = maxSequence;
    if (nextTarget !== null) {
      select(nextTarget);
    }
  }, [events, select]);
}

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

  // Auto-select the entity that the latest moderator (or participant)
  // proposal is "talking about", so the detail panel surfaces it
  // without the participant having to tap. Walks events strictly newer
  // than the last sequence we processed, applies the most-recent
  // proposal target (if any). See `autoSelectionFromEvent` for the
  // per-sub-kind target rules and the scope rationale (proposals
  // only — raw `node-created` / `edge-created` are deliberately
  // skipped so the seam test's "baseline → tap → flip" flow stays
  // intact).
  useAutoSelectFromEvents(events);

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

  // New-proposal-arrival flash (per `part_proposal_notification`).
  // Decision §1: single hook called once at the route — both the badge
  // and the graph read from its output. The flash window auto-clears
  // each entry after `FLASH_WINDOW_MS`; `activeFlashes` is keyed by
  // element id (the Cytoscape element id space) so `projectGraph`'s
  // `flashIndex` arg consumes it directly via `has(id)` semantics.
  const arrival = useNewProposalArrival(id);
  const flashIndex = useMemo<ReadonlyMap<string, true>>(() => {
    if (arrival.activeFlashes.size === 0) return EMPTY_FLASH_INDEX;
    const next = new Map<string, true>();
    for (const entry of arrival.activeFlashes.values()) {
      next.set(entry.elementId, true);
    }
    return next;
  }, [arrival.activeFlashes]);

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
        flashIndex,
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
      flashIndex,
    ],
  );

  // Pre-derived per-data lists for the panel — keeps the panel's prop
  // surface in terms of plain `ParticipantNodeData[]` / `ParticipantEdgeData[]`
  // (not the Cytoscape `ElementDefinition` wrapper), so the panel
  // stays decoupled from Cytoscape's element-descriptor shape.
  const panelNodes = useMemo(() => projected.nodes.map((node) => node.data), [projected]);
  const panelEdges = useMemo(() => projected.edges.map((edge) => edge.data), [projected]);

  // Selection drives the action-slot's axiom-mark button binding. Per
  // `pf_part_detail_panel_three_facet_rows` the per-facet vote rows
  // moved out of the action slot and into the panel body (always-on
  // shape per ADR 0030 §10); the action slot now hosts the axiom-mark
  // button only.
  //
  // The axiom-mark button is node-only (edges have no axiom-mark
  // semantic per `docs/methodology.md` §"Axioms / terminal values").
  // We pre-compute `alreadyMarked` here so the button can suppress
  // itself when the current participant already holds a committed
  // mark on this node (the panel's `axiomMarks` attribution section
  // surfaces the existing mark; no second affordance needed).
  const selected = useSelectionStore((s) => s.selected);
  const axiomMarkButton =
    selected !== null && selected.kind === 'node'
      ? (() => {
          const marks = axiomMarkIndex.get(selected.id) ?? [];
          const alreadyMarked = marks.some((mark) => mark.participantId === currentParticipantId);
          return (
            <ParticipantAxiomMarkButton
              nodeId={selected.id}
              currentParticipantId={currentParticipantId}
              alreadyMarked={alreadyMarked}
            />
          );
        })()
      : null;
  const actionSlot =
    axiomMarkButton !== null ? (
      <div className="flex flex-col gap-3">{axiomMarkButton}</div>
    ) : undefined;

  // Tab-seam introduced by `part_proposals_tab` (Decision §1: top-of-
  // main two-button switcher; §4: projection chain stays HOISTED here
  // regardless of foregrounded tab so the per-WS-frame projector cost
  // is paid once, not double on tab switch).
  const currentTab = useUiStore((s) => s.currentTab);

  return (
    <div data-testid="route-operate" className="flex h-full w-full flex-col">
      <PendingProposalsTabBar sessionId={id} isFlashing={arrival.isBadgeFlashing} />
      <div data-testid="route-operate-active-tab" className="flex flex-1 overflow-hidden">
        {currentTab === 'graph' ? (
          <div data-testid="route-operate-graph-region" className="flex h-full w-full flex-1">
            <div className="flex-1 min-w-0">
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
              facetStatusIndex={facetStatusIndex}
              actionSlot={actionSlot}
            />
          </div>
        ) : currentTab === 'my-agreements' ? (
          <MyAgreementsPane
            sessionId={id}
            currentParticipantId={currentParticipantId}
            facetStatusIndex={facetStatusIndex}
          />
        ) : (
          <PendingProposalsPane sessionId={id} currentParticipantId={currentParticipantId} />
        )}
      </div>
    </div>
  );
}
