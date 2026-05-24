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

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  EdgeRole,
  EntityKind,
  Event,
  ProposalPayload,
  StatementKind,
} from '@a-conversa/shared-types';

import type { FacetName, FacetStatus, FacetStatusIndex } from '../graph/facetStatus';

import { useVoteAction, type VoteChoice } from './useVoteAction';

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
 * The vote-arm vocabulary the row surfaces. Mirrors `VoteChoice` from
 * `useVoteAction`; the row owns its own iteration vocabulary so the
 * component-layer source of truth stays here. The legacy
 * three-button row (agree / dispute / withdraw) splits per ADR 0030
 * §3: withdraw is no longer a vote choice; it is its own gesture
 * landing in the downstream `pf_part_withdraw_agreement_action` task.
 * For statuses where the wired gesture is "vote on the candidate"
 * (`proposed` / `disputed` / `withdrawn`), the row renders agree +
 * dispute. For statuses where the wired gesture is "withdraw your
 * agreement" (`agreed` / `committed`), the row renders a single
 * withdraw button. For `awaiting-proposal` + `meta-disagreement`, no
 * buttons.
 *
 * The structural `'proposal'`-facet row keeps the three-button shape
 * for back-compat with the pre-refactor behaviour — the structural
 * proposal flow has not yet migrated off the proposal-keyed vote
 * envelope and the unanimity walk still reads the
 * `perParticipantVotes` map populated by the legacy vote arms.
 */
const STRUCTURAL_VOTE_CHOICES: readonly VoteChoice[] = ['agree', 'dispute', 'withdraw'];
const FACET_VOTE_CHOICES: readonly VoteChoice[] = ['agree', 'dispute'];

/**
 * Per-choice testid arms. Spelled out explicitly (rather than computed
 * via interpolation at the call site) so the testid table is
 * grep-friendly — searching for `participant-vote-button-agree` lands
 * here and nowhere else.
 */
const VOTE_BUTTON_TESTID: Readonly<Record<VoteChoice, string>> = {
  agree: 'participant-vote-button-agree',
  dispute: 'participant-vote-button-dispute',
  withdraw: 'participant-vote-button-withdraw',
};

/**
 * Per-choice i18n label key under `participant.voteButton`. Same
 * grep-friendly posture as `VOTE_BUTTON_TESTID`.
 */
const VOTE_BUTTON_LABEL_KEY: Readonly<Record<VoteChoice, string>> = {
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
        return (
          <FacetRow
            key={facet}
            facet={facet}
            entityKind={entityKind}
            entityId={entityId}
            status={status}
            proposalId={proposalId}
            candidateValue={candidateValue}
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
        />
      ) : null}
    </section>
  );
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
}

/**
 * One per-facet row. The row carries the spec's per-facet testid +
 * `data-facet-name` attr + the per-status `data-facet-status` attr +
 * (when a proposal is bound) the `data-proposal-id` attr. The row
 * body picks one of seven status branches:
 *
 *   - `awaiting-proposal` → empty-state body, no buttons.
 *   - `proposed` / `disputed` → candidate value + agree/dispute buttons.
 *   - `agreed` / `committed` → candidate value + placeholder withdraw
 *     button (TODO: wired by `pf_part_withdraw_agreement_action`).
 *   - `withdrawn` → candidate value + agree/dispute buttons.
 *   - `meta-disagreement` → candidate values, no buttons.
 *
 * The structural `'proposal'`-facet row uses the same three-button
 * shape it had pre-refactor (agree / dispute / withdraw) — the
 * structural unanimity walk still reads the proposal-keyed
 * `perParticipantVotes` map on the server.
 */
function FacetRow(props: FacetRowProps): ReactElement {
  const { facet, status, proposalId, candidateValue } = props;
  const { t } = useTranslation();

  // The wired vote-action hook. Bound to the row's proposalId when
  // present; when absent (the `awaiting-proposal` branch and the
  // edge-shape `committed` fallback), the hook is bound to an empty
  // string and the buttons are not rendered, so the binding is inert.
  // TODO(pf_part_vote_action_facet_keyed): rebind to a facet-keyed
  // hook variant so the vote envelope carries
  // `(entity_kind, entity_id, facet)` rather than `proposalId`.
  const { castVote, inFlight, lastError } = useVoteAction({ proposalId: proposalId ?? '' });

  const wireMessage = useMemo<string | undefined>(() => {
    if (lastError === undefined) return undefined;
    return lastError.code === 'timeout'
      ? lastError.message
      : t('participant.voteButton.wireError', {
          code: lastError.code,
          message: lastError.message,
        });
  }, [lastError, t]);

  const voteState: 'enabled' | 'in-flight' = inFlight ? 'in-flight' : 'enabled';

  // Pick the row's button vocabulary by status. `null` means "no
  // buttons" (awaiting-proposal + meta-disagreement). The
  // `'proposal'` synthetic facet uses the structural three-button
  // shape (kept for back-compat with the pre-refactor wire path).
  const choices = useMemo<readonly VoteChoice[] | null>(() => {
    if (facet === 'proposal') return STRUCTURAL_VOTE_CHOICES;
    switch (status) {
      case 'awaiting-proposal':
      case 'meta-disagreement':
        return null;
      case 'agreed':
      case 'committed':
        // TODO(pf_part_withdraw_agreement_action): replace the
        // single-arm 'withdraw' button with a wired
        // `useWithdrawAgreementAction` hook that emits the
        // `withdraw-agreement` event (per ADR 0030 §3). For now the
        // arm is a placeholder rendered for visual completeness —
        // clicking it currently sends a legacy `vote.choice=withdraw`
        // envelope via `useVoteAction`, which the server's vote
        // handler accepts as a back-compat path (per ADR 0030
        // Consequences §2 — the legacy arm stays until the new
        // gesture lands).
        return ['withdraw'] as const;
      case 'proposed':
      case 'disputed':
      case 'withdrawn':
        return FACET_VOTE_CHOICES;
      default:
        return null;
    }
  }, [facet, status]);

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
      data-proposal-id={proposalId}
      className="flex flex-col gap-1 rounded border border-slate-200 p-2"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs uppercase tracking-wide text-slate-500">
          {t(`methodology.facet.${facet}`)}
        </span>
        {choices !== null ? (
          <div className="flex items-center gap-1">
            {choices.map((choice) => {
              // For `agreed` / `committed` rows the gesture is a
              // placeholder withdraw button — the wired
              // `useWithdrawAgreementAction` hook lands in
              // `pf_part_withdraw_agreement_action` downstream. The
              // button renders for visual completeness but does not
              // emit a `vote` envelope (no `proposalId` to bind).
              const isPlaceholderWithdraw =
                choice === 'withdraw' && proposalId === undefined && facet !== 'proposal';
              // Skip rendering the agree / dispute buttons when no
              // proposalId is available (the row has nothing to vote
              // on at the wire layer — typically `awaiting-proposal`,
              // already-filtered above, but defensive against future
              // status surfaces).
              if (!isPlaceholderWithdraw && proposalId === undefined) return null;
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
                    isPlaceholderWithdraw
                      ? undefined
                      : () => {
                          void castVote(choice);
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
    </div>
  );
}
