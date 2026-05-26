// `<ProposalFacetVoteButtons>` — per-facet vote-button block that mounts
// inside each per-facet chip in the participant pending-proposals pane.
//
// Refinement: tasks/refinements/participant-ui/part_vote_button_per_facet.md
//
// Renders agree + dispute buttons (no withdraw — withdraw is its own
// gesture per ADR 0030 §3 and lives on the detail-panel + future
// `part_withdraw.*` chain) when the chip's status admits a vote AND the
// current participant has not yet voted on this facet/proposal. When
// either gate fails the component returns null so the chip stays at its
// declarative shape.
//
// Pane-namespaced testids
// (`participant-pending-proposal-row-facet-vote-button-{agree,dispute}`)
// disambiguate from the detail panel's
// `participant-vote-button-{agree,dispute,withdraw}` so Playwright
// scenarios in `methodology-full-flow.spec.ts` (detail panel) and
// `participant-pending-proposals.spec.ts` (pane) target one surface at
// a time.
//
// ADRs: 0003 (React); 0005 (Tailwind); 0021 (envelope); 0022
// (no throwaway verifications); 0024 (react-i18next); 0026
// (participant-workspace-only); 0027 (facet/entity layer separation);
// 0030 (per-facet vote keying).

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { FacetStatus } from '../graph/facetStatus';
import { ownFacetKey, type OwnFacetVoteIndex } from '../graph/ownVotes';
import { useVoteAction, type UseVoteActionArgs, type VoteChoice } from '../detail/useVoteAction';

import type { VoteTarget } from './perProposalFacets';

export interface ProposalFacetVoteButtonsProps {
  readonly voteTarget: VoteTarget;
  readonly status: FacetStatus;
  readonly ownFacetVotes: OwnFacetVoteIndex;
}

const VOTABLE_STATUSES: ReadonlySet<FacetStatus> = new Set<FacetStatus>([
  'proposed',
  'disputed',
  'withdrawn',
]);

const VOTE_CHOICES: readonly VoteChoice[] = ['agree', 'dispute'];

const TESTID: Readonly<Record<VoteChoice, string>> = {
  agree: 'participant-pending-proposal-row-facet-vote-button-agree',
  dispute: 'participant-pending-proposal-row-facet-vote-button-dispute',
};

const LABEL_KEY: Readonly<Record<VoteChoice, string>> = {
  agree: 'participant.voteButton.agreeLabel',
  dispute: 'participant.voteButton.disputeLabel',
};

export function ProposalFacetVoteButtons({
  voteTarget,
  status,
  ownFacetVotes,
}: ProposalFacetVoteButtonsProps): ReactElement | null {
  const { t } = useTranslation();

  const ownVote = useMemo<'agree' | 'dispute' | undefined>(() => {
    if (voteTarget.kind === 'facet') {
      return ownFacetVotes.facets.get(
        ownFacetKey(voteTarget.entity_kind, voteTarget.entity_id, voteTarget.facet),
      );
    }
    if (voteTarget.proposal_id === '') return undefined;
    return ownFacetVotes.proposals.get(voteTarget.proposal_id);
  }, [voteTarget, ownFacetVotes]);

  // Hook MUST be called unconditionally (rules of hooks). The arg shape
  // discriminates on `voteTarget.kind`; the affordance gate fires AFTER
  // the call. The `'unmounted'` fallback is defensive — the gate refuses
  // to render the buttons when `voteTarget.kind === 'proposal' &&
  // voteTarget.proposal_id === ''`, so the hook is bound to a stable but
  // unreachable slot key in that branch.
  const hookArgs: UseVoteActionArgs =
    voteTarget.kind === 'facet'
      ? {
          entity_kind: voteTarget.entity_kind,
          entity_id: voteTarget.entity_id,
          facet: voteTarget.facet,
        }
      : { proposal_id: voteTarget.proposal_id === '' ? 'unmounted' : voteTarget.proposal_id };

  const { castVote, inFlight, lastError } = useVoteAction(hookArgs);

  const shouldRender =
    VOTABLE_STATUSES.has(status) &&
    ownVote === undefined &&
    !(voteTarget.kind === 'proposal' && voteTarget.proposal_id === '');

  if (!shouldRender) return null;

  return (
    <span
      data-testid="participant-pending-proposal-row-facet-vote-buttons"
      className="ml-1 inline-flex items-center gap-1"
    >
      {VOTE_CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          data-testid={TESTID[choice]}
          data-vote-choice={choice}
          data-vote-state={inFlight ? 'in-flight' : 'enabled'}
          aria-label={t('participant.voteButton.ariaLabel', { choice })}
          disabled={inFlight}
          aria-disabled={inFlight}
          onClick={() => {
            void castVote(choice);
          }}
          className="rounded-sm border border-current px-1 text-[10px] font-medium uppercase leading-none"
        >
          {inFlight ? t('participant.voteButton.inFlightLabel') : t(LABEL_KEY[choice])}
        </button>
      ))}
      {lastError ? (
        <span
          role="alert"
          aria-label={t('participant.voteButton.errorRoleLabel')}
          data-testid="participant-pending-proposal-row-facet-vote-button-error"
          className="text-[10px] text-rose-600"
        >
          {lastError.code === 'timeout'
            ? lastError.message
            : t('participant.voteButton.wireError', {
                code: lastError.code,
                message: lastError.message,
              })}
        </span>
      ) : null}
    </span>
  );
}
