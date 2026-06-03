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

import {
  AxiomMarkBadge,
  FacetPill,
  PILL_BASE_CLASSNAME,
  PILL_STATUS_CLASSNAME,
  type FacetName,
  type FacetStatus,
  type FacetStatusIndex,
} from '@a-conversa/shell';
import type { Annotation } from '../graph/annotations';
import type { AnnotationKind, EntityKind } from '@a-conversa/shared-types';
import type { AxiomMark } from '../graph/axiomMarks';
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
 * `'dispute'` mirror the wire `vote.choice` enum verbatim — per ADR
 * 0030 §3 + `pf_unit_test_audit` the legacy `'withdraw'` arm is retired
 * (withdrawal is its own first-class event kind, `withdraw-agreement`,
 * surfaced via the facet-status projection, not via this per-facet
 * own-vote row).
 */
type OwnFacetVote = 'agree' | 'dispute';

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
        // Per `pf_part_facet_name_widen_shape` the local `FacetName`
        // mirror is now 4-valued (matching the wire-level enum), so
        // shape-facet votes flow through this arm into the per-facet
        // own-vote map alongside the other three facets.
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
 * Per-voter per-facet vote breakdown for the OTHER voters on a single
 * entity. Mirrors `deriveOwnFacetVotes`'s proposal-target +
 * latest-vote-per-(proposal, participant) walk shape verbatim — but
 * with the inverse participant filter: votes by `currentParticipantId`
 * are silently dropped, votes by every OTHER participant accumulate
 * per-(voterId, facet) with last-write-wins semantics. The outer map's
 * iteration order is first-encounter (insertion) per voter.
 *
 * Returns a `Map<voterId, Partial<Record<FacetName, 'agree' | 'dispute'>>>`;
 * voters with no recordable facet votes against this entity are absent
 * from the map. Per Decision §3 of
 * `part_entity_detail_panel_per_facet_other_voter_breakdown` a voter
 * surfaced in the per-entity rollup list but absent from this map (a
 * transient projection / panel-memo divergence) renders an empty
 * per-facet sub-list rather than being suppressed.
 *
 * Inline in the panel (rather than promoted to `apps/participant/src/graph/`)
 * because the per-facet detail is a panel-only consumer at v0; same
 * "promote on the third caller" YAGNI extraction stance as
 * `deriveOwnFacetVotes`. The walk is bounded — events count × per-event
 * O(1) work — and only runs when the panel is mounted AND the selection
 * or `events` change.
 */
function deriveOtherFacetVotesByVoter(
  events: readonly Event[],
  currentParticipantId: string,
  entityId: string,
): ReadonlyMap<string, Partial<Record<FacetName, 'agree' | 'dispute'>>> {
  const proposalTarget = new Map<string, FacetName>();
  const perVoter = new Map<string, Map<FacetName, 'agree' | 'dispute'>>();
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
      const voterId = event.payload.participant;
      if (voterId === currentParticipantId) continue;
      let facet: FacetName | undefined;
      if (event.payload.target === 'facet') {
        if (event.payload.entity_id !== entityId) continue;
        facet = event.payload.facet;
      } else {
        facet = proposalTarget.get(event.payload.proposal_id);
      }
      if (facet === undefined) continue;
      let perFacet = perVoter.get(voterId);
      if (perFacet === undefined) {
        perFacet = new Map<FacetName, 'agree' | 'dispute'>();
        perVoter.set(voterId, perFacet);
      }
      perFacet.set(facet, event.payload.choice);
    }
  }
  const out = new Map<string, Partial<Record<FacetName, 'agree' | 'dispute'>>>();
  for (const [voterId, perFacet] of perVoter) {
    const record: Partial<Record<FacetName, 'agree' | 'dispute'>> = {};
    for (const [facet, arm] of perFacet) {
      record[facet] = arm;
    }
    out.set(voterId, record);
  }
  return out;
}

/**
 * Iteration order for the per-voter per-facet sub-rows in
 * `<OtherVotersSection>`. Walks all four `FacetName` values so a
 * voter's shape-facet entry (if present on an edge per ADR 0030) renders
 * alongside the other three; voters with no entry for a given facet
 * skip that row. Stable across voters within the same render per
 * Decision §5 of `part_entity_detail_panel_per_facet_other_voter_breakdown`.
 */
const PER_VOTER_FACET_ORDER: readonly FacetName[] = [
  'classification',
  'substance',
  'wording',
  'shape',
];

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
 * `wording`); the `<FacetPillRowSection>` surfaces the `substance` pill
 * only for edges today (the `shape` facet's status surfaces on the
 * always-on `<ParticipantVoteButtons>` shape row instead — the panel's
 * top pill row is not in scope of `pf_part_facet_name_widen_shape`;
 * adding a shape pill is a downstream UI polish task). The order
 * matches the moderator's in-card pill row layout for cross-surface
 * familiarity.
 *
 * Narrowed to `Exclude<FacetName, 'shape'>` to match `<FacetPill>`'s
 * 3-valued shell type (`packages/shell/src/facet-pill/types.ts`); the
 * pill row never carries shape, so the exclude is sound. Mirrors the
 * moderator-side `FACET_RENDER_ORDER` narrowing in
 * `apps/moderator/src/graph/StatementNode.tsx`.
 */
type PillFacetName = Exclude<FacetName, 'shape'>;
const NODE_FACET_NAMES: readonly PillFacetName[] = ['classification', 'substance', 'wording'];
const EDGE_FACET_NAMES: readonly PillFacetName[] = ['substance'];

export interface EntityDetailPanelProps {
  readonly projectedNodes: readonly ParticipantNodeData[];
  readonly projectedEdges: readonly ParticipantEdgeData[];
  readonly events: readonly Event[];
  readonly currentParticipantId: string;
  readonly nodeAxiomMarkIndex: ReadonlyMap<string, readonly AxiomMark[]>;
  readonly nodeAnnotationIndex: ReadonlyMap<string, readonly Annotation[]>;
  readonly edgeAnnotationIndex: ReadonlyMap<string, readonly Annotation[]>;
  /**
   * Flat list of every projected annotation. Threaded from the route's
   * `projectAnnotations(events)` memo per Decision §1 of
   * `part_entity_detail_panel_annotation_view` so the panel's
   * `selection.kind === 'annotation'` branch can resolve the selected
   * annotation by id. Optional with a frozen-empty default so legacy
   * test fixtures (predating the annotation-view branch) compile; when
   * absent the `'annotation'` arm of `lookupEntity` returns `null` and
   * the panel falls through to the stale-entity body.
   */
  readonly annotations?: readonly Annotation[];
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
  annotations: new Map(),
};

/**
 * Stable empty `Annotation[]` used as the panel-level fallback when no
 * `annotations` prop is threaded through (legacy test fixtures). Re-
 * using one frozen instance across re-renders keeps the panel's
 * `lookupEntity` memo bailout meaningful.
 */
const EMPTY_ANNOTATIONS: readonly Annotation[] = Object.freeze([]);

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
    annotations: annotationsProp,
  } = props;
  const annotations = annotationsProp ?? EMPTY_ANNOTATIONS;
  const { t } = useTranslation();
  const selected = useSelectionStore((s) => s.selected);

  // Resolve the selection to an entity. `lookupEntity` discriminates on
  // `selected.kind` so the `entity` return is typed by the discriminated
  // union of `ParticipantNodeData | ParticipantEdgeData | Annotation | null`.
  const entity = useMemo(
    () => lookupEntity(projectedNodes, projectedEdges, annotations, selected),
    [projectedNodes, projectedEdges, annotations, selected],
  );

  // Per-session participant roster. Once per `events` change — same
  // memoization rationale as the route-hoisted projection memos.
  const roster = useMemo(() => participantRosterFrom(events), [events]);

  // Per-voter per-facet other-vote map for the currently selected
  // node/edge entity. Once per `(events, currentParticipantId, entity)`
  // change; bypassed (empty map) when no node/edge entity is resolved so
  // the helper doesn't walk events for nothing. Threaded into
  // `<OtherVotersSection>` so each per-voter row carries a sub-list of
  // per-facet rows underneath the rollup arm — see
  // `part_entity_detail_panel_per_facet_other_voter_breakdown` Decision §1.
  //
  // Skipped when the selection is an annotation (the annotation body
  // does not render the other-voters section — annotations are entity-
  // layer methodology vocabulary, not vote targets per ADR 0027).
  const perVoterFacets = useMemo(
    () =>
      entity === null || selected?.kind === 'annotation'
        ? (new Map() as ReadonlyMap<string, Partial<Record<FacetName, 'agree' | 'dispute'>>>)
        : deriveOtherFacetVotesByVoter(events, currentParticipantId, entity.id),
    [events, currentParticipantId, entity, selected],
  );

  // Auto-clear the selection on the stale-entity branch (Decision §10).
  // The cycle is intentional: tick 1 renders the explanatory body so the
  // debater notices the staleness; tick 2 (after the `useEffect` calls
  // `clear()`) renders the empty-state body. The effect only fires when
  // the selection is non-null AND the lookup returned null — i.e.
  // staleness is the active branch.
  //
  // Per Decision §6 of `part_entity_detail_panel_annotation_view` the
  // `selected.kind !== 'annotation'` carve-out (which existed to keep
  // the predecessor's placeholder body up despite a null `entity`
  // lookup) is gone: the annotation branch now resolves a real
  // `Annotation` record via `lookupEntity`, and the staleness behaviour
  // is symmetric across all three kinds.
  useEffect(() => {
    if (selected !== null && entity === null) {
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

  // Annotation entity-detail branch — per
  // `tasks/refinements/participant-ui/part_entity_detail_panel_annotation_view.md`.
  // The participant's canvas materializes annotation graph-nodes when
  // they are referenced as edge endpoints; tapping one writes
  // `{ kind: 'annotation', id }` to the selection store. When the
  // selection points at a known annotation, the panel renders a
  // structured detail body (identity / content / author / target /
  // contradicts). When the selection points at an unknown annotation
  // id (snapshot-reload race), the panel falls through to the shared
  // stale-entity body + auto-clear (Decision §6).
  if (selected.kind === 'annotation' && entity !== null) {
    const annotation = entity as Annotation;
    return (
      <aside
        data-testid="participant-detail-panel"
        data-state="annotation"
        data-entity-kind="annotation"
        data-entity-id={selected.id}
        className="w-80 shrink-0 border-l border-slate-200 bg-white overflow-y-auto p-4 text-sm flex flex-col gap-4"
      >
        <AnnotationIdentitySection
          kindPrefixLabel={t('participant.detailPanel.identity.annotation')}
          kindLabel={t(`methodology.annotationKind.${annotation.kind}`)}
          annotationId={annotation.id}
          annotationKind={annotation.kind}
        />
        <AnnotationContentSection content={annotation.content} />
        <AnnotationAuthorSection
          sectionHeading={t('participant.detailPanel.annotation.sectionTitle.author')}
          authorName={screenNameFor(roster, annotation.createdBy)}
        />
        <AnnotationTargetSection
          sectionHeading={t('participant.detailPanel.annotation.sectionTitle.target')}
          annotation={annotation}
          projectedNodes={projectedNodes}
          projectedEdges={projectedEdges}
          annotations={annotations}
          unknownTargetLabel={t('participant.detailPanel.annotation.unknownTarget')}
          edgeRoleLabel={(role) => t(`methodology.edgeRole.${role}.label`)}
          annotationKindLabel={(kind) => t(`methodology.annotationKind.${kind}`)}
        />
        <AnnotationContradictsSection
          sectionHeading={t('participant.detailPanel.annotation.sectionTitle.contradicts')}
          annotationId={annotation.id}
          projectedNodes={projectedNodes}
          projectedEdges={projectedEdges}
          annotations={annotations}
          unknownTargetLabel={t('participant.detailPanel.annotation.unknownTarget')}
          annotationKindLabel={(kind) => t(`methodology.annotationKind.${kind}`)}
        />
        {actionSlot !== undefined ? (
          <div data-testid="participant-detail-panel-action-slot">{actionSlot}</div>
        ) : null}
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
  //
  // After the annotation branch above, the only way `entity` is an
  // `Annotation` is via `selected.kind === 'annotation' && entity !== null`,
  // which already returned. So here `selected.kind` is `'node' | 'edge'`
  // and `entity` narrows to `ParticipantNodeData | ParticipantEdgeData`.
  // TypeScript can't see through the multi-branch narrowing — assert the
  // narrowed selection kind + entity once for the remaining JSX.
  const nodeOrEdgeKind: 'node' | 'edge' = selected.kind === 'annotation' ? 'node' : selected.kind;
  const nodeOrEdgeEntity = entity as ParticipantNodeData | ParticipantEdgeData;
  const isNode = nodeOrEdgeKind === 'node';
  const identityLabel = isNode
    ? t('participant.detailPanel.identity.node')
    : t('participant.detailPanel.identity.edge');
  const wordingOrLabel = isNode
    ? (nodeOrEdgeEntity as ParticipantNodeData).wording
    : t(`methodology.edgeRole.${(nodeOrEdgeEntity as ParticipantEdgeData).role}.label`);

  return (
    <aside
      data-testid="participant-detail-panel"
      data-state="detail"
      data-entity-kind={nodeOrEdgeKind}
      data-entity-id={nodeOrEdgeEntity.id}
      className="w-80 shrink-0 border-l border-slate-200 bg-white overflow-y-auto p-4 text-sm flex flex-col gap-4"
    >
      <IdentitySection
        kind={nodeOrEdgeKind}
        kindLabel={identityLabel}
        wording={wordingOrLabel}
        entityId={nodeOrEdgeEntity.id}
      />
      <RollupStatusSection rollupStatus={nodeOrEdgeEntity.rollupStatus} />
      <FacetPillRowSection kind={nodeOrEdgeKind} facetStatuses={nodeOrEdgeEntity.facetStatuses} />
      {isNode ? (
        <AxiomMarkAttributionSection
          marks={nodeAxiomMarkIndex.get(nodeOrEdgeEntity.id) ?? []}
          roster={roster}
          sectionHeading={t('participant.detailPanel.sectionTitle.axiomMarks')}
        />
      ) : null}
      <AnnotationsSection
        annotations={
          isNode
            ? (nodeAnnotationIndex.get(nodeOrEdgeEntity.id) ?? [])
            : (edgeAnnotationIndex.get(nodeOrEdgeEntity.id) ?? [])
        }
        roster={roster}
        sectionHeading={t('participant.detailPanel.sectionTitle.annotations')}
        annotationKindLabel={(kind) => t(`methodology.annotationKind.${kind}`)}
      />
      <DiagnosticsSection
        highlight={nodeOrEdgeEntity.diagnosticHighlight}
        sectionHeading={t('participant.detailPanel.sectionTitle.diagnostics')}
      />
      <OwnVoteSection
        events={events}
        currentParticipantId={currentParticipantId}
        entityId={nodeOrEdgeEntity.id}
        ownVoteIndex={ownVoteIndex}
        kind={nodeOrEdgeKind}
        sectionHeading={t('participant.detailPanel.sectionTitle.ownVote')}
        facetLabel={(facet) => t(`methodology.facet.${facet}`)}
        voteArmLabel={(arm) => t(`methodology.voteChoice.${arm}`)}
      />
      <OtherVotersSection
        votes={
          isNode
            ? (othersVoteIndex.nodes.get(nodeOrEdgeEntity.id) ?? [])
            : (othersVoteIndex.edges.get(nodeOrEdgeEntity.id) ?? [])
        }
        roster={roster}
        perVoterFacets={perVoterFacets}
        sectionHeading={t('participant.detailPanel.sectionTitle.otherVotes')}
        voteArmLabel={(arm) => t(`methodology.voteChoice.${arm}`)}
        facetLabel={(facet) => t(`methodology.facet.${facet}`)}
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
        entityKind={nodeOrEdgeKind}
        entityId={nodeOrEdgeEntity.id}
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
 * Axiom-mark attribution — section 4. Chromatic per-participant badge
 * row (Decision §1.b of `part_entity_detail_panel_chromatic_axiom_mark_badge`).
 * Suppressed when no participant has marked this node as bedrock.
 */
function AxiomMarkAttributionSection(props: {
  marks: readonly AxiomMark[];
  roster: ReadonlyMap<string, string>;
  sectionHeading: string;
}): ReactElement | null {
  if (props.marks.length === 0) return null;
  // Dedup by participant id (a participant may have arrived at the
  // axiom mark through multiple proposal envelopes — only the most
  // recent is the active mark; the panel surfaces ONE badge per
  // participant). Preserve first-encounter order; retain the first-seen
  // `AxiomMark` reference per participant so the canonical shell
  // `<AxiomMarkBadge>` receives a real mark (its `nodeId` +
  // `participantId` feed the canonical testid + chromatic class).
  const seen = new Set<string>();
  const attributions: { mark: AxiomMark; screenName: string }[] = [];
  for (const mark of props.marks) {
    if (seen.has(mark.participantId)) continue;
    seen.add(mark.participantId);
    attributions.push({
      mark,
      screenName: screenNameFor(props.roster, mark.participantId),
    });
  }
  return (
    <section data-testid="participant-detail-panel-axiom-marks">
      <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1">
        {props.sectionHeading}
      </h3>
      <div
        data-testid="participant-detail-panel-axiom-mark-attribution"
        className="flex flex-wrap items-center gap-1"
      >
        {attributions.map((attribution) => (
          <AxiomMarkBadge
            key={attribution.mark.participantId}
            mark={attribution.mark}
            screenName={attribution.screenName}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Annotations list — section 5. One row per annotation with kind label
 * + content text + author screen name. Suppressed when no annotations
 * target the entity.
 *
 * Each row is a clickable button that selects the annotation
 * (`{ kind: 'annotation', id }`) so the panel re-renders into the
 * annotation-detail branch — the reachable selection path the dispute
 * affordance hangs off (`mod_annotation_dispute_e2e`, Constraints
 * "Reachable selection path"). Mirrors the in-row navigation buttons
 * `<AnnotationTargetSection>` / `<AnnotationContradictsSection>` already
 * use; the `<li>` keeps the stable testid + data-attributes so the
 * existing selectors keep biting.
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
            className="rounded border border-slate-200"
          >
            <button
              type="button"
              onClick={() => {
                useSelectionStore.getState().select({ kind: 'annotation', id: annotation.id });
              }}
              className="flex w-full flex-col items-start gap-0.5 p-2 text-left hover:bg-slate-50"
            >
              <span className="text-[10px] uppercase tracking-wide text-amber-700">
                {props.annotationKindLabel(annotation.kind)}
              </span>
              <span className="text-sm text-slate-800">{annotation.content}</span>
              <span className="text-[10px] text-slate-500">
                {screenNameFor(props.roster, annotation.createdBy)}
              </span>
            </button>
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
 * entity rollup arm at the top, plus a per-facet sub-list beneath the
 * rollup row carrying one `<li data-testid="participant-detail-panel-
 * other-vote-facet-row">` per facet the voter has touched on this
 * entity (per
 * `part_entity_detail_panel_per_facet_other_voter_breakdown` Decision §2).
 *
 * The outer row's testid + `data-voter-id` + `data-vote-arm` are
 * preserved from the predecessor v0 surface so existing assertions
 * (case `(m)` in `EntityDetailPanel.test.tsx`) continue to target the
 * row unchanged. The per-facet sub-list is always rendered (Decision §3
 * — gap-close shape: a voter present in `props.votes` but absent from
 * `props.perVoterFacets` renders an empty `<ul>`, NOT a suppressed
 * sub-list). Suppressed entirely when no other participant has voted.
 */
function OtherVotersSection(props: {
  votes: ReadonlyArray<{ readonly participantId: string; readonly choice: 'agree' | 'dispute' }>;
  roster: ReadonlyMap<string, string>;
  perVoterFacets: ReadonlyMap<string, Partial<Record<FacetName, 'agree' | 'dispute'>>>;
  sectionHeading: string;
  voteArmLabel: (arm: 'agree' | 'dispute') => string;
  facetLabel: (facet: FacetName) => string;
}): ReactElement | null {
  if (props.votes.length === 0) return null;
  return (
    <section data-testid="participant-detail-panel-other-voters">
      <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1">
        {props.sectionHeading}
      </h3>
      <ul className="space-y-2">
        {props.votes.map((vote) => {
          const perFacet = props.perVoterFacets.get(vote.participantId);
          return (
            <li
              key={vote.participantId}
              data-testid="participant-detail-panel-other-vote-row"
              data-voter-id={vote.participantId}
              data-vote-arm={vote.choice}
              className="flex flex-col gap-1 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-slate-600">
                  {screenNameFor(props.roster, vote.participantId)}
                </span>
                <span className="text-slate-900">{props.voteArmLabel(vote.choice)}</span>
              </div>
              <ul
                data-testid="participant-detail-panel-other-vote-facet-list"
                className="ml-3 space-y-0.5 text-xs"
              >
                {PER_VOTER_FACET_ORDER.map((facet) => {
                  const arm = perFacet?.[facet];
                  if (arm === undefined) return null;
                  return (
                    <li
                      key={facet}
                      data-testid="participant-detail-panel-other-vote-facet-row"
                      data-facet={facet}
                      data-vote-arm={arm}
                      className="flex items-center justify-between"
                    >
                      <span className="text-slate-500">{props.facetLabel(facet)}</span>
                      <span className="text-slate-700">{props.voteArmLabel(arm)}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Annotation identity header — `<aside data-state="annotation">` section 1.
 * Mirrors `<IdentitySection>`'s typography (upper-cased kind-prefix +
 * primary label + small-mono id) so the panel's information hierarchy
 * stays uniform across node / edge / annotation entities. Per Decision §4
 * the kind label is textual (no chromatic accent — the canvas annotation
 * graph-node carries the four-color palette).
 */
function AnnotationIdentitySection(props: {
  kindPrefixLabel: string;
  kindLabel: string;
  annotationId: string;
  annotationKind: AnnotationKind;
}): ReactElement {
  return (
    <section data-testid="participant-detail-panel-annotation-identity">
      <p className="text-xs uppercase tracking-wide text-slate-500">{props.kindPrefixLabel}</p>
      <p
        data-testid="participant-detail-panel-annotation-kind"
        data-annotation-kind={props.annotationKind}
        className="text-base text-slate-900"
      >
        {props.kindLabel}
      </p>
      <p
        data-testid="participant-detail-panel-annotation-id"
        className="text-[10px] text-slate-400 font-mono"
      >
        {props.annotationId}
      </p>
    </section>
  );
}

/**
 * Annotation content section. Always renders even when `content` is the
 * empty string — content is load-bearing identity for the annotation
 * entity per the Constraints sketch; an empty `<p>` is preferred over
 * suppressing the section (which would erase the entity's primary
 * payload).
 */
function AnnotationContentSection(props: { content: string }): ReactElement {
  return (
    <section data-testid="participant-detail-panel-annotation-content">
      <p
        data-testid="participant-detail-panel-annotation-content-body"
        className="text-sm text-slate-800 whitespace-pre-wrap"
      >
        {props.content}
      </p>
    </section>
  );
}

/**
 * Annotation author attribution. Resolves the author screen name via
 * the route-hoisted `participantRoster`; an unresolved author id falls
 * through to `screenNameFor`'s default (the raw user id) so the row
 * always renders something.
 */
function AnnotationAuthorSection(props: {
  sectionHeading: string;
  authorName: string;
}): ReactElement {
  return (
    <section data-testid="participant-detail-panel-annotation-author">
      <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1">
        {props.sectionHeading}
      </h3>
      <p
        data-testid="participant-detail-panel-annotation-author-name"
        className="text-sm text-slate-800"
      >
        {props.authorName}
      </p>
    </section>
  );
}

/**
 * Target-of-this-annotation row. Resolves the annotation's polymorphic
 * `targetNodeId` / `targetEdgeId` XOR to one of three render shapes:
 *
 *   - Edge target → resolves the projected edge and renders the
 *     localized edge-role label, navigation writes
 *     `{ kind: 'edge', id }` to the selection store.
 *   - Node target that matches a projected statement node → renders
 *     the statement wording, navigation writes `{ kind: 'node', id }`.
 *   - Node target that matches another annotation in the projection →
 *     renders the localized annotation-kind label, navigation writes
 *     `{ kind: 'annotation', id }` (per Decision §3 the chain-walking
 *     behaviour falls out of the unified `targetNodeId` slot when the
 *     wire schema permits annotation-on-annotation).
 *   - Unknown target (snapshot-reload race) → renders the localized
 *     fallback label; the button is disabled.
 */
function AnnotationTargetSection(props: {
  sectionHeading: string;
  annotation: Annotation;
  projectedNodes: readonly ParticipantNodeData[];
  projectedEdges: readonly ParticipantEdgeData[];
  annotations: readonly Annotation[];
  unknownTargetLabel: string;
  edgeRoleLabel: (role: ParticipantEdgeData['role']) => string;
  annotationKindLabel: (kind: AnnotationKind) => string;
}): ReactElement {
  const resolved = resolveAnnotationTarget({
    annotation: props.annotation,
    projectedNodes: props.projectedNodes,
    projectedEdges: props.projectedEdges,
    annotations: props.annotations,
    edgeRoleLabel: props.edgeRoleLabel,
    annotationKindLabel: props.annotationKindLabel,
    unknownTargetLabel: props.unknownTargetLabel,
  });
  return (
    <section data-testid="participant-detail-panel-annotation-target">
      <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1">
        {props.sectionHeading}
      </h3>
      {(() => {
        if (resolved.kind === 'unknown') {
          return (
            <button
              type="button"
              data-testid="participant-detail-panel-annotation-target-link"
              data-target-kind="unknown"
              data-target-id={resolved.id}
              disabled
              className="text-left text-sm text-slate-400"
            >
              {resolved.label}
            </button>
          );
        }
        const selectableKind: EntityKind = resolved.kind;
        const selectableId = resolved.id;
        return (
          <button
            type="button"
            data-testid="participant-detail-panel-annotation-target-link"
            data-target-kind={selectableKind}
            data-target-id={selectableId}
            onClick={() => {
              useSelectionStore.getState().select({ kind: selectableKind, id: selectableId });
            }}
            className="text-left text-sm text-sky-700 underline"
          >
            {resolved.label}
          </button>
        );
      })()}
    </section>
  );
}

/**
 * Contradicts-this-annotation list. Walks `projectedEdges` once,
 * collecting every edge with `role === 'contradicts'` AND either
 * endpoint matching the selected annotation id. The other endpoint
 * resolves via the same multi-kind resolver the target row uses
 * (statement wording / annotation kind label / unknown fallback).
 * Suppressed entirely when no contradicting edge anchors on the
 * annotation (matches the panel's "absent → omit" posture).
 */
function AnnotationContradictsSection(props: {
  sectionHeading: string;
  annotationId: string;
  projectedNodes: readonly ParticipantNodeData[];
  projectedEdges: readonly ParticipantEdgeData[];
  annotations: readonly Annotation[];
  unknownTargetLabel: string;
  annotationKindLabel: (kind: AnnotationKind) => string;
}): ReactElement | null {
  const contradictingEdges = props.projectedEdges.filter(
    (edge) =>
      edge.role === 'contradicts' &&
      (edge.source === props.annotationId || edge.target === props.annotationId),
  );
  if (contradictingEdges.length === 0) return null;
  return (
    <section data-testid="participant-detail-panel-annotation-contradicts">
      <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1">
        {props.sectionHeading}
      </h3>
      <ul className="space-y-1">
        {contradictingEdges.map((edge) => {
          const otherEndpointId = edge.source === props.annotationId ? edge.target : edge.source;
          const resolved = resolveEntityById({
            id: otherEndpointId,
            projectedNodes: props.projectedNodes,
            annotations: props.annotations,
            annotationKindLabel: props.annotationKindLabel,
            unknownTargetLabel: props.unknownTargetLabel,
          });
          return (
            <li
              key={edge.id}
              data-testid="participant-detail-panel-annotation-contradicts-row"
              data-edge-id={edge.id}
            >
              <button
                type="button"
                data-testid="participant-detail-panel-annotation-contradicts-link"
                data-edge-id={edge.id}
                onClick={() => {
                  useSelectionStore.getState().select({ kind: 'edge', id: edge.id });
                }}
                className="text-left text-sm text-sky-700 underline"
              >
                {resolved.label}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Discriminated resolution of an annotation's polymorphic target slot
 * to a `{ kind, id, label }` triple the target-row consumes. The
 * priority order honours the wire schema's XOR (`targetEdgeId` and
 * `targetNodeId` are mutually exclusive) AND the polymorphic-id slot
 * (`targetNodeId` may carry an annotation id rather than a statement
 * node id — Decision §3 / `groupAnnotationsByEntityId`'s docstring).
 */
function resolveAnnotationTarget(args: {
  annotation: Annotation;
  projectedNodes: readonly ParticipantNodeData[];
  projectedEdges: readonly ParticipantEdgeData[];
  annotations: readonly Annotation[];
  edgeRoleLabel: (role: ParticipantEdgeData['role']) => string;
  annotationKindLabel: (kind: AnnotationKind) => string;
  unknownTargetLabel: string;
}): { kind: 'node' | 'edge' | 'annotation' | 'unknown'; id: string; label: string } {
  if (args.annotation.targetEdgeId !== null) {
    const targetId = args.annotation.targetEdgeId;
    const edge = args.projectedEdges.find((candidate) => candidate.id === targetId) ?? null;
    if (edge === null) {
      return { kind: 'unknown', id: targetId, label: args.unknownTargetLabel };
    }
    return { kind: 'edge', id: edge.id, label: args.edgeRoleLabel(edge.role) };
  }
  if (args.annotation.targetNodeId !== null) {
    const targetId = args.annotation.targetNodeId;
    return resolveEntityById({
      id: targetId,
      projectedNodes: args.projectedNodes,
      annotations: args.annotations,
      annotationKindLabel: args.annotationKindLabel,
      unknownTargetLabel: args.unknownTargetLabel,
    });
  }
  return { kind: 'unknown', id: '', label: args.unknownTargetLabel };
}

/**
 * Resolve a polymorphic entity id (`targetNodeId` or an edge endpoint id
 * referencing an annotation graph-node) to a `{ kind, id, label }`
 * triple. Statement nodes take precedence over annotations because the
 * id space is shared but `projectedNodes` carries the statement-node
 * descriptors directly (the annotation graph-nodes that materialize as
 * edge endpoints carry `nodeKind: 'annotation'` and are NOT included in
 * the panel's `projectedNodes` prop — the panel reads the canonical
 * annotation record from the `annotations` array instead).
 */
function resolveEntityById(args: {
  id: string;
  projectedNodes: readonly ParticipantNodeData[];
  annotations: readonly Annotation[];
  annotationKindLabel: (kind: AnnotationKind) => string;
  unknownTargetLabel: string;
}): { kind: 'node' | 'annotation' | 'unknown'; id: string; label: string } {
  const node =
    args.projectedNodes.find(
      (candidate) => candidate.id === args.id && candidate.nodeKind !== 'annotation',
    ) ?? null;
  if (node !== null) {
    return { kind: 'node', id: node.id, label: node.wording };
  }
  const annotation = args.annotations.find((candidate) => candidate.id === args.id) ?? null;
  if (annotation !== null) {
    return {
      kind: 'annotation',
      id: annotation.id,
      label: args.annotationKindLabel(annotation.kind),
    };
  }
  return { kind: 'unknown', id: args.id, label: args.unknownTargetLabel };
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
