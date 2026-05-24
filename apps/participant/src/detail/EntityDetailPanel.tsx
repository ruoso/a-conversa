// `<EntityDetailPanel>` — fixed-width right sidebar panel rendering the
// per-entity drill-down detail for whatever node / edge the debater has
// tapped on the participant's Cytoscape canvas.
//
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel.md
//              (Closes the `part_graph_view` subgroup by absorbing the
//              per-facet / per-axiom / per-annotation / per-diagnostic
//              / per-vote drill-down detail every prior overlay leaf
//              deferred to "the future entity detail panel". v0 ships
//              eight content sections + the empty-state body + the
//              stale-entity branch + an action-slot reservation for the
//              future voting / axiom-mark leaves.)
//
// Refinement: tasks/refinements/shell-package/extract_facet_pill.md —
// discharged the predecessor's Decision §6 deferral by lifting
// `<FacetPill>` + `PILL_*_CLASSNAME` into `@a-conversa/shell` and
// dropping the participant → moderator workspace edge.
//
// ADRs:
//   - 0003 (React);
//   - 0005 (Tailwind utility classes);
//   - 0022 (no throwaway verifications — every section + branch below
//           is pinned by `EntityDetailPanel.test.tsx`);
//   - 0024 (react-i18next — the panel's section headings + empty-state
//           body + per-kind labels go through `useTranslation()`);
//   - 0026 (the panel is participant-workspace-only; no shell export
//           until the audience surface adds a third caller);
//   - 0027 (entity / facet layers stay strictly separate — the identity
//           header carries entity-layer attributes, the per-facet pill
//           row carries facet-layer attributes).
//
// Component shape:
//
//   1. Subscribes to `useSelectionStore((s) => s.selected)` directly
//      (Decision §3 — store-state-via-subscription, NOT prop-thread; the
//      panel is the selection consumer; the route is the layout
//      composer).
//   2. Resolves the selection to an entity via `lookupEntity(...)`.
//      Three exit states:
//        a. `selected === null` → render the empty-state body.
//        b. `selected !== null && entity === null` → render the stale-
//           entity body AND auto-clear the selection on the next tick
//           (Decision §10).
//        c. otherwise → render the 8-section detail body.
//   3. The 8 sections each conditionally render — missing data omits
//      the entire section (no empty containers, mirroring the moderator
//      `<FacetPill>` row + axiom-mark badge conventions).
//   4. The optional `actionSlot` prop renders at the bottom of the
//      panel when provided; future voting / axiom-mark leaves fill it
//      without re-shaping the panel's data flow (Decision §9 / §11).

import { memo, useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Event } from '@a-conversa/shared-types';

import { FacetPill, PILL_BASE_CLASSNAME, PILL_STATUS_CLASSNAME } from '@a-conversa/shell';
import type { Annotation } from '../graph/annotations';
import type { AxiomMark } from '../graph/axiomMarks';
import type { FacetName, FacetStatus, FacetStatusIndex } from '../graph/facetStatus';
import type { OwnVoteIndex } from '../graph/ownVotes';
import type { OthersVoteIndex } from '../graph/otherVotes';
import type { ParticipantEdgeData, ParticipantNodeData } from '../graph/projectGraph';
import { useSelectionStore, type Selection } from '../stores/selectionStore';

import { lookupEntity } from './lookupEntity';
import {
  EMPTY_PARTICIPANT_ROSTER,
  participantRosterFrom,
  screenNameFor,
} from './participantRoster';
import { ParticipantVoteButtons } from './ParticipantVoteButtons';

/**
 * Per-facet wire arms surfaced in the own-vote summary. `'agree'` /
 * `'dispute'` / `'withdraw'` mirror the wire `vote` enum verbatim — the
 * panel's own-vote summary shows the per-facet ARM (NOT the dispute-wins
 * rollup the canvas paints), so the `'withdraw'` arm IS surfaced here
 * (the canvas collapses `'withdraw'` to the `'none'` indicator per the
 * predecessor leaf; the panel surfaces the explicit arm). The `'none'`
 * arm here means "no vote on this facet by the current participant"
 * — used as the absence sentinel below.
 */
type OwnFacetVote = 'agree' | 'dispute' | 'withdraw';

/**
 * Per-facet own-vote breakdown for a single entity. Sparse — only
 * facets the current participant has voted on appear. Empty when the
 * debater hasn't voted on any facet of this entity (the section is
 * omitted in that case).
 */
type OwnFacetVoteMap = Partial<Record<FacetName, OwnFacetVote>>;

/**
 * Derive the current participant's per-facet vote on a single entity,
 * walking the events log. Returns an empty record when the debater has
 * no recordable votes against this entity.
 *
 * Mirrors `projectOwnVotes`'s proposal-target + latest-vote-per-(proposal,
 * participant) discipline but RETAINS the per-facet detail (instead of
 * rolling up to a single per-entity `OwnVote`). The deferred "per-facet
 * own-vote breakdown" deferral from `part_own_vote_indicators` lands
 * here per the refinement's Decision §11. The walk is bounded — the
 * methodology caps the per-entity facet count to three for nodes and
 * one for edges, so the output map is at most three entries.
 *
 * Inline in the panel (rather than promoted to `apps/participant/src/graph/`)
 * because the per-facet detail is a panel-only consumer at v0; if a
 * future leaf (a per-facet vote button row, perhaps) needs the same
 * shape, the walk lifts cleanly. Following the prior leaves' YAGNI
 * extraction posture — "promote on the third caller".
 */
function deriveOwnFacetVotes(
  events: readonly Event[],
  currentParticipantId: string,
  entityId: string,
): OwnFacetVoteMap {
  // proposal envelope id → (entityId, facet) target for facet-targeting
  // proposals that reference THIS entity.
  const proposalTarget = new Map<string, FacetName>();
  // Per-facet latest vote arm (last-write-wins per (proposal, participant)).
  const perFacet = new Map<FacetName, OwnFacetVote>();
  for (const event of events) {
    if (event.kind === 'proposal') {
      const proposal = event.payload.proposal;
      const target = ((): { entityId: string; facet: FacetName } | null => {
        switch (proposal.kind) {
          case 'classify-node':
            return { entityId: proposal.node_id, facet: 'classification' };
          case 'set-node-substance':
            return { entityId: proposal.node_id, facet: 'substance' };
          case 'set-edge-substance':
            return { entityId: proposal.edge_id, facet: 'substance' };
          case 'edit-wording':
          case 'amend-node':
            return { entityId: proposal.node_id, facet: 'wording' };
          default:
            return null;
        }
      })();
      if (target === null) continue;
      if (target.entityId !== entityId) continue;
      proposalTarget.set(event.id, target.facet);
      continue;
    }
    if (event.kind === 'vote') {
      // Per ADR 0030 §2: vote payloads are a `target`-discriminated
      // union. The facet-keyed arm carries `(entity_kind, entity_id,
      // facet)` directly; the proposal-keyed arm looks up the facet
      // via `proposalTarget` (which only records facet-targeting
      // proposals against THIS entity, so structural-arm votes are
      // skipped — their proposal id isn't in the map).
      if (event.payload.participant !== currentParticipantId) continue;
      let facet: FacetName | undefined;
      if (event.payload.target === 'facet') {
        if (event.payload.entity_id !== entityId) continue;
        // Per `pf_shape_facet_wire_vote` the wire-level `FacetName`
        // includes `'shape'`; the participant detail panel does not
        // surface a shape-facet row today (the local `FacetName`
        // mirror stays 3-valued — see `apps/participant/src/graph/facetStatus.ts`),
        // so shape-facet votes are skipped here. A future
        // `pf_part_detail_panel_shape_facet_row` task closes the
        // guard.
        if (event.payload.facet === 'shape') continue;
        facet = event.payload.facet;
      } else {
        facet = proposalTarget.get(event.payload.proposal_id);
      }
      if (facet === undefined) continue;
      perFacet.set(facet, event.payload.choice);
    }
  }
  const out: OwnFacetVoteMap = {};
  for (const [facet, arm] of perFacet) {
    out[facet] = arm;
  }
  return out;
}

/**
 * Tailwind class for the rollup-status badge. Reuses the moderator's
 * `PILL_*_CLASSNAME` palette per Decision §2 / §6 so the cross-surface
 * status vocabulary stays in lockstep. The status sentinel `'none'`
 * (the projector's "no per-facet record" floor) hits no class and the
 * badge renders unstyled — but the panel suppresses the badge entirely
 * in that case (no rollup, no badge; per the moderator's
 * `ProposalFacetBreakdown` empty-row posture).
 */
function rollupBadgeClassName(status: FacetStatus): string {
  return `${PILL_BASE_CLASSNAME} ${PILL_STATUS_CLASSNAME[status]}`;
}

/**
 * Three facet names a node can carry (`classification`, `substance`,
 * `wording`); only `substance` is meaningful for edges today. The order
 * matches the moderator's in-card pill row layout for cross-surface
 * familiarity.
 */
const NODE_FACET_NAMES: readonly FacetName[] = ['classification', 'substance', 'wording'];
const EDGE_FACET_NAMES: readonly FacetName[] = ['substance'];

export interface EntityDetailPanelProps {
  readonly projectedNodes: readonly ParticipantNodeData[];
  readonly projectedEdges: readonly ParticipantEdgeData[];
  readonly events: readonly Event[];
  readonly currentParticipantId: string;
  readonly nodeAxiomMarkIndex: ReadonlyMap<string, readonly AxiomMark[]>;
  readonly nodeAnnotationIndex: ReadonlyMap<string, readonly Annotation[]>;
  readonly edgeAnnotationIndex: ReadonlyMap<string, readonly Annotation[]>;
  /**
   * Per-entity own-vote rollup the canvas also reads. The panel surfaces
   * the per-entity dispute-wins rollup as the "Your vote" badge header;
   * the per-facet detail under the header is re-derived from `events`
   * via `deriveOwnFacetVotes` because the index carries only the
   * rolled-up signal (Decision §11).
   */
  readonly ownVoteIndex: OwnVoteIndex;
  readonly othersVoteIndex: OthersVoteIndex;
  /**
   * Per-entity per-facet status index from `computeFacetStatuses`.
   * Threaded through to the always-on `<ParticipantVoteButtons>` row
   * block (per `pf_part_detail_panel_three_facet_rows` /
   * [ADR 0030 §10](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md))
   * so each per-facet row picks its render branch from the projected
   * status. Optional with an undefined default so older render paths
   * (test fixtures predating the always-on shape) compile; when
   * undefined the row block falls back to `'awaiting-proposal'` for
   * every facet.
   */
  readonly facetStatusIndex?: FacetStatusIndex;
  /**
   * Reserved for future voting / axiom-mark leaves per Decision §9 /
   * §11. Renders at the bottom of the panel when provided; the panel
   * makes no assumption about the slot's contents.
   *
   * Per `pf_part_detail_panel_three_facet_rows` the per-facet row
   * block (`<ParticipantVoteButtons>`) moved out of the actionSlot
   * and into the panel body — the rows are part of the panel's
   * always-on shape per ADR 0030 §10, not an opt-in action. The
   * actionSlot now hosts the axiom-mark button only.
   */
  readonly actionSlot?: ReactNode;
}

/**
 * Stable empty `FacetStatusIndex` used as the panel-level fallback
 * when no projection result has been threaded through (legacy test
 * fixtures + the route's first render). Re-using one frozen instance
 * across re-renders keeps the always-on row block's memo bailout
 * meaningful (the row block reads the index by reference).
 */
const EMPTY_FACET_STATUS_INDEX: FacetStatusIndex = {
  nodes: new Map(),
  edges: new Map(),
};

function EntityDetailPanelImpl(props: EntityDetailPanelProps): ReactElement {
  const {
    projectedNodes,
    projectedEdges,
    events,
    currentParticipantId,
    nodeAxiomMarkIndex,
    nodeAnnotationIndex,
    edgeAnnotationIndex,
    ownVoteIndex,
    othersVoteIndex,
    facetStatusIndex,
    actionSlot,
  } = props;
  const { t } = useTranslation();
  const selected = useSelectionStore((s) => s.selected);

  // Resolve the selection to an entity. `lookupEntity` discriminates on
  // `selected.kind` so the `entity` return is typed by the discriminated
  // union of `ParticipantNodeData | ParticipantEdgeData | null`.
  const entity = useMemo(
    () => lookupEntity(projectedNodes, projectedEdges, selected),
    [projectedNodes, projectedEdges, selected],
  );

  // Per-session participant roster. Once per `events` change — same
  // memoization rationale as the route-hoisted projection memos.
  const roster = useMemo(() => participantRosterFrom(events), [events]);

  // Auto-clear the selection on the stale-entity branch (Decision §10).
  // The cycle is intentional: tick 1 renders the explanatory body so the
  // debater notices the staleness; tick 2 (after the `useEffect` calls
  // `clear()`) renders the empty-state body. The effect only fires when
  // the selection is non-null AND the lookup returned null — i.e.
  // staleness is the active branch.
  useEffect(() => {
    if (selected !== null && entity === null && selected.kind !== 'annotation') {
      useSelectionStore.getState().clear();
    }
  }, [selected, entity]);

  // Empty-state branch — no selection at all.
  if (selected === null) {
    return (
      <aside
        data-testid="participant-detail-panel"
        data-state="empty"
        className="w-80 shrink-0 border-l border-slate-200 bg-white overflow-y-auto p-4 text-sm"
      >
        <p data-testid="participant-detail-panel-empty-state" className="text-slate-500">
          {t('participant.detailPanel.emptyState')}
        </p>
      </aside>
    );
  }

  // Stale-entity branch — selection points at an id no current element
  // matches. Decision §10 — render the explanatory body; `useEffect`
  // above clears the selection on the next tick.
  if (entity === null) {
    return (
      <aside
        data-testid="participant-detail-panel"
        data-state="stale"
        className="w-80 shrink-0 border-l border-slate-200 bg-white overflow-y-auto p-4 text-sm"
      >
        <p data-testid="participant-detail-panel-stale-entity" className="text-slate-500">
          {t('participant.detailPanel.staleEntity')}
        </p>
      </aside>
    );
  }

  // The detail body. Discriminate on `selected.kind` for the identity
  // header text. The 8 content sections below each render conditionally
  // — no empty containers, mirroring the moderator's "absent → omit
  // entirely" row posture.
  const isNode = selected.kind === 'node';
  const identityLabel = isNode
    ? t('participant.detailPanel.identity.node')
    : t('participant.detailPanel.identity.edge');
  const wordingOrLabel = isNode
    ? (entity as ParticipantNodeData).wording
    : t(`methodology.edgeRole.${(entity as ParticipantEdgeData).role}.label`);

  return (
    <aside
      data-testid="participant-detail-panel"
      data-state="detail"
      data-entity-kind={selected.kind}
      data-entity-id={entity.id}
      className="w-80 shrink-0 border-l border-slate-200 bg-white overflow-y-auto p-4 text-sm flex flex-col gap-4"
    >
      <IdentitySection
        kind={selected.kind as 'node' | 'edge'}
        kindLabel={identityLabel}
        wording={wordingOrLabel}
        entityId={entity.id}
      />
      <RollupStatusSection rollupStatus={entity.rollupStatus} />
      <FacetPillRowSection
        kind={selected.kind as 'node' | 'edge'}
        facetStatuses={entity.facetStatuses}
      />
      {isNode ? (
        <AxiomMarkAttributionSection
          marks={nodeAxiomMarkIndex.get(entity.id) ?? []}
          roster={roster}
          sectionHeading={t('participant.detailPanel.sectionTitle.axiomMarks')}
        />
      ) : null}
      <AnnotationsSection
        annotations={
          isNode
            ? (nodeAnnotationIndex.get(entity.id) ?? [])
            : (edgeAnnotationIndex.get(entity.id) ?? [])
        }
        roster={roster}
        sectionHeading={t('participant.detailPanel.sectionTitle.annotations')}
        annotationKindLabel={(kind) => t(`methodology.annotationKind.${kind}`)}
      />
      <DiagnosticsSection
        highlight={entity.diagnosticHighlight}
        sectionHeading={t('participant.detailPanel.sectionTitle.diagnostics')}
      />
      <OwnVoteSection
        events={events}
        currentParticipantId={currentParticipantId}
        entityId={entity.id}
        ownVoteIndex={ownVoteIndex}
        kind={selected.kind as 'node' | 'edge'}
        sectionHeading={t('participant.detailPanel.sectionTitle.ownVote')}
        facetLabel={(facet) => t(`methodology.facet.${facet}`)}
        voteArmLabel={(arm) => t(`methodology.voteChoice.${arm}`)}
      />
      <OtherVotersSection
        votes={
          isNode
            ? (othersVoteIndex.nodes.get(entity.id) ?? [])
            : (othersVoteIndex.edges.get(entity.id) ?? [])
        }
        roster={roster}
        sectionHeading={t('participant.detailPanel.sectionTitle.otherVotes')}
        voteArmLabel={(arm) => t(`methodology.voteChoice.${arm}`)}
      />
      {/* Always-on per-facet row block per ADR 0030 §10 +
       * `pf_part_detail_panel_three_facet_rows`: nodes render three
       * rows (wording / classification / substance); edges render two
       * (shape / substance). Each row's content depends on the
       * facet's derived status; rendered for both `node` and `edge`
       * selections (the row block component picks the facet catalog
       * off `entityKind`). */}
      <ParticipantVoteButtons
        events={events}
        entityKind={selected.kind}
        entityId={entity.id}
        facetStatusIndex={facetStatusIndex ?? EMPTY_FACET_STATUS_INDEX}
        currentParticipantId={currentParticipantId}
      />
      {actionSlot !== undefined ? (
        <div data-testid="participant-detail-panel-action-slot">{actionSlot}</div>
      ) : null}
    </aside>
  );
}

/**
 * Identity header — section 1. Carries entity kind label + the wording
 * (or edge role label) + the entity id (the id is shown small + muted
 * for cross-reference / debugging; the wording is the primary read).
 */
function IdentitySection(props: {
  kind: 'node' | 'edge';
  kindLabel: string;
  wording: string;
  entityId: string;
}): ReactElement {
  return (
    <section data-testid="participant-detail-panel-identity">
      <p className="text-xs uppercase tracking-wide text-slate-500">{props.kindLabel}</p>
      <p
        data-testid="participant-detail-panel-identity-wording"
        className="text-base text-slate-900"
      >
        {props.wording}
      </p>
      <p
        data-testid="participant-detail-panel-identity-id"
        className="text-[10px] text-slate-400 font-mono"
      >
        {props.entityId}
      </p>
    </section>
  );
}

/**
 * Rollup status badge — section 2. Suppressed when the rollup is
 * `'none'` (the projector's "no per-facet record" floor); otherwise
 * renders the moderator's pill-style chip with the facet-state label.
 */
function RollupStatusSection(props: { rollupStatus: FacetStatus | 'none' }): ReactElement | null {
  const { t } = useTranslation();
  if (props.rollupStatus === 'none') return null;
  return (
    <section data-testid="participant-detail-panel-rollup">
      <span
        data-testid="participant-detail-panel-rollup-badge"
        data-rollup-status={props.rollupStatus}
        className={rollupBadgeClassName(props.rollupStatus)}
      >
        {t(`methodology.facetState.${props.rollupStatus}`)}
      </span>
    </section>
  );
}

/**
 * Per-facet pill row — section 3. Renders one `<FacetPill>` per facet
 * the entity has status for. Suppressed entirely when no facet has a
 * recorded status (no row, no header — same empty-omit posture as the
 * moderator's in-card pill row).
 */
function FacetPillRowSection(props: {
  kind: 'node' | 'edge';
  facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>;
}): ReactElement | null {
  const { t } = useTranslation();
  const facetNames = props.kind === 'node' ? NODE_FACET_NAMES : EDGE_FACET_NAMES;
  const presentFacets = facetNames.filter((facet) => props.facetStatuses[facet] !== undefined);
  if (presentFacets.length === 0) return null;
  return (
    <section data-testid="participant-detail-panel-facets">
      <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1">
        {t('participant.detailPanel.sectionTitle.facets')}
      </h3>
      <div
        data-testid="participant-detail-panel-facet-pill-row"
        className="flex flex-wrap items-center gap-1"
      >
        {presentFacets.map((facet) => {
          const status = props.facetStatuses[facet];
          if (status === undefined) return null;
          return <FacetPill key={facet} facet={facet} status={status} />;
        })}
      </div>
    </section>
  );
}

/**
 * Axiom-mark attribution — section 4. Textual comma-separated screen
 * names per Decision §6 (the chromatic badge is the future polish
 * deferral). Suppressed when no participant has marked this node as
 * bedrock.
 */
function AxiomMarkAttributionSection(props: {
  marks: readonly AxiomMark[];
  roster: ReadonlyMap<string, string>;
  sectionHeading: string;
}): ReactElement | null {
  if (props.marks.length === 0) return null;
  // Dedup by participant id (a participant may have arrived at the
  // axiom mark through multiple proposal envelopes — only the most
  // recent is the active mark; the panel surfaces ONE name per
  // participant). Preserve first-encounter order.
  const seen = new Set<string>();
  const names: string[] = [];
  for (const mark of props.marks) {
    if (seen.has(mark.participantId)) continue;
    seen.add(mark.participantId);
    names.push(screenNameFor(props.roster, mark.participantId));
  }
  return (
    <section data-testid="participant-detail-panel-axiom-marks">
      <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1">
        {props.sectionHeading}
      </h3>
      <p
        data-testid="participant-detail-panel-axiom-mark-attribution"
        className="text-sm text-slate-700"
      >
        {names.join(', ')}
      </p>
    </section>
  );
}

/**
 * Annotations list — section 5. One row per annotation with kind label
 * + content text + author screen name. Suppressed when no annotations
 * target the entity.
 */
function AnnotationsSection(props: {
  annotations: readonly Annotation[];
  roster: ReadonlyMap<string, string>;
  sectionHeading: string;
  annotationKindLabel: (kind: string) => string;
}): ReactElement | null {
  if (props.annotations.length === 0) return null;
  return (
    <section data-testid="participant-detail-panel-annotations">
      <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1">
        {props.sectionHeading}
      </h3>
      <ul className="space-y-2">
        {props.annotations.map((annotation) => (
          <li
            key={annotation.id}
            data-testid="participant-detail-panel-annotation-row"
            data-annotation-id={annotation.id}
            data-annotation-kind={annotation.kind}
            className="rounded border border-slate-200 p-2"
          >
            <p className="text-[10px] uppercase tracking-wide text-amber-700">
              {props.annotationKindLabel(annotation.kind)}
            </p>
            <p className="text-sm text-slate-800">{annotation.content}</p>
            <p className="text-[10px] text-slate-500">
              {screenNameFor(props.roster, annotation.createdBy)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Diagnostic messages — section 6. One row per active kind with the
 * per-kind localized title + description + severity badge. Suppressed
 * when no active diagnostic touches the entity.
 */
function DiagnosticsSection(props: {
  highlight: ParticipantNodeData['diagnosticHighlight'];
  sectionHeading: string;
}): ReactElement | null {
  const { t } = useTranslation();
  if (props.highlight === null) return null;
  return (
    <section data-testid="participant-detail-panel-diagnostics">
      <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1">
        {props.sectionHeading}
      </h3>
      <ul className="space-y-2">
        {props.highlight.kinds.map((kind) => (
          <li
            key={kind}
            data-testid="participant-detail-panel-diagnostic-row"
            data-diagnostic-kind={kind}
            data-diagnostic-severity={props.highlight?.severity ?? 'none'}
            className="rounded border border-amber-300 bg-amber-50 p-2"
          >
            <p className="text-sm font-medium text-amber-900">
              {t(`diagnostics.${kind}.title`)}
              <span
                data-testid="participant-detail-panel-diagnostic-severity"
                className="ml-1 text-[10px] uppercase text-amber-700"
              >
                ({props.highlight?.severity})
              </span>
            </p>
            <p className="text-xs text-amber-800">
              {/* The description key carries ICU placeholders for several
               * kinds (e.g. `cycle` expects `{role}` + `{nodes}`); render
               * a no-arg interpolation and let any missing placeholders
               * fall through. The render is a "best effort" preview;
               * the canonical per-kind prose lives in the moderator's
               * diagnostic flag pane which has the full envelope payload
               * to interpolate from. */}
              {t(`diagnostics.${kind}.description`, { count: 1 })}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Own-vote summary — section 7. Per-facet table showing the debater's
 * own vote on each facet they've voted on. Suppressed when the per-
 * entity rollup is `'none'` (no votes by the current participant).
 *
 * The badge in the header surfaces the per-entity dispute-wins rollup
 * (matching the canvas signal); the per-facet rows beneath surface the
 * raw arm (`'agree'` / `'dispute'` / `'withdraw'`) so the debater can
 * read "I voted dispute on classification, agree on wording". The per-
 * facet detail is re-derived from `events` inline because `OwnVoteIndex`
 * carries only the rolled-up signal.
 */
function OwnVoteSection(props: {
  events: readonly Event[];
  currentParticipantId: string;
  entityId: string;
  ownVoteIndex: OwnVoteIndex;
  kind: 'node' | 'edge';
  sectionHeading: string;
  facetLabel: (facet: FacetName) => string;
  voteArmLabel: (arm: OwnFacetVote) => string;
}): ReactElement | null {
  const ownEntityVote =
    props.kind === 'node'
      ? props.ownVoteIndex.nodes.get(props.entityId)
      : props.ownVoteIndex.edges.get(props.entityId);
  const perFacet = useMemo(
    () => deriveOwnFacetVotes(props.events, props.currentParticipantId, props.entityId),
    [props.events, props.currentParticipantId, props.entityId],
  );
  const facetEntries = Object.entries(perFacet) as Array<[FacetName, OwnFacetVote]>;
  if (ownEntityVote === undefined && facetEntries.length === 0) return null;
  return (
    <section data-testid="participant-detail-panel-own-vote">
      <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1">
        {props.sectionHeading}
      </h3>
      <ul className="space-y-1">
        {facetEntries.map(([facet, arm]) => (
          <li
            key={facet}
            data-testid="participant-detail-panel-own-vote-row"
            data-facet={facet}
            data-vote-arm={arm}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-slate-600">{props.facetLabel(facet)}</span>
            <span className="text-slate-900">{props.voteArmLabel(arm)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Other voters' table — section 8. One row per `OtherVote` in the
 * per-entity bucket with the voter's resolved screen name + their per-
 * entity vote arm. Suppressed when no other participant has voted.
 */
function OtherVotersSection(props: {
  votes: ReadonlyArray<{ readonly participantId: string; readonly choice: 'agree' | 'dispute' }>;
  roster: ReadonlyMap<string, string>;
  sectionHeading: string;
  voteArmLabel: (arm: 'agree' | 'dispute') => string;
}): ReactElement | null {
  if (props.votes.length === 0) return null;
  return (
    <section data-testid="participant-detail-panel-other-voters">
      <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1">
        {props.sectionHeading}
      </h3>
      <ul className="space-y-1">
        {props.votes.map((vote) => (
          <li
            key={vote.participantId}
            data-testid="participant-detail-panel-other-vote-row"
            data-voter-id={vote.participantId}
            data-vote-arm={vote.choice}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-slate-600">
              {screenNameFor(props.roster, vote.participantId)}
            </span>
            <span className="text-slate-900">{props.voteArmLabel(vote.choice)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Memo'd panel — the panel's render only changes when the selection
 * changes OR when any of the projection outputs change. The route's
 * hoisted memos keep the inputs reference-stable across re-renders so
 * the memo bailout is meaningful.
 */
export const EntityDetailPanel = memo(EntityDetailPanelImpl);

// Re-export the helper symbols so consumers reading `from './'` get the
// full panel surface in one import. The barrel `index.ts` re-exports
// these for the route consumer.
export type { Selection };
export { EMPTY_PARTICIPANT_ROSTER };
