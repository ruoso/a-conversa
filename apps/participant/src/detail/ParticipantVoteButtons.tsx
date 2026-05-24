// `<ParticipantVoteButtons>` — the participant detail panel's per-facet
// row block. For nodes always renders three rows (`wording` /
// `classification` / `substance`); for edges always renders two rows
// (`shape` / `substance`). Each row's content depends on the row's
// derived `FacetStatus` per [ADR 0030 §10 + Consequences]
// (`docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md`):
//
//   - `awaiting-proposal` → empty-state body ("Awaiting a proposal");
//     no vote buttons.
//   - `proposed` / `disputed` → current candidate value displayed;
//     agree / dispute buttons (wired via `useVoteAction` for the
//     facet's pending proposal — the same proposalId binding the
//     previous incarnation of the row used; the facet-keyed vote
//     payload lands in the downstream
//     `pf_part_vote_action_facet_keyed` task).
//   - `agreed` / `committed` → current value displayed; placeholder
//     withdraw button (the wired gesture lands in the downstream
//     `pf_part_withdraw_agreement_action` task — see TODO markers).
//   - `meta-disagreement` → both candidate values displayed side by
//     side; no vote buttons.
//   - `withdrawn` → current value displayed; agree / dispute buttons
//     (the facet is back in dispute per ADR 0030 §3).
//
// Plus a synthetic `'proposal'`-facet row for the four structural
// sub-kinds (`decompose`, `interpretive-split`, `axiom-mark`,
// `annotate`) — the unanimity walk for structural proposals happens
// server-side against the proposal's `perParticipantVotes` map, and
// the participant votes via the proposal-keyed envelope. The
// structural row appears IN ADDITION to the always-on facet rows
// when the selected entity is the structural proposal's target.
//
// Refinement: tasks/refinements/per-facet-refactor/
//             pf_part_detail_panel_three_facet_rows.md
// Historical: tasks/refinements/participant-ui/part_voting.md +
//             tasks/refinements/participant-ui/
//             part_per_facet_state_styling.md (the prior shape; do not
//             edit).
//
// Spec contract — the e2e methodology spec selects each row via:
//
//   [data-testid="participant-detail-panel-facet-row"][data-facet-name="<facet>"]
//
// and (when vote buttons are present) per-button via:
//
//   [data-testid="participant-detail-panel-facet-row"][data-facet-name="<facet>"]
//     [data-testid="participant-vote-button-<choice>"]
//
// so the per-facet row carries the testid + `data-facet-name` attr
// AND nests the three buttons. The selector pattern matches both
// node + edge rows.
//
// ADRs:
//   - 0003 (React);
//   - 0005 (Tailwind utility classes);
//   - 0022 (no throwaway verifications — `ParticipantVoteButtons.test.tsx`
//           pins the per-row testid, per-status row content, per-choice
//           button + inFlight + error renderings);
//   - 0024 (i18n via react-i18next — all chrome strings go through
//           `useTranslation()`);
//   - 0026 (participant-workspace-only; no shell export until the
//           audience adds a third caller);
//   - 0027 (entity / facet layers stay separate — the row is per-facet
//           and carries facet-layer attributes; the per-entity context
//           comes from `props.entityId` + `props.entityKind`);
//   - 0030 §10 (always render all three facet rows per node, two per
//           edge — the always-rendered shape makes the methodology's
//           per-facet structure visible from the first frame).

import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  EdgeRole,
  EntityKind,
  Event,
  ProposalPayload,
  StatementKind,
} from '@a-conversa/shared-types';

import type { FacetName, FacetStatus, FacetStatusIndex } from '../graph/facetStatus';
import {
  EMPTY_OWN_FACET_VOTES,
  ownFacetKey,
  projectOwnFacetVotes,
  type OwnFacetVoteIndex,
} from '../graph/ownVotes';

import { useVoteAction, type VoteChoice } from './useVoteAction';
import { useWithdrawAgreementAction } from './useWithdrawAgreementAction';

/**
 * Facet name surfaced by the per-row affordance. Extends the three real
 * `FacetName` values (`classification` / `substance` / `wording`) with
 * the `'shape'` edge facet AND the synthetic `'proposal'` lifecycle
 * facet that the four structural sub-kinds (`decompose`,
 * `interpretive-split`, `axiom-mark`, `annotate`) map to. The
 * `'shape'` value is the edge facet that carries the edge role; the
 * detail panel surfaces it on edges (the participant `FacetName`
 * mirror stays 3-valued for the projection layer per
 * `apps/participant/src/graph/facetStatus.ts`, but the row catalog
 * here widens to include shape so the edge panel's two-row contract
 * holds).
 */
type LifecycleFacetName = FacetName | 'shape' | 'proposal';

/**
 * Row-local renderer vocabulary. Widens the hook's two-arm `VoteChoice`
 * (`'agree' | 'dispute'`) with `'withdraw'` to cover the structural-
 * proposal row + the `agreed` / `committed` rows' placeholder withdraw
 * button. The hook only fires for `'agree'` / `'dispute'`; the
 * `'withdraw'` button on a facet row is a placeholder (wired by
 * `pf_part_withdraw_agreement_action` downstream); the `'withdraw'`
 * button on the structural-proposal row also lands as a placeholder
 * here since the hook's API no longer accepts `'withdraw'` per ADR
 * 0030 §3 (the structural withdraw flow lands in its own follow-up).
 */
type RowVoteChoice = VoteChoice | 'withdraw';

/**
 * The vote-arm vocabulary the row surfaces. The legacy three-button row
 * (agree / dispute / withdraw) splits per ADR 0030 §3: withdraw is no
 * longer a vote choice; it is its own gesture landing in the downstream
 * `pf_part_withdraw_agreement_action` task. For statuses where the
 * wired gesture is "vote on the candidate" (`proposed` / `disputed` /
 * `withdrawn`), the row renders agree + dispute. For statuses where
 * the wired gesture is "withdraw your agreement" (`agreed` /
 * `committed`), the row renders a single withdraw button (placeholder).
 * For `awaiting-proposal` + `meta-disagreement`, no buttons.
 *
 * The structural `'proposal'`-facet row keeps the three-button shape
 * for back-compat with the pre-refactor behaviour; the withdraw button
 * is rendered for visual completeness as a placeholder (the
 * `useVoteAction` hook no longer accepts `'withdraw'` per ADR 0030 §3).
 */
const STRUCTURAL_VOTE_CHOICES: readonly RowVoteChoice[] = ['agree', 'dispute', 'withdraw'];
const FACET_VOTE_CHOICES: readonly RowVoteChoice[] = ['agree', 'dispute'];

/**
 * Per-choice testid arms. Spelled out explicitly (rather than computed
 * via interpolation at the call site) so the testid table is
 * grep-friendly — searching for `participant-vote-button-agree` lands
 * here and nowhere else.
 */
const VOTE_BUTTON_TESTID: Readonly<Record<RowVoteChoice, string>> = {
  agree: 'participant-vote-button-agree',
  dispute: 'participant-vote-button-dispute',
  withdraw: 'participant-vote-button-withdraw',
};

/**
 * Test id for the "you voted X" indicator that replaces the agree /
 * dispute / structural buttons on a row once the current participant
 * has voted on the row's current candidate. Pinned for the e2e suite
 * so the affordance-vs-indicator branch can be discriminated.
 */
const OWN_VOTE_INDICATOR_TESTID = 'participant-detail-panel-facet-row-own-vote';

/**
 * Per-choice i18n label key under `participant.voteButton`. Same
 * grep-friendly posture as `VOTE_BUTTON_TESTID`.
 */
const VOTE_BUTTON_LABEL_KEY: Readonly<Record<RowVoteChoice, string>> = {
  agree: 'participant.voteButton.agreeLabel',
  dispute: 'participant.voteButton.disputeLabel',
  withdraw: 'participant.voteButton.withdrawLabel',
};

/**
 * Node facets, in card-row order (matches `<FacetPillRowSection>` in
 * `EntityDetailPanel.tsx`).
 */
const NODE_FACETS: readonly FacetName[] = ['wording', 'classification', 'substance'];

/**
 * Edge facets, in card-row order. `'shape'` is the carriage of the
 * edge role; `'substance'` is the agreement-on-the-claim facet.
 */
const EDGE_FACETS: readonly ('shape' | 'substance')[] = ['shape', 'substance'];

/**
 * Resolve the (entityKind, entityId, facet) target a STRUCTURAL
 * proposal payload addresses, or `null` for sub-kinds that do not
 * produce a synthetic-`'proposal'` row (the four facet-targeting
 * sub-kinds — they get their per-facet row from the always-on
 * three-row block — plus `meta-move` and `break-edge`, still
 * deferred to their own UI-flow tasks).
 *
 * The function is reduced from its pre-ADR-0030 shape: the four
 * facet-targeting sub-kinds (`classify-node`, `set-node-substance`,
 * `set-edge-substance`, `edit-wording` / `amend-node`) no longer
 * synthesize a row — the always-on facet row block hangs off the
 * facet itself and reads the candidate from the projection. Only
 * the four structural sub-kinds (and the legacy `capture-node`
 * arm) remain.
 *
 * For the four structural sub-kinds the target carries the synthetic
 * `'proposal'` facet keyed to the entity the structural move is
 * acting on — the parent node for decompose / interpretive-split,
 * the node for axiom-mark, the target node-or-edge for annotate.
 */
function proposalFacetTarget(
  proposal: ProposalPayload,
): { entityKind: EntityKind; entityId: string; facet: 'wording' | 'proposal' } | null {
  switch (proposal.kind) {
    case 'capture-node':
      // Per ADR 0030 §1 + §4 + `pf_mod_node_card_classification_affordance`:
      // `capture-node` names the wording-facet candidate inline. The
      // participant detail panel surfaces a `wording`-facet vote row
      // for the capture proposal so the sequential capture flow
      // (wording → classification → substance) can advance. The
      // capture proposal arm stays here because the always-on row
      // block needs to discover the `proposalId` to bind the row's
      // vote action to; the always-on block's facet-status walk
      // already surfaces the `wording` row as `proposed`, but the
      // proposalId for the wired vote comes from this helper.
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    case 'decompose':
      // The structural move replaces `parent_node_id`; the affordance
      // hangs off that node so other participants see it when they
      // inspect the entity being decomposed.
      return { entityKind: 'node', entityId: proposal.parent_node_id, facet: 'proposal' };
    case 'interpretive-split':
      return { entityKind: 'node', entityId: proposal.parent_node_id, facet: 'proposal' };
    case 'axiom-mark':
      // Per docs/methodology.md § "Axioms / terminal values": the
      // axiom mark hangs off the node it marks. The OperateRoute caller
      // additionally hides the row from the declared participant (see
      // `currentParticipantId` exclusion below) per the methodology
      // rule "we all agree that *this participant* holds this node as
      // bedrock" — the declared participant's proposal IS the
      // declaration.
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'proposal' };
    case 'annotate':
      // `target_kind` discriminates between node and edge annotations;
      // both produce a row on the targeted entity.
      return {
        entityKind: proposal.target_kind,
        entityId: proposal.target_id,
        facet: 'proposal',
      };
    case 'classify-node':
    case 'set-node-substance':
    case 'set-edge-substance':
    case 'edit-wording':
    case 'amend-node':
      // These four sub-kinds target a real facet on a real entity;
      // the always-on row block surfaces them via the facet-status
      // walk. The wired `proposalId` lookup for those rows is done
      // separately by `derivePendingProposalIdByFacet` below.
      return null;
    case 'meta-move':
    case 'break-edge':
      // Still deferred to their own UI tasks — no participant vote
      // affordance today. The server side accepts unanimity for these
      // too (`checkUnanimousAgreeStructural` is sub-kind-agnostic), but
      // no UI surface drives the per-row gesture yet.
      return null;
    default:
      return null;
  }
}

/**
 * Per-facet pending-proposal mapping: which facets of the selected
 * entity have an open proposal, and what is each proposal's event id
 * (the wire `proposalId`). Computed from the event log inline (rather
 * than reading the read-side projector's output) because the panel
 * already has `events` on hand and the read-side `pendingProposals`
 * map keys by proposal-id rather than `(entityId, facet)`. The walk is
 * O(events) once per `events` change.
 *
 * Includes the synthetic `'proposal'` facet for the four structural
 * sub-kinds (decompose, interpretive-split, axiom-mark, annotate)
 * AND the four real facet-targeting sub-kinds — the always-on row
 * block needs the proposalId for the row's vote action regardless of
 * which facet the proposal targets.
 *
 * "Pending" here is the local-projection equivalent — a proposal with
 * no later `commit` or `meta-disagreement-marked` event referencing
 * the same `proposalId`. The server-side broadcast `proposal-status`
 * map carries the canonical pending set; for the panel's row block
 * the local walk is sufficient.
 */
export function derivePendingFacetProposals(
  events: readonly Event[],
  entityKind: EntityKind,
  entityId: string,
  currentParticipantId?: string,
): ReadonlyMap<LifecycleFacetName, string> {
  // proposalEventId → facet for proposals targeting THIS (entityKind,
  // entityId). Per-facet LATEST-WINS — if two proposals target the
  // same facet, the later proposal's id is the active one (the prior
  // proposal is implicitly superseded for vote-routing purposes).
  // Includes the synthetic `'proposal'` facet for structural sub-kinds
  // (decompose, interpretive-split, axiom-mark, annotate).
  const proposalIdByFacet = new Map<LifecycleFacetName, string>();
  const closedProposalIds = new Set<string>();
  for (const event of events) {
    if (event.kind === 'proposal') {
      const proposal = event.payload.proposal;
      // The four facet-targeting sub-kinds + capture-node populate
      // their per-facet entry directly off the proposal payload.
      const facetTarget = facetTargetingProposalTarget(proposal);
      if (facetTarget !== null) {
        if (facetTarget.entityKind === entityKind && facetTarget.entityId === entityId) {
          proposalIdByFacet.set(facetTarget.facet, event.id);
        }
      } else {
        // Structural sub-kinds + capture-node go through
        // `proposalFacetTarget`. capture-node returns a 'wording'
        // target — duplicates the facetTarget branch, but only one
        // matches per event so the map-set is idempotent.
        const target = proposalFacetTarget(proposal);
        if (target === null) continue;
        if (target.entityKind !== entityKind) continue;
        if (target.entityId !== entityId) continue;
        // Axiom-mark special case — the participant whose bedrock is
        // being declared is the proposer; their proposal IS the
        // declaration. They have nothing to vote on (the server's
        // `checkUnanimousAgreeStructural` excludes them from the
        // required set per docs/methodology.md § "Axioms / terminal
        // values"). Suppress the row for that participant on the
        // client side so the affordance only appears to the others.
        if (
          proposal.kind === 'axiom-mark' &&
          currentParticipantId !== undefined &&
          proposal.participant === currentParticipantId
        ) {
          continue;
        }
        proposalIdByFacet.set(target.facet, event.id);
      }
    } else if (event.kind === 'commit') {
      // Per ADR 0030 §2 + §9: commit payloads are a `target`-
      // discriminated union. The proposal-keyed arm carries
      // `proposal_id` directly; the facet-keyed arm names the
      // `(entity_kind, entity_id, facet)` triple — for the facet arm
      // we look up the closing proposal via the `proposalIdByFacet`
      // map we already maintain.
      if (event.payload.target === 'proposal') {
        closedProposalIds.add(event.payload.proposal_id);
      } else if (event.payload.entity_kind === entityKind && event.payload.entity_id === entityId) {
        const proposalId = proposalIdByFacet.get(event.payload.facet);
        if (proposalId !== undefined) closedProposalIds.add(proposalId);
      }
    } else if (event.kind === 'meta-disagreement-marked') {
      // Symmetric with the commit arm above — same discriminated
      // union, same lookup pattern.
      if (event.payload.target === 'proposal') {
        closedProposalIds.add(event.payload.proposal_id);
      } else if (event.payload.entity_kind === entityKind && event.payload.entity_id === entityId) {
        const proposalId = proposalIdByFacet.get(event.payload.facet);
        if (proposalId !== undefined) closedProposalIds.add(proposalId);
      }
    }
  }
  // Strip closed proposals — committed / meta-disagreement proposals
  // no longer accept votes; the panel surfaces the agreed rollup
  // separately.
  for (const [facet, proposalId] of [...proposalIdByFacet.entries()]) {
    if (closedProposalIds.has(proposalId)) {
      proposalIdByFacet.delete(facet);
    }
  }
  return proposalIdByFacet;
}

/**
 * Resolve the (entityKind, entityId, facet) target a facet-targeting
 * proposal addresses. Returns `null` for structural / lifecycle
 * sub-kinds (handled by `proposalFacetTarget`). Mirrors the
 * `targetOf` helper in `apps/participant/src/graph/facetStatus.ts`
 * but typed to `LifecycleFacetName` so the row-catalog union is the
 * return shape.
 */
function facetTargetingProposalTarget(
  proposal: ProposalPayload,
): { entityKind: EntityKind; entityId: string; facet: LifecycleFacetName } | null {
  switch (proposal.kind) {
    case 'classify-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'classification' };
    case 'set-node-substance':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'substance' };
    case 'set-edge-substance':
      return { entityKind: 'edge', entityId: proposal.edge_id, facet: 'substance' };
    case 'edit-wording':
    case 'amend-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    default:
      return null;
  }
}

/**
 * The current candidate value the row should display for a facet, or
 * `undefined` if no candidate has been named yet. Walks the events log
 * once per render-input change and tracks the most-recent candidate
 * for each (entityKind, entityId, facet) tuple targeting THIS entity.
 *
 * The shape is intentionally weak — different facets carry different
 * value types (wording is a string, classification is a
 * `StatementKind`, substance is `'agreed' | 'disputed'`, shape is an
 * `EdgeRole`). The renderer stringifies via the appropriate label
 * helper at the row layer.
 */
interface CandidateValues {
  wording?: string;
  classification?: StatementKind;
  substance?: 'agreed' | 'disputed';
  shape?: EdgeRole;
}

function deriveCandidateValues(
  events: readonly Event[],
  entityKind: EntityKind,
  entityId: string,
): CandidateValues {
  const out: CandidateValues = {};
  for (const event of events) {
    if (
      event.kind === 'node-created' &&
      entityKind === 'node' &&
      event.payload.node_id === entityId
    ) {
      // Per ADR 0030 §4: wording is inline on `node-created`. The
      // wording facet enters life with the captured text as its
      // candidate (independent of whether a later edit-wording
      // proposal supersedes it).
      out.wording = event.payload.wording;
      continue;
    }
    if (
      event.kind === 'edge-created' &&
      entityKind === 'edge' &&
      event.payload.edge_id === entityId
    ) {
      // Per ADR 0030 §5: edge shape is inline on `edge-created` (the
      // edge role IS the shape candidate). The substance facet enters
      // life `awaiting-proposal`; the shape facet has the inline
      // carriage as its candidate from frame one.
      out.shape = event.payload.role;
      continue;
    }
    if (event.kind === 'proposal') {
      const proposal = event.payload.proposal;
      if (
        proposal.kind === 'classify-node' &&
        entityKind === 'node' &&
        proposal.node_id === entityId
      ) {
        out.classification = proposal.classification;
      } else if (
        proposal.kind === 'set-node-substance' &&
        entityKind === 'node' &&
        proposal.node_id === entityId
      ) {
        out.substance = proposal.value;
      } else if (
        proposal.kind === 'set-edge-substance' &&
        entityKind === 'edge' &&
        proposal.edge_id === entityId
      ) {
        out.substance = proposal.value;
      } else if (
        proposal.kind === 'edit-wording' &&
        entityKind === 'node' &&
        proposal.node_id === entityId
      ) {
        out.wording = proposal.new_wording;
      } else if (
        proposal.kind === 'amend-node' &&
        entityKind === 'node' &&
        proposal.node_id === entityId
      ) {
        // amend-node carries new wording (the engine's repair op).
        // Cast through unknown — the shared-types schema discriminates
        // the field as `new_wording` for both reword + amend.
        const payload = proposal as unknown as { new_wording?: string };
        if (typeof payload.new_wording === 'string') {
          out.wording = payload.new_wording;
        }
      }
    }
  }
  return out;
}

export interface ParticipantVoteButtonsProps {
  readonly events: readonly Event[];
  readonly entityKind: EntityKind;
  readonly entityId: string;
  /**
   * Per-entity per-facet status index from `computeFacetStatuses`. The
   * row block reads the status for each facet of the selected entity
   * to pick the per-row rendering branch.
   */
  readonly facetStatusIndex: FacetStatusIndex;
  /**
   * The current debater's user id. Used for the axiom-mark special
   * case — the declared participant doesn't see a row on their own
   * axiom-mark proposal (their proposal IS the declaration). When
   * omitted, the axiom-mark suppression is skipped (the row renders
   * unconditionally, which is the legacy v1 behaviour).
   */
  readonly currentParticipantId?: string;
}

/**
 * The participant detail panel's per-facet row block. Renders one
 * `<FacetRow>` per facet of the selected entity (always three for
 * nodes, two for edges), plus one synthetic `'proposal'`-facet row
 * when a structural proposal targets the entity.
 *
 * Per ADR 0030 §10 + Consequences the always-on shape is the
 * methodology contract: the participant should see all three facet
 * rows on a node panel from the first frame, even when only the
 * wording facet has a candidate.
 */
export function ParticipantVoteButtons(props: ParticipantVoteButtonsProps): ReactElement | null {
  const { events, entityKind, entityId, facetStatusIndex, currentParticipantId } = props;
  const { t } = useTranslation();

  // Per-facet proposalId binding for the wired vote action (for rows
  // in `proposed` / `disputed` / `withdrawn`) AND for the structural
  // `'proposal'`-facet row.
  const pendingByFacet = useMemo(
    () => derivePendingFacetProposals(events, entityKind, entityId, currentParticipantId),
    [events, entityKind, entityId, currentParticipantId],
  );

  // Per-facet candidate value for display in the row body. Walked
  // inline (rather than threaded through the projection) because the
  // walk is O(events) once per render-input change and the projection
  // does not surface the candidate values via the existing
  // `FacetStatusIndex` shape.
  const candidates = useMemo(
    () => deriveCandidateValues(events, entityKind, entityId),
    [events, entityKind, entityId],
  );

  // Per-facet (and per-structural-proposal) own-vote index for the
  // current participant. Drives the "hide the buttons once you've voted"
  // affordance on the row — without it, the agree/dispute buttons stay
  // visible until the FACET STATUS changes (which requires unanimity or
  // commit), so a single participant's vote sits ambiguous to them.
  // See `projectOwnFacetVotes` for the supersession-clears semantics.
  const ownFacetVotes = useMemo<OwnFacetVoteIndex>(
    () =>
      currentParticipantId !== undefined && currentParticipantId !== ''
        ? projectOwnFacetVotes(events, currentParticipantId)
        : EMPTY_OWN_FACET_VOTES,
    [events, currentParticipantId],
  );

  // Per-facet status — read from the projection index.
  const facetStatuses = useMemo(() => {
    const map = entityKind === 'node' ? facetStatusIndex.nodes : facetStatusIndex.edges;
    return map.get(entityId) ?? {};
  }, [facetStatusIndex, entityKind, entityId]);

  // Resolve the row catalog for the entity kind.
  const facets: readonly LifecycleFacetName[] = entityKind === 'node' ? NODE_FACETS : EDGE_FACETS;

  // Append the synthetic `'proposal'`-facet row when a structural
  // proposal targets THIS entity. The row appears in addition to
  // the always-on rows; it surfaces the structural proposal's vote
  // affordance (the wired vote envelope carries the structural
  // proposal id, the server's `handleVote` populates the pending
  // proposal's `perParticipantVotes` map, and the unanimity check
  // walks it per commit `421353f`).
  const structuralProposalId = pendingByFacet.get('proposal');

  return (
    <section data-testid="participant-detail-panel-vote-section" className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wide text-slate-500">
        {t('participant.detailPanel.sectionTitle.vote')}
      </h3>
      {facets.map((facet) => {
        // Read the status from the projection's per-facet record. The
        // index keys nodes by 3-valued `FacetName` (wording /
        // classification / substance); the edge `'shape'` facet is
        // not tracked by the participant projection today (the
        // 3-valued mirror at `apps/participant/src/graph/facetStatus.ts`
        // skips shape), so the panel falls back to a synthesized
        // status: if there's no proposal and the inline carriage is
        // present, the row is effectively `agreed`/`committed`; else
        // `awaiting-proposal`. Substance on edges IS tracked.
        const status = readFacetStatus(facetStatuses, facet, candidates, entityKind);
        const proposalId = pendingByFacet.get(facet);
        const candidateValue = candidateValueFor(facet, candidates);
        const ownVote = lookupOwnVoteForRow(ownFacetVotes, entityKind, entityId, facet, proposalId);
        return (
          <FacetRow
            key={facet}
            facet={facet}
            entityKind={entityKind}
            entityId={entityId}
            status={status}
            proposalId={proposalId}
            candidateValue={candidateValue}
            currentParticipantId={currentParticipantId}
            ownVote={ownVote}
          />
        );
      })}
      {structuralProposalId !== undefined ? (
        <FacetRow
          key="proposal"
          facet="proposal"
          entityKind={entityKind}
          entityId={entityId}
          status="proposed"
          proposalId={structuralProposalId}
          candidateValue={undefined}
          currentParticipantId={currentParticipantId}
          ownVote={ownFacetVotes.proposals.get(structuralProposalId)}
        />
      ) : null}
    </section>
  );
}

/**
 * Resolve the current participant's vote on a row's current candidate
 * for the hide-button check.
 *
 * - The four real facet rows look up by `(entityKind, entityId, facet)`
 *   in `ownFacetVotes.facets` — that map already enforces the per-ADR-0030-§7
 *   supersession-clears semantics (a new proposal lands on the facet ⇒
 *   the prior vote drops out so the row's buttons re-appear for the new
 *   candidate).
 * - The synthetic `'proposal'` row routes through `ownFacetVotes.proposals`
 *   keyed by the structural proposal envelope id; the caller passes that
 *   lookup separately because the row's `facet` here is the synthetic
 *   `'proposal'` and `entityId` is the host entity, not the proposal id.
 * - Edge `'shape'` rows have no per-row vote affordance today (the
 *   facet's status is synthesized from the inline carriage), so the
 *   own-vote lookup is `undefined` and the row's pre-existing branch
 *   stays unchanged.
 */
function lookupOwnVoteForRow(
  index: OwnFacetVoteIndex,
  entityKind: EntityKind,
  entityId: string,
  facet: LifecycleFacetName,
  proposalId: string | undefined,
): 'agree' | 'dispute' | undefined {
  if (facet === 'proposal' || facet === 'shape') return undefined;
  void proposalId;
  if (entityKind !== 'node' && entityKind !== 'edge') return undefined;
  return index.facets.get(ownFacetKey(entityKind, entityId, facet));
}

/**
 * Read the row's display status from the projection's per-facet
 * record, with a fallback for facets the projection mirror doesn't
 * track (edge `'shape'` today). The fallback is intentionally
 * minimal — the canonical status carriage for edge shape lands in a
 * future per-facet refactor task; until then the row renders the
 * inline-carriage as a committed-looking row (no buttons).
 */
function readFacetStatus(
  facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>,
  facet: LifecycleFacetName,
  candidates: CandidateValues,
  entityKind: EntityKind,
): FacetStatus {
  if (facet === 'shape') {
    // Edge shape — the inline carriage IS the candidate. The
    // projection mirror does not track shape; render as `committed`
    // when the edge has been created (the role is set inline), else
    // `awaiting-proposal`.
    return candidates.shape !== undefined ? 'committed' : 'awaiting-proposal';
  }
  if (facet === 'proposal') {
    // Structural-proposal row — caller picks `'proposed'` directly;
    // this branch is defensive (the row catalog above never calls
    // `readFacetStatus` with `'proposal'`).
    return 'proposed';
  }
  // Real facets — read from the projection. Falls back to
  // `'awaiting-proposal'` when the projection has no entry for the
  // facet (e.g. a freshly-mounted node whose `node-created` hasn't
  // landed yet on this client).
  const recorded = facetStatuses[facet];
  if (recorded !== undefined) return recorded;
  // Edge substance defaults to awaiting-proposal until a proposal
  // lands; node facets default the same way. (The edge-created
  // payload is consumed by the projection so substance + (eventually)
  // shape get tracked there; node facets enter life via node-created
  // → wording inline + classification / substance awaiting.)
  void entityKind;
  return 'awaiting-proposal';
}

/**
 * Pluck the candidate value for a given facet from the `CandidateValues`
 * accumulator. Returns `undefined` for the `'proposal'` row (structural
 * proposals don't carry a renderable candidate-value distinct from the
 * proposal payload itself).
 */
function candidateValueFor(
  facet: LifecycleFacetName,
  candidates: CandidateValues,
): string | undefined {
  switch (facet) {
    case 'wording':
      return candidates.wording;
    case 'classification':
      return candidates.classification;
    case 'substance':
      return candidates.substance;
    case 'shape':
      return candidates.shape;
    case 'proposal':
      return undefined;
    default:
      return undefined;
  }
}

interface FacetRowProps {
  readonly facet: LifecycleFacetName;
  readonly entityKind: EntityKind;
  readonly entityId: string;
  readonly status: FacetStatus;
  readonly proposalId: string | undefined;
  readonly candidateValue: string | undefined;
  /**
   * The authenticated participant's user id — threaded from the
   * `<ParticipantVoteButtons>` block to the row. Required for the
   * `withdraw-agreement` wire payload (per
   * `wsWithdrawAgreementPayloadSchema`); when omitted, the withdraw
   * button still renders (for visual completeness on test stubs that
   * don't thread the prop) but its click is a no-op. The
   * `OperateRoute.tsx` caller always threads it.
   */
  readonly currentParticipantId: string | undefined;
  /**
   * The current participant's recorded vote on this row's current
   * candidate (`'agree'` / `'dispute'`), or `undefined` when they
   * haven't voted yet. When defined, the row collapses the
   * agree/dispute button branch (`proposed` / `disputed` / `withdrawn`)
   * to a "you voted" indicator so the affordance doesn't keep inviting
   * a vote the participant has already cast. Resolved against the
   * supersession-clearing `OwnFacetVoteIndex` in the parent block, so
   * a new candidate landing on the facet re-opens the buttons.
   */
  readonly ownVote: 'agree' | 'dispute' | undefined;
}

/**
 * One per-facet row. The row carries the spec's per-facet testid +
 * `data-facet-name` attr + the per-status `data-facet-status` attr +
 * (when a proposal is bound) the `data-proposal-id` attr. The row
 * body picks one of seven status branches:
 *
 *   - `awaiting-proposal` → empty-state body, no buttons.
 *   - `proposed` / `disputed` → candidate value + agree/dispute buttons.
 *   - `agreed` / `committed` → candidate value + wired withdraw button
 *     (fires `withdraw-agreement` envelope via
 *     `useWithdrawAgreementAction` per ADR 0030 §3 +
 *     `pf_part_withdraw_agreement_action`). The button uses a
 *     two-stage confirmation gesture (first click arms; second click
 *     fires) — the methodology treats withdrawal as a significant
 *     gesture so the deliberate extra tap is required.
 *   - `withdrawn` → candidate value + agree/dispute buttons.
 *   - `meta-disagreement` → candidate values, no buttons.
 *
 * The structural `'proposal'`-facet row uses the same three-button
 * shape it had pre-refactor (agree / dispute / withdraw) — the
 * structural unanimity walk still reads the proposal-keyed
 * `perParticipantVotes` map on the server. The `'withdraw'` arm on
 * the structural row remains a placeholder; the structural withdraw
 * flow has its own follow-up task.
 */
function FacetRow(props: FacetRowProps): ReactElement {
  const {
    facet,
    entityKind,
    entityId,
    status,
    proposalId,
    candidateValue,
    currentParticipantId,
    ownVote,
  } = props;
  const { t } = useTranslation();

  // Two-stage confirmation gesture for the wired withdraw button. The
  // first click arms the button (renders the "Confirm withdraw" label);
  // the second click fires the `withdraw-agreement` envelope. Per the
  // refinement's Decisions block + the prior `part_withdraw_dialog`
  // precedent — withdrawal is a significant gesture so a deliberate
  // extra tap is required. State lives row-local (not on the
  // module-scoped store) because it's a transient UI gesture, not a
  // wire-level concern.
  const [withdrawArmed, setWithdrawArmed] = useState(false);

  // The wired vote-action hook is bound per-arm:
  //
  //   - The synthetic `'proposal'`-facet row (structural sub-kinds —
  //     `decompose` / `interpretive-split` / `axiom-mark` / `annotate`)
  //     binds to the proposal arm: the hook emits
  //     `{ target: 'proposal', proposalId, choice }` on the wire,
  //     matching the structural-arm methodology engine path.
  //   - The four real facet rows (`wording` / `classification` /
  //     `substance` / `shape`) bind to the facet arm: the hook emits
  //     `{ target: 'facet', entity_kind, entity_id, facet, choice }`.
  //     The server resolves the facet's current candidate proposal at
  //     handle-time per ADR 0030 §2 + the refinement at
  //     `tasks/refinements/per-facet-refactor/
  //     pf_part_vote_action_facet_keyed.md`.
  //
  // When the row's facet has no candidate yet (the `awaiting-proposal`
  // branch + the edge-shape inline-carriage `committed` fallback), the
  // hook is still bound — its `castVote()` is never called from those
  // branches (no buttons render) so the binding is inert.
  // The hook's facet arm narrows `entity_kind` to `'node' | 'edge'`
  // (the methodology has no per-facet vote against annotations today).
  // The panel does not surface for annotation entities (see
  // `EntityDetailPanel.tsx`) but the prop type is the wider
  // `EntityKind`; we narrow defensively before constructing the
  // facet-arm input.
  const voteEntityKind: 'node' | 'edge' | null =
    entityKind === 'node' || entityKind === 'edge' ? entityKind : null;
  const voteArgs =
    facet === 'proposal'
      ? // The synthetic `'proposal'` facet row is only rendered when
        // `proposalId` is defined (the structural-row caller in
        // `ParticipantVoteButtons` filters); we fall back to the empty
        // string for the awaiting branch so the hook binding stays
        // structurally typed (no buttons render in that branch so the
        // empty id is never sent to the wire).
        ({ proposal_id: proposalId ?? '' } as const)
      : voteEntityKind !== null &&
          (facet === 'shape' ||
            facet === 'wording' ||
            facet === 'classification' ||
            facet === 'substance')
        ? ({
            entity_kind: voteEntityKind,
            entity_id: entityId,
            facet,
          } as const)
        : ({ proposal_id: '' } as const);
  const { castVote, inFlight, lastError } = useVoteAction(voteArgs);

  // Bind the withdraw-agreement hook for the row. The hook is keyed
  // by the `(entity_kind, entity_id, facet)` triple; on the structural
  // `'proposal'`-facet row + on the awaiting-proposal branches the
  // binding is inert (no withdraw button renders). The hook narrows
  // `entity_kind` to `'node' | 'edge'` and `facet` to the four wire-
  // schema values (`classification` / `substance` / `wording` /
  // `shape`); we pass a defensively-narrowed pair (falling back to
  // dummy values for the structural `'proposal'` arm where no
  // withdraw is ever fired — no buttons render on that branch).
  // `currentParticipantId` is required by the wire payload; the row
  // gates the button's click on its presence (see below).
  const withdrawFacet: 'classification' | 'substance' | 'wording' | 'shape' =
    facet === 'classification' || facet === 'substance' || facet === 'wording' || facet === 'shape'
      ? facet
      : 'classification';
  const {
    withdraw,
    inFlight: withdrawInFlight,
    lastError: withdrawLastError,
  } = useWithdrawAgreementAction({
    entity_kind: voteEntityKind ?? 'node',
    entity_id: entityId,
    facet: withdrawFacet,
    participantId: currentParticipantId ?? '',
  });

  const wireMessage = useMemo<string | undefined>(() => {
    if (lastError === undefined) return undefined;
    return lastError.code === 'timeout'
      ? lastError.message
      : t('participant.voteButton.wireError', {
          code: lastError.code,
          message: lastError.message,
        });
  }, [lastError, t]);

  const withdrawWireMessage = useMemo<string | undefined>(() => {
    if (withdrawLastError === undefined) return undefined;
    return withdrawLastError.code === 'timeout'
      ? withdrawLastError.message
      : t('participant.withdrawAgreementButton.wireError', {
          code: withdrawLastError.code,
          message: withdrawLastError.message,
        });
  }, [withdrawLastError, t]);

  const voteState: 'enabled' | 'in-flight' = inFlight ? 'in-flight' : 'enabled';
  const withdrawState: 'enabled' | 'armed' | 'in-flight' = withdrawInFlight
    ? 'in-flight'
    : withdrawArmed
      ? 'armed'
      : 'enabled';

  // Pick the row's button vocabulary by status. `null` means "no
  // buttons" (awaiting-proposal + meta-disagreement + pre-commit
  // states the current participant has already voted on). The
  // `'proposal'` synthetic facet uses the structural three-button
  // shape (kept for back-compat with the pre-refactor wire path).
  //
  // Pre-commit hide-after-vote: when the current participant has
  // recorded a vote on the row's current candidate (`ownVote` is
  // defined), the agree/dispute branch collapses to `null`. The vote
  // affordance has done its job — keeping the buttons rendered would
  // invite a vote the participant has already cast and obscure the
  // "I voted X" state. The post-commit `withdraw` branch is
  // intentionally still rendered (the participant can withdraw their
  // own agreement; the indicator and the affordance are distinct
  // gestures there).
  const choices = useMemo<readonly RowVoteChoice[] | null>(() => {
    if (facet === 'proposal') {
      return ownVote !== undefined ? null : STRUCTURAL_VOTE_CHOICES;
    }
    switch (status) {
      case 'awaiting-proposal':
      case 'meta-disagreement':
        return null;
      case 'agreed':
      case 'committed':
        // The single-arm 'withdraw' button is now WIRED — clicking
        // arms a two-stage confirmation, and a second click fires
        // the `withdraw-agreement` envelope via
        // `useWithdrawAgreementAction` (per ADR 0030 §3 +
        // `pf_part_withdraw_agreement_action`). On success the row's
        // status walks to `'withdrawn'` per the projection (Rule 4
        // in `deriveFacetStatus`); the button disappears as the row
        // re-renders into the `withdrawn` branch (which renders
        // agree/dispute buttons instead).
        return ['withdraw'] as const;
      case 'proposed':
      case 'disputed':
      case 'withdrawn':
        return ownVote !== undefined ? null : FACET_VOTE_CHOICES;
      default:
        return null;
    }
  }, [facet, status, ownVote]);

  // No-buttons branch: `awaiting-proposal` (no candidate yet) +
  // `meta-disagreement` (both candidates shown side by side).
  const bodyRender = useMemo(() => {
    if (status === 'awaiting-proposal') {
      return (
        <p
          data-testid="participant-detail-panel-facet-row-awaiting-proposal"
          className="text-xs italic text-slate-400"
        >
          {t('participant.detailPanel.facetRow.awaitingProposal')}
        </p>
      );
    }
    if (status === 'meta-disagreement') {
      return (
        <p
          data-testid="participant-detail-panel-facet-row-meta-disagreement"
          className="text-xs text-violet-700"
        >
          {/* Per ADR 0030 Consequences: the two-value carriage on
           * `FacetState` is the downstream `pf_projection_facet_status_refactor`
           * task's call. Until that lands, the candidate carries only
           * one value here; we render it with the meta-disagreement
           * styling so the row visually distinguishes from a normal
           * disputed row. The second-value carriage is the future
           * task's deferral. */}
          {candidateValue ?? ''}
        </p>
      );
    }
    if (candidateValue !== undefined && candidateValue !== '') {
      return (
        <p
          data-testid="participant-detail-panel-facet-row-candidate"
          className="text-sm text-slate-700"
        >
          {candidateValue}
        </p>
      );
    }
    return null;
  }, [status, candidateValue, t]);

  return (
    <div
      data-testid="participant-detail-panel-facet-row"
      data-facet-name={facet}
      data-facet-status={status}
      data-vote-state={voteState}
      data-withdraw-state={withdrawState}
      data-proposal-id={proposalId}
      className="flex flex-col gap-1 rounded border border-slate-200 p-2"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs uppercase tracking-wide text-slate-500">
          {t(`methodology.facet.${facet}`)}
        </span>
        {choices === null && ownVote !== undefined ? (
          // "You voted X" indicator — replaces the agree / dispute /
          // structural buttons once the participant has cast a vote on
          // the row's current candidate. The buttons hide so the
          // affordance doesn't keep inviting a vote already cast; the
          // indicator preserves visibility of WHICH way the participant
          // voted while waiting for the rest of the room to vote and
          // the moderator to commit. A new candidate landing on the
          // facet (per ADR 0030 §7) clears the own-vote and the buttons
          // re-appear automatically.
          <span
            data-testid={OWN_VOTE_INDICATOR_TESTID}
            data-vote-choice={ownVote}
            className="text-xs font-medium text-slate-600"
          >
            {t(`participant.detailPanel.facetRow.youVoted.${ownVote}`)}
          </span>
        ) : null}
        {choices !== null ? (
          <div className="flex items-center gap-1">
            {choices.map((choice) => {
              // The `'withdraw'` button has two flavors:
              //
              //   - On the synthetic `'proposal'`-facet row (structural
              //     sub-kinds) it remains a PLACEHOLDER — the structural
              //     withdraw flow is a follow-up task; `useVoteAction`'s
              //     `VoteChoice` is `'agree' | 'dispute'` only so we
              //     cannot route this through the vote envelope.
              //   - On a real facet row in the `agreed` / `committed`
              //     branch it is WIRED to `useWithdrawAgreementAction`
              //     (per `pf_part_withdraw_agreement_action`). The
              //     button uses a two-stage confirmation gesture
              //     (first click arms; second click fires).
              //
              // We branch on `facet === 'proposal'` to discriminate the
              // two cases.
              const isPlaceholderWithdraw = choice === 'withdraw' && facet === 'proposal';
              const isWiredWithdraw = choice === 'withdraw' && facet !== 'proposal';
              // Skip rendering the agree / dispute buttons when no
              // proposalId is available AND the row is the structural
              // synthetic `'proposal'` arm (the row needs a proposal
              // id to bind the wire send to). For real facet rows the
              // wire send carries the `(entity_kind, entity_id, facet)`
              // triple instead — the proposalId is irrelevant to the
              // dispatch — so the agree / dispute buttons render
              // regardless of proposalId availability.
              if (
                !isPlaceholderWithdraw &&
                !isWiredWithdraw &&
                facet === 'proposal' &&
                proposalId === undefined
              ) {
                return null;
              }
              // `'withdraw'` is no longer a member of the hook's
              // `VoteChoice`; the click handler never invokes
              // `castVote('withdraw')`. The narrow happens at the
              // `isPlaceholderWithdraw` / `isWiredWithdraw` branches
              // above.
              const wiredChoice: VoteChoice | null =
                choice === 'agree' ? 'agree' : choice === 'dispute' ? 'dispute' : null;
              if (isWiredWithdraw) {
                // The wired withdraw arm — fires `withdraw-agreement`.
                // Two-stage gesture: first click arms (re-labels to
                // "Confirm withdraw"); second click fires the
                // envelope. A wire-error or success returns the
                // button to the idle state. Disabled when in-flight
                // OR when no `currentParticipantId` is available
                // (the wire payload requires it; the route always
                // threads it but defensive test stubs may not).
                const cannotFire =
                  withdrawInFlight ||
                  currentParticipantId === undefined ||
                  currentParticipantId === '';
                return (
                  <button
                    key={choice}
                    type="button"
                    data-testid={VOTE_BUTTON_TESTID[choice]}
                    data-vote-choice={choice}
                    data-vote-state={voteState}
                    data-withdraw-state={withdrawState}
                    data-withdraw-armed={withdrawArmed ? 'true' : 'false'}
                    disabled={cannotFire}
                    aria-disabled={cannotFire}
                    aria-label={
                      withdrawArmed
                        ? t('participant.withdrawAgreementButton.ariaLabelConfirm')
                        : t('participant.withdrawAgreementButton.ariaLabel')
                    }
                    onClick={
                      cannotFire
                        ? undefined
                        : () => {
                            if (!withdrawArmed) {
                              // First click — arm the button.
                              setWithdrawArmed(true);
                              return;
                            }
                            // Second click — fire the envelope. The
                            // hook flips its in-flight slot
                            // synchronously inside `withdraw()`; we
                            // disarm after the call so a wire error
                            // doesn't leave the row stuck in the
                            // armed state on retry.
                            setWithdrawArmed(false);
                            void withdraw();
                          }
                    }
                    className={
                      withdrawInFlight
                        ? 'rounded border border-slate-200 bg-slate-100 px-2 py-1 text-xs text-slate-400'
                        : withdrawArmed
                          ? 'rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100'
                          : 'rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50'
                    }
                  >
                    {withdrawInFlight
                      ? t('participant.withdrawAgreementButton.inFlightLabel')
                      : withdrawArmed
                        ? t('participant.withdrawAgreementButton.confirmLabel')
                        : t('participant.withdrawAgreementButton.label')}
                  </button>
                );
              }
              return (
                <button
                  key={choice}
                  type="button"
                  data-testid={VOTE_BUTTON_TESTID[choice]}
                  data-vote-choice={choice}
                  data-vote-state={voteState}
                  data-placeholder={isPlaceholderWithdraw ? 'true' : undefined}
                  disabled={inFlight || isPlaceholderWithdraw}
                  aria-disabled={inFlight || isPlaceholderWithdraw}
                  aria-label={t('participant.voteButton.ariaLabel', { choice })}
                  onClick={
                    isPlaceholderWithdraw || wiredChoice === null
                      ? undefined
                      : () => {
                          void castVote(wiredChoice);
                        }
                  }
                  className={
                    inFlight || isPlaceholderWithdraw
                      ? 'rounded border border-slate-200 bg-slate-100 px-2 py-1 text-xs text-slate-400'
                      : 'rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50'
                  }
                >
                  {inFlight
                    ? t('participant.voteButton.inFlightLabel')
                    : t(VOTE_BUTTON_LABEL_KEY[choice])}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {bodyRender}
      {wireMessage !== undefined ? (
        <p
          data-testid="participant-vote-button-wire-error"
          data-proposal-id={proposalId}
          role="alert"
          aria-label={t('participant.voteButton.errorRoleLabel')}
          className="text-[10px] text-red-700"
        >
          {wireMessage}
        </p>
      ) : null}
      {withdrawWireMessage !== undefined ? (
        <p
          data-testid="participant-withdraw-agreement-button-wire-error"
          data-facet-name={facet}
          role="alert"
          aria-label={t('participant.withdrawAgreementButton.errorRoleLabel')}
          className="text-[10px] text-red-700"
        >
          {withdrawWireMessage}
        </p>
      ) : null}
    </div>
  );
}
