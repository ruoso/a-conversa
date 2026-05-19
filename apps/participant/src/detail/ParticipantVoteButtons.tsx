// `<ParticipantVoteButtons>` — the participant's per-facet vote-button
// row, mounted into `<EntityDetailPanel>`'s `actionSlot` from
// `OperateRoute.tsx`. One row per facet that has a pending proposal
// against the selected entity, three buttons per row
// (`agree` / `dispute` / `withdraw`).
//
// Refinement: `tasks/refinements/participant-ui/part_voting.md` —
//             `part_vote_button_per_facet` (the row + buttons) +
//             `part_vote_single_tap` (the wired cast, owned by
//             `useVoteAction`). Lives next to `<EntityDetailPanel>`
//             because the panel's `actionSlot` is the only consumer
//             today (the YAGNI "promote on the third caller" rule).
//
// Spec contract — the e2e methodology spec selects each button via:
//
//   [data-testid="participant-detail-panel-facet-row"][data-facet-name="<facet>"]
//     [data-testid="participant-vote-button-<choice>"]
//
// so the per-facet row carries the testid + `data-facet-name` attr AND
// nests the three buttons. The action-slot wrapper (which the panel
// already emits with `data-testid="participant-detail-panel-action-slot"`)
// is the outer container; this component owns the inner row markup.
//
// Wire-action — each row binds a per-`proposalId` `useVoteAction`
// callback. Buttons reflect the hook's `inFlight` / `lastError` state:
//
//   - `inFlight === true` → all three buttons in that row are
//     `disabled` + `aria-disabled`; their `data-vote-state` flips to
//     `"in-flight"`.
//   - `lastError !== undefined` → an inline error region renders next
//     to the row with `role="alert"` and the localized message.
//
// Empty state — when the selected entity has NO pending proposals
// (only committed facets), the component renders nothing (the panel's
// other sections already surface the entity detail; the absence of a
// vote affordance is itself the signal that there is nothing to vote
// on).
//
// ADRs:
//   - 0003 (React);
//   - 0005 (Tailwind utility classes);
//   - 0022 (no throwaway verifications — `ParticipantVoteButtons.test.tsx`
//           pins the per-row testid + per-choice button + inFlight +
//           error renderings);
//   - 0024 (i18n via react-i18next — all chrome strings go through
//           `useTranslation()`);
//   - 0026 (participant-workspace-only; no shell export until the
//           audience adds a third caller — same posture as the panel
//           itself);
//   - 0027 (entity / facet layers stay separate — the row is per-facet
//           and carries facet-layer attributes; the per-entity context
//           comes from `props.entityId` + `props.entityKind`).

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { EntityKind, Event, ProposalPayload } from '@a-conversa/shared-types';

import type { FacetName } from '../graph/facetStatus';

import { useVoteAction, type VoteChoice } from './useVoteAction';

/**
 * The three wire arms a vote button can fire. Mirrors
 * `VoteChoice` from `useVoteAction`; redeclared at the row-renderer
 * layer so the iteration order at the component is the locally-owned
 * source of truth (the hook is the wire contract; the row is the UI
 * contract). The order matches `methodology.voteChoice` + the wire
 * `vote` enum order.
 */
const VOTE_CHOICES: readonly VoteChoice[] = ['agree', 'dispute', 'withdraw'];

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
 * Resolve the (entityId, facet) target a proposal payload addresses,
 * or `null` for sub-kinds that do not produce a per-facet vote
 * affordance (decompose, axiom-mark, annotate, ...). Mirrors the
 * private `targetOf` helper in `apps/participant/src/graph/facetStatus.ts:132`
 * verbatim — duplicated rather than exported because the two callers
 * have intentionally distinct return shapes (the facet-status walk
 * needs `entityKind`; this walk does not — the caller already filters
 * by `entityKind` via the `props.entityKind` argument). Keeping the
 * walk inline here keeps the button row decoupled from the projection
 * module's internals.
 */
function proposalFacetTarget(
  proposal: ProposalPayload,
): { entityKind: EntityKind; entityId: string; facet: FacetName } | null {
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
    case 'decompose':
    case 'interpretive-split':
    case 'axiom-mark':
    case 'meta-move':
    case 'break-edge':
    case 'annotate':
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
 * "Pending" here is the local-projection equivalent — a facet-targeting
 * proposal with no later `commit` event referencing the same
 * `proposalId`. The server-side broadcast `proposal-status` map
 * carries the canonical pending set; for the participant's button-row
 * v0 the local walk is sufficient (and avoids a second store
 * subscription). When a future leaf needs the canonical signal it can
 * thread the pendingProposals map down.
 */
export function derivePendingFacetProposals(
  events: readonly Event[],
  entityKind: EntityKind,
  entityId: string,
): ReadonlyMap<FacetName, string> {
  // proposalEventId → facet for proposals targeting THIS (entityKind,
  // entityId). Per-facet LATEST-WINS — if two proposals target the
  // same facet, the later proposal's id is the active one (the prior
  // proposal is implicitly superseded for vote-routing purposes).
  const proposalIdByFacet = new Map<FacetName, string>();
  const committedProposalIds = new Set<string>();
  for (const event of events) {
    if (event.kind === 'proposal') {
      const target = proposalFacetTarget(event.payload.proposal);
      if (target === null) continue;
      if (target.entityKind !== entityKind) continue;
      if (target.entityId !== entityId) continue;
      proposalIdByFacet.set(target.facet, event.id);
    } else if (event.kind === 'commit') {
      committedProposalIds.add(event.payload.proposal_id);
    }
  }
  // Strip committed proposals — they no longer accept votes; the panel
  // surfaces the agreed-rollup separately.
  for (const [facet, proposalId] of [...proposalIdByFacet.entries()]) {
    if (committedProposalIds.has(proposalId)) {
      proposalIdByFacet.delete(facet);
    }
  }
  return proposalIdByFacet;
}

export interface ParticipantVoteButtonsProps {
  readonly events: readonly Event[];
  readonly entityKind: EntityKind;
  readonly entityId: string;
}

/**
 * The buttons row. Renders one `<FacetVoteRow>` per facet that has an
 * open proposal against the selected entity. Renders nothing when the
 * selected entity has no pending proposals (the absence of a vote
 * affordance is the signal there's nothing to vote on).
 */
export function ParticipantVoteButtons(props: ParticipantVoteButtonsProps): ReactElement | null {
  const { events, entityKind, entityId } = props;
  const { t } = useTranslation();

  const pendingByFacet = useMemo(
    () => derivePendingFacetProposals(events, entityKind, entityId),
    [events, entityKind, entityId],
  );

  if (pendingByFacet.size === 0) return null;

  return (
    <section data-testid="participant-detail-panel-vote-section" className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wide text-slate-500">
        {t('participant.detailPanel.sectionTitle.vote')}
      </h3>
      {[...pendingByFacet.entries()].map(([facet, proposalId]) => (
        <FacetVoteRow key={facet} facet={facet} proposalId={proposalId} />
      ))}
    </section>
  );
}

/**
 * One per-facet vote row. The row carries the spec's per-facet testid
 * + `data-facet-name` attr; the three buttons are direct children so
 * the spec's nested selector resolves.
 */
function FacetVoteRow(props: { facet: FacetName; proposalId: string }): ReactElement {
  const { facet, proposalId } = props;
  const { t } = useTranslation();
  const { castVote, inFlight, lastError } = useVoteAction({ proposalId });

  // Wire-error message text. The localized template interpolates
  // `{code}` + `{message}`; the timeout case uses the pre-localized
  // fallback already on `lastError.message`. Mirrors the moderator
  // commit-button's wire-error shaping.
  let wireMessage: string | undefined;
  if (lastError !== undefined) {
    wireMessage =
      lastError.code === 'timeout'
        ? lastError.message
        : t('participant.voteButton.wireError', {
            code: lastError.code,
            message: lastError.message,
          });
  }

  const voteState: 'enabled' | 'in-flight' = inFlight ? 'in-flight' : 'enabled';

  return (
    <div
      data-testid="participant-detail-panel-facet-row"
      data-facet-name={facet}
      data-vote-state={voteState}
      data-proposal-id={proposalId}
      className="flex flex-col gap-1 rounded border border-slate-200 p-2"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs uppercase tracking-wide text-slate-500">
          {t(`methodology.facet.${facet}`)}
        </span>
        <div className="flex items-center gap-1">
          {VOTE_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              data-testid={VOTE_BUTTON_TESTID[choice]}
              data-vote-choice={choice}
              data-vote-state={voteState}
              disabled={inFlight}
              aria-disabled={inFlight}
              aria-label={t('participant.voteButton.ariaLabel', { choice })}
              onClick={() => {
                void castVote(choice);
              }}
              className={
                inFlight
                  ? 'rounded border border-slate-200 bg-slate-100 px-2 py-1 text-xs text-slate-400'
                  : 'rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50'
              }
            >
              {inFlight
                ? t('participant.voteButton.inFlightLabel')
                : t(VOTE_BUTTON_LABEL_KEY[choice])}
            </button>
          ))}
        </div>
      </div>
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
